import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

/** DSH 主目录。 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/**
 * 按会话 id 找到落盘日志。
 * 不猜工作区目录编码，直接扫 sessions/<group>/<sessionId>/，找不到再放宽到任意文件名。
 */
export function resolveSessionLog(sessionId) {
  const root = path.join(dshHome(), 'sessions')
  if (!sessionId || !fs.existsSync(root)) return null
  for (const group of fs.readdirSync(root)) {
    const dir = path.join(root, group, sessionId)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (/^session(?:\.v\d+)?\.jsonl(\.zstd)?$/.test(name)) return path.join(dir, name)
    }
  }
  return null
}

/** 把会话日志整份解成文本（zstd 用 fzstd，多帧）。 */
export async function decompressLog(logPath) {
  const buf = fs.readFileSync(logPath)
  if (/\.zstd$/i.test(logPath)) {
    let decompress
    try {
      const req = createRequire(path.join(dshHome(), 'profiles', 'desktop', 'package.json'))
      ;({ decompress } = req('fzstd'))
    } catch {
      const mod = await import('fzstd')
      decompress = mod.decompress
    }
    return Buffer.from(decompress(buf)).toString('utf8')
  }
  return buf.toString('utf8')
}

/** 解压 + 逐行解析。DSH 日志是多帧 zstd，node:zlib 只解第一帧，必须用 fzstd。 */
export async function decodeEvents(logPath) {
  const text = await decompressLog(logPath)
  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) } catch { /* 跳过坏行 */ }
  }
  return events
}

/** token 估算：CJK 1 token/字，ASCII 约 1 token/4 字符（与 DSH 导入器的口径一致）。 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  let cjk = 0
  let ascii = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if ((cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff)
      || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x3000 && cp <= 0x303f)
      || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x2a6df)) cjk++
    else ascii++
  }
  return cjk + Math.ceil(ascii / 4)
}

/** 事件流 → 轮次数组。保留完整内容：用户文本、助手文本/思考/工具调用、工具结果。 */
/** 附件占位符：只留引用文本，绝不解析、绝不读附件本体；附件被删也只是一行字。 */
function imagePlaceholder(b) {
  const a = b?.attachment ?? {}
  const id = a.attachmentId ?? a.sha256 ?? '未知'
  const dim = a.width && a.height ? `${a.width}×${a.height}` : '尺寸未知'
  return `[图片 ${id} ${dim}｜归档只保留索引，附件本体若被删除则此处无法还原]`
}
function filePlaceholder(b) {
  const a = b?.attachment ?? {}
  const name = a.name ?? a.attachmentId ?? '未知'
  return `[文件 ${name}｜归档只保留索引，附件本体若被删除则此处无法还原]`
}

/**
 * 追加月度摘要：<ns>/<YYYY-MM>/_summary.md，每月一份、只追加不改旧内容。
 * 每段前缀是归档日期 + 本次归档的轮次范围。
 */
export function appendMonthSummary({ nsDir, month, label = '', text, now = Date.now(), convStart = null, convEnd = null }) {
  const dir = path.join(nsDir, month)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, '_summary.md')
  const head = fs.existsSync(file) ? ''
    : `# 记忆摘要 · ${month}\n\n`
      + '> turn = 日志事件序号（含系统指令、插件注入、工具调用），不是“第几条消息”。\n\n'
      + '> 本文件只追加，不修改历史内容；每段对应一次归档里的一个类别。\n'
  const conv = convStart
    ? ` · 对话 ${fmtTime(convStart)}${convEnd ? ` – ${fmtTime(convEnd)}` : ''}`
    : ''
  // 正文里以 ## 开头的行加引用前缀，避免被当成新的摘要段（否则 category 过滤会误切）。
  const safeText = String(text).replace(/^## /gm, '> ## ')
  const block = `${head}\n## 归档 ${fmtTime(now)}${conv}${label ? ' · ' + label : ''}\n\n${safeText}\n`
  fs.appendFileSync(file, block, 'utf8')
  return file
}

/** 从会话日志里取真实上下文窗口（最后一次 request/context 事件）。 */
export function detectContextWindow(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e?.type !== 'request/context') continue
    const cw = e.data?.contextWindow ?? e.data?.context?.contextWindow
    if (typeof cw === 'number' && cw > 0) return cw
  }
  return null
}

export function buildTurns(events, opts = {}) {
  const includeReasoning = opts.includeReasoning !== false
  const turns = []
  const nameById = new Map()
  let cur = null
  for (const e of events) {
    const t = e?.type
    if (t === 'turn/start') {
      cur = { turn: e.data?.turn ?? turns.length + 1, startedAt: e.time ?? null, endedAt: null, items: [] }
      turns.push(cur)
      continue
    }
    if (t === 'tool/call') {
      if (e.data?.callId && e.data?.name) nameById.set(e.data.callId, e.data.name)
      continue
    }
    if (!cur) continue
    if (t === 'turn/end') { cur.endedAt = e.time ?? null; continue }
    if (t === 'user/message') {
      // 只收真正的用户输入；runtime-context / skill-catalog / mnemon 快照等注入内容不进归档，
      // 否则一份归档里大半是系统噪声，还会让 token 估算失真。
      const srcKind = e.data?.source?.kind ?? 'user'
      if (srcKind !== 'user') {
        // 插件自己 steer 出来的轮次：标记后从归档候选里剔除（它不算对话内容，见 FIX-9）。
        if (srcKind === 'dsh-memory-palace') cur.injected = true
        continue
      }
      const parts = []
      for (const b of e.data?.content ?? []) {
        if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
        else if (b?.type === 'image') parts.push(imagePlaceholder(b))
        else if (b?.type === 'file') parts.push(filePlaceholder(b))
      }
      const text = parts.join('\n')
      if (text) cur.items.push({ kind: 'user', time: e.time ?? null, text })
      continue
    }
    if (t === 'assistant/message') {
      for (const b of e.data?.message?.content ?? []) {
        if (b?.type === 'text' && b.text) cur.items.push({ kind: 'text', time: e.time ?? null, text: b.text })
        else if (b?.type === 'reasoning' && b.text && includeReasoning) cur.items.push({ kind: 'reasoning', time: e.time ?? null, text: b.text })
        else if (b?.type === 'image') cur.items.push({ kind: 'attachment', time: e.time ?? null, text: imagePlaceholder(b) })
        else if (b?.type === 'tool-call') {
          if (b.id && b.name) nameById.set(b.id, b.name)
          cur.items.push({ kind: 'tool-call', time: e.time ?? null, name: b.name ?? 'tool', args: b.arguments ?? '' })
        }
      }
      continue
    }
    if (t === 'tool/result') {
      const d = e.data ?? {}
      const callId = d.toolCallId ?? d.message?.toolCallId
      const name = nameById.get(callId) ?? d.name ?? d.tool ?? 'tool'
      cur.items.push({
        kind: 'tool-result',
        time: e.time ?? null,
        name,
        error: d.isError === true || d.message?.isError === true,
        text: stringifyResult(d),
      })
    }
  }
  return turns.filter((x) => x.items.length > 0)
}

function stringifyResult(d) {
  const c = d.message?.content ?? d.content ?? d.result ?? d.output
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c.map((b) => {
      if (typeof b === 'string') return b
      if (b?.type === 'image') return imagePlaceholder(b)
      if (b?.type === 'file') return filePlaceholder(b)
      return b?.text ?? JSON.stringify(b)
    }).join('\n')
  }
  if (c === undefined) return JSON.stringify(d).slice(0, 20000)
  return JSON.stringify(c)
}

/** 一轮的 UTF-8 字节数。 */
export function turnBytes(turn) {
  return Buffer.byteLength(renderTurn(turn), 'utf8')
}

const pad = (n, w = 2) => String(n).padStart(w, '0')
export function fmtTime(ms) {
  if (!ms) return '未知时间'
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
export function fmtDay(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

/** 归档子目录按月分：YYYY-MM。 */
export function fmtMonth(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/**
 * 追加一行索引；失败时写进 .pending-index.jsonl（待补清单），绝不抛错打断归档。
 * 数据优先：文件已经在盘上，索引最多迟到，不会丢。
 */
export function appendIndexRow(indexPath, row) {
  try {
    // 上次若崩在半行，先补一个换行，避免新行与残行粘连成一行坏 JSON。
    try {
      const st = fs.statSync(indexPath)
      if (st.size > 0) {
        const fd = fs.openSync(indexPath, 'r')
        const buf = Buffer.alloc(1)
        fs.readSync(fd, buf, 0, 1, st.size - 1)
        fs.closeSync(fd)
        if (buf[0] !== 10) fs.appendFileSync(indexPath, '\n', 'utf8')
      }
    } catch { /* 文件不存在就算了 */ }
    fs.appendFileSync(indexPath, JSON.stringify(row) + '\n', 'utf8')
    return { ok: true }
  } catch (err) {
    try {
      fs.appendFileSync(path.join(path.dirname(indexPath), '.pending-index.jsonl'), JSON.stringify(row) + '\n', 'utf8')
      return { ok: false, pending: true, error: String(err?.message ?? err) }
    } catch {
      return { ok: false, pending: false, error: String(err?.message ?? err) }
    }
  }
}

/**
 * 补索引：把 .pending-index.jsonl 里、文件确实存在的行补进 index.jsonl，然后清空待补清单。
 * 返回 { added, dropped }；找不到文件的行会被丢弃（文件都没了，索引行没有意义）。
 */
export function reconcilePendingIndex(nsDir) {
  const indexPath = path.join(nsDir, 'index.jsonl')
  const pendingPath = path.join(nsDir, '.pending-index.jsonl')
  if (!fs.existsSync(pendingPath)) return { added: 0, dropped: 0, ok: true }
  let lines = []
  try {
    lines = fs.readFileSync(pendingPath, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)
  } catch {
    return { added: 0, dropped: 0, ok: false }
  }
  const existing = new Set()
  if (fs.existsSync(indexPath)) {
    try {
      for (const l of fs.readFileSync(indexPath, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean)) {
        try { existing.add(JSON.parse(l).file) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  let added = 0
  let dropped = 0
  try {
    for (const l of lines) {
      let row
      try { row = JSON.parse(l) } catch { dropped += 1; continue }
      const abs = path.join(nsDir, String(row.file).replace(/\\/g, '/'))
      if (!fs.existsSync(abs)) { dropped += 1; continue }
      if (existing.has(row.file)) continue
      fs.appendFileSync(indexPath, JSON.stringify(row) + '\n', 'utf8')
      existing.add(row.file)
      added += 1
    }
    fs.writeFileSync(pendingPath, '', 'utf8')
    return { added, dropped, ok: true }
  } catch {
    return { added, dropped, ok: false }
  }
}

export function fmtStamp(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 单轮 → Markdown 片段。角色用中英双标，避免读档时分不清谁说的。 */
export function renderTurn(turn) {
  const TEXT_CAP = 200000
  const cap = (s) => (String(s).length > TEXT_CAP ? `${String(s).slice(0, TEXT_CAP)}\n…（本条超长，已截断）` : String(s))
  const out = [`## TURN ${turn.turn} · ${fmtTime(turn.startedAt)}`]
  for (const it of turn.items) {
    if (it.kind === 'user') out.push(`### 用户（user） · ${fmtTime(it.time)}`, '', cap(it.text), '')
    else if (it.kind === 'text') out.push(`### 助手（assistant） · ${fmtTime(it.time)}`, '', cap(it.text), '')
    else if (it.kind === 'attachment') out.push(`### 附件（attachment） · ${fmtTime(it.time)}`, '', it.text, '')
    else if (it.kind === 'reasoning') out.push(`### 助手思考（assistant reasoning） · ${fmtTime(it.time)}`, '', '<details><summary>展开</summary>', '', cap(it.text), '', '</details>', '')
    else if (it.kind === 'tool-call') out.push(`### 助手调用工具（tool call：${it.name}） · ${fmtTime(it.time)}`, '', '```json', String(it.args).slice(0, 200000), '```', '')
    else if (it.kind === 'tool-result') out.push(`### 工具返回（tool result：${it.name}${it.error ? ' · 报错' : ''}） · ${fmtTime(it.time)}`, '', '```', String(it.text).slice(0, 400000), '```', '')
  }
  return out.join('\n')
}

/** 一轮的 token 估算：逐条累加文本，避免整段 JSON.stringify（长会话下更省）。 */
export function turnTokens(turn) {
  let sum = 0
  for (const it of turn.items) {
    if (typeof it.text === 'string') sum += estimateTokens(it.text)
    else if (typeof it.args === 'string') sum += estimateTokens(it.args)
  }
  return sum
}

/**
 * 决定保留尾部：至少保留最近 retainTurns 轮，且至少保留最近 retainBytes 字节的对话。
 * 两条都成立时取更靠前的起点（保留得更多），避免字节阈值把轮数挤没。
 * 返回保留的起始索引（>= 该索引的轮次不归档）。
 */
export function retainedFrom(turns, retainTurns, retainBytes) {
  const n = turns.length
  const byTurns = Math.max(0, n - Math.max(0, retainTurns))
  let acc = 0
  let byBytes = n
  for (let i = n - 1; i >= 0; i--) {
    acc += turnBytes(turns[i])
    byBytes = i
    if (acc >= retainBytes) break
  }
  return Math.min(byTurns, byBytes)
}

/**
 * 按字节上限决定保留窗口（整轮粒度）。
 * 严格不超过 capBytes：跨过上限的那一轮被划到归档侧，而不是留下；
 * 唯一的例外是单轮本身就超过上限——此时至少保留最后 1 轮，避免归档“当前正在说的这句”。
 */
export function retainedFromCapped(turns, retainTurns, capBytes) {
  const n = turns.length
  const byTurns = Math.max(0, n - Math.max(0, retainTurns))
  if (!(capBytes > 0)) return byTurns
  let acc = 0
  let byBytes = n
  for (let i = n - 1; i >= 0; i--) {
    acc += turnBytes(turns[i])
    if (acc > capBytes) {
      // 加上这一轮就超了：从它之后开始保留（但至少留最后一轮）。
      byBytes = Math.min(i + 1, n - 1)
      break
    }
    byBytes = i
  }
  return Math.max(byTurns, byBytes)
}

/** 轮次区间的人话表达：连续用 a–b，跳号就逐个列出来。 */
export function fmtTurnSpan(turns) {
  const nums = turns.map((x) => (typeof x === 'number' ? x : x.turn))
  if (nums.length === 0) return 'turn -'
  let contiguous = true
  for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1] + 1) { contiguous = false; break }
  if (contiguous) return `turn ${nums[0]}–${nums[nums.length - 1]}（${nums.length} 轮）`
  return `turn ${nums.join(', ')}（${nums.length} 轮，不连续）`
}
/** 原子写：先写临时文件再 rename，避免留下半截文件。 */
function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, data, 'utf8')
  try {
    fs.renameSync(tmp, file)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
    throw err
  }
}

/** 按单文件字节上限把轮次切块；返回每块（至少一块）。 */
function chunkTurns(turns, maxBytes) {
  const chunks = []
  let cur = []
  let size = 0
  for (const t of turns) {
    const b = turnBytes(t)
    if (cur.length > 0 && size + b > maxBytes) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(t)
    size += b
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks.length > 0 ? chunks : [turns]
}

/**
 * 写入归档文件 + 索引。返回 { files, bytes, fromTurn, toTurn, parts }。
 * 顺序：先原子写 md，再 append 索引，最后由调用方写水位。
 * 任一步失败都不会留下“半截文件”；索引缺行最多导致下次重复归档，不会丢数据。
 */
export function writeArchive({ nsDir, nsLabel = '', selfNameSlug, category, turns, meta, maxFileBytes = 5_000_000, now = Date.now() }) {
  // 月份按“该批对话首轮的时间”定，而不是归档时刻：10-31 深夜的对话归档到 11-01 时仍归 10 月。
  const month = fmtMonth(turns[0]?.startedAt ?? now)
  // 会话命名空间下：<YYYY-MM>/<category>/；索引里存相对命名空间的路径，改名不影响。
  const dir = path.join(nsDir, month, category)
  fs.mkdirSync(dir, { recursive: true })
  // 一次归档调用 = 一个文件；同一次调用里同分类的所有轮次都进这一个文件。
  const stamp = fmtStamp(now)
  const chunks = chunkTurns(turns, maxFileBytes)
  const parts = chunks.length
  const files = []
  let totalBytes = 0

  chunks.forEach((chunk, i) => {
    // 同秒多次调用时追加 -2、-3…；分卷再加 -pN。
    let name = `${selfNameSlug}-${category}-${stamp}${parts > 1 ? `-p${i + 1}` : ''}.md`
    let file = path.join(dir, name)
    let n = 1
    while (fs.existsSync(file)) {
      n += 1
      name = `${selfNameSlug}-${category}-${stamp}${parts > 1 ? `-p${i + 1}` : ''}-${n}.md`
      file = path.join(dir, name)
    }

    const fromTurn = chunk[0].turn
    const toTurn = chunk[chunk.length - 1].turn
    const lastEnd = chunk[chunk.length - 1].endedAt ?? chunk[chunk.length - 1].startedAt
    const title = meta.sessionTitle && meta.sessionTitle !== meta.sessionId
      ? `${meta.sessionTitle}（${meta.sessionId}）`
      : `${meta.sessionId}`
    const head = [
      `# 记忆归档 · ${category}`,
      '',
      `- 记忆库：${nsLabel || nsDir}`,
      `- 来源会话：${title}`,
      `- 覆盖轮次：${fmtTurnSpan(chunk)}`,
      `- 时间范围：${fmtTime(chunk[0].startedAt)} → ${fmtTime(lastEnd)}`,
      `- 归档时间：${fmtTime(now)}`,
      parts > 1 ? `- 分卷：${i + 1} / ${parts}` : null,
      meta.reason ? `- 触发原因：${meta.reason}` : null,
      '',
      '> 本文件为只读归档：原文按轮次时间正序保存，请勿修改。',
      '',
    ].filter((line) => line !== null).join('\n')
    const body = chunk.map(renderTurn).join('\n\n---\n\n')
    writeFileAtomic(file, `${head}\n${body}\n`)
    const bytes = fs.statSync(file).size
    totalBytes += bytes
    const relNs = path.relative(nsDir, file).replace(/\\/g, '/')
    files.push(nsLabel ? `${nsLabel}/${relNs}` : relNs)

    const indexPath = path.join(nsDir, 'index.jsonl')
    const turnNums = chunk.map((t) => t.turn)
    let contiguous = true
    for (let k = 1; k < turnNums.length; k++) if (turnNums[k] !== turnNums[k - 1] + 1) { contiguous = false; break }
    const row = {
      file: relNs,
      category, sessionId: meta.sessionId, fromTurn, toTurn,
      turns: contiguous ? undefined : turnNums,
      startTime: fmtTime(chunk[0].startedAt), endTime: fmtTime(lastEnd),
      archivedAt: fmtTime(now), bytes, part: parts > 1 ? i + 1 : undefined, parts: parts > 1 ? parts : undefined,
    }
    appendIndexRow(indexPath, row)
  })

  return {
    files,
    file: files[0],
    bytes: totalBytes,
    fromTurn: turns[0].turn,
    toTurn: turns[turns.length - 1].turn,
    parts,
  }
}

/** 索引里是否已经归档过同一会话的同一轮次区间（去重）。 */
export function alreadyArchived(cwd, rootDirName, sessionId, fromTurn, toTurn) {
  const indexPath = path.join(cwd, rootDirName, 'index.jsonl')
  if (!fs.existsSync(indexPath)) return false
  const tail = fs.readFileSync(indexPath, 'utf8').trim().split('\n').slice(-500)
  for (const line of tail) {
    try {
      const r = JSON.parse(line)
      if (r.sessionId === sessionId && r.fromTurn === fromTurn && r.toTurn === toTurn) return true
    } catch { /* ignore */ }
  }
  return false
}
