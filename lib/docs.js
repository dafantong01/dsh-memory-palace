/**
 * 记忆回廊 V0.3 · 项目档案（memory-docs）数据层
 *
 * 目录布局（工作区级、会话级、纯本地文件、无 embedding）：
 *   <cwd>/memory-docs/<会话名>/
 *     index.jsonl     # 每行一条：id,title,description,tags,projectLabel,created,updated,rev,archived,ownerSessionId
 *     <id>.md         # 首行 JSON frontmatter，其余为 Markdown 正文
 *     archive/        # 冷归档（仍在索引里，archived=true）
 *     .trash/         # 软删除落点（不在索引里）
 *     .backup/        # 更新前的旧正文备份
 *
 * 约定：
 * - 只对已命名会话开放；未命名直接报错，且不创建任何目录。
 * - 写操作要求传入的 ownerSessionId 与文档记录的 ownerSessionId 一致；跨会话只读由上层负责，本模块不提供跨会话读取。
 * - 正文先写临时文件再 rename；更新前先把旧正文复制进 .backup/。
 * - rev 单调递增；更新必须带旧 rev，不匹配返回 {ok:false, conflict:true, rev}。
 * - 索引是派生物，磁盘上的 .md 才是事实源：索引坏行/缺行/文件缺失时自动重建，坏 frontmatter 跳过并报告。
 * - 所有导出函数都不抛异常，统一返回 {ok:true,...} 或 {ok:false,error,code}。
 * 纯 Node 实现，不依赖 DSH runtime。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pruneTrash } from './trash.js'

/** memory-docs 根目录名（位于工作区下）。 */
const DOCS_ROOT = 'memory-palace'
const DOCS_SUBDIR = '_docs'
const INDEX_FILE = 'index.jsonl'
const ARCHIVE_DIR = 'archive'
const TRASH_DIR = '.trash'
const BACKUP_DIR = '.backup'

/** index.jsonl 每行与 frontmatter 的字段集合（顺序固定，便于人读）。 */
const ENTRY_FIELDS = ['id', 'title', 'description', 'tags', 'projectLabel', 'enabled', 'familyShared', 'created', 'updated', 'rev', 'archived', 'ownerSessionId', 'chars']

const MAX_SESSION_CHARS = 100
const MAX_ID_CHARS = 80
const MAX_TITLE_CHARS = 200
const MAX_DESCRIPTION_CHARS = 4000
const MAX_BODY_CHARS = 1000000
const MAX_TAGS = 24
const MAX_TAG_CHARS = 32
const MAX_PROJECT_LABEL_WORDS = 5
const MAX_BACKUPS_PER_DOC = 20
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200
const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 100
const MAX_SNIPPET_CHARS = 240
const SNIPPET_RADIUS = 90
const MAX_SCORE_OCCURRENCES = 5

/** Windows 设备保留名，不能当文件主名。 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

// ---------------------------------------------------------------- 基础工具

let lastStamp = 0

/** 进程内单调递增的 ISO 时间戳，保证同一毫秒内多次写入也能稳定排序。 */
function nowIso() {
  const t = Math.max(Date.now(), lastStamp + 1)
  lastStamp = t
  return new Date(t).toISOString()
}

function fail(error, code = 'error', extra = {}) {
  return { ok: false, error, code, ...extra }
}

function crash(err, code = 'io') {
  const message = err && err.message ? String(err.message) : String(err)
  return { ok: false, error: message, code }
}

function okValue(value) {
  return { ok: true, value }
}

/** 同步小睡（仅用于 Windows 上 rename 被占用时的短暂重试）。 */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch { /* 环境不支持就退化为忙等一次 */ }
}

/** 原子写：同目录临时文件 + rename；失败时清掉临时文件。 */
function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  try {
    fs.writeFileSync(tmp, content, 'utf8')
    renameWithRetry(tmp, filePath)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* 临时文件可能已被 rename 走 */ }
    throw err
  }
}

function renameWithRetry(from, to) {
  let lastErr
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (err) {
      lastErr = err
      const code = err && err.code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw err
      sleepSync(20 * (attempt + 1))
    }
  }
  throw lastErr
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function clampInt(raw, fallback, min, max) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, Math.floor(raw)))
}

function isoOr(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  return fallback
}

function definedScalar(value) {
  return typeof value === 'string' && value.trim() ? value : ''
}

// ---------------------------------------------------------------- 入参校验

function checkCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return fail('缺少工作区目录 cwd', 'invalid-cwd')
  return okValue(path.resolve(cwd))
}

function checkSessionName(raw) {
  if (raw == null || typeof raw !== 'string' || !raw.trim()) {
    return fail('会话未命名：memory-docs 只对已命名的会话开放（未创建任何目录）', 'unnamed-session')
  }
  const name = raw.trim()
  if (name.length > MAX_SESSION_CHARS) return fail(`会话名过长（上限 ${MAX_SESSION_CHARS} 字符）`, 'invalid-session')
  if (name === '.' || name === '..' || name.startsWith('.')) return fail('会话名不能以点开头（避免与 .backup/.trash 冲突）', 'invalid-session')
  if (/[\\/:*?"<>|]/.test(name)) return fail('会话名包含路径分隔符或系统保留字符', 'invalid-session')
  if (/[\u0000-\u001f\u007f]/.test(name)) return fail('会话名包含控制字符', 'invalid-session')
  if (/[. ]$/.test(name)) return fail('会话名不能以点或空格结尾', 'invalid-session')
  return okValue(name)
}

function checkId(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return fail('缺少文档 id', 'invalid-id')
  const id = raw.trim()
  if (id.length > MAX_ID_CHARS) return fail(`文档 id 过长（上限 ${MAX_ID_CHARS} 字符）`, 'invalid-id')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    return fail(`非法文档 id：${id}（只允许字母、数字、点、下划线、连字符，且以字母或数字开头）`, 'invalid-id')
  }
  if (id.includes('..')) return fail('文档 id 不能包含 ..', 'invalid-id')
  if (WINDOWS_RESERVED.test(id)) return fail(`文档 id 与系统保留名冲突：${id}`, 'invalid-id')
  return okValue(id)
}

function checkOwner(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return fail('缺少 ownerSessionId：写操作必须由当前会话发起', 'invalid-owner')
  }
  return okValue(raw.trim())
}

function checkText(raw, { field, max, required = false, fallback = '' }) {
  if (raw == null) {
    if (required) return fail(`${field} 不能为空`, 'invalid-input')
    return okValue(fallback)
  }
  if (typeof raw !== 'string') return fail(`${field} 必须是字符串`, 'invalid-input')
  if (required && !raw.trim()) return fail(`${field} 不能为空`, 'invalid-input')
  if (raw.length > max) return fail(`${field} 过长（上限 ${max} 字符）`, 'invalid-input')
  return okValue(required ? raw.trim() : raw)
}

function normalizeTags(raw) {
  if (raw == null) return okValue([])
  let list
  if (Array.isArray(raw)) list = raw
  else if (typeof raw === 'string') list = raw.split(/[,，\s]+/)
  else return fail('tags 必须是字符串数组', 'invalid-tags')
  const out = []
  for (const item of list) {
    if (item == null) continue
    if (typeof item !== 'string') return fail('tags 必须是字符串数组', 'invalid-tags')
    const tag = item.trim()
    if (!tag) continue
    if (tag.length > MAX_TAG_CHARS) return fail(`单个 tag 最长 ${MAX_TAG_CHARS} 字符`, 'invalid-tags')
    if (!out.includes(tag)) out.push(tag)
  }
  if (out.length > MAX_TAGS) return fail(`tags 最多 ${MAX_TAGS} 个`, 'invalid-tags')
  return okValue(out)
}

/** projectLabel：最多 5 个英文单词；空串表示不绑定项目。 */
function normalizeProjectLabel(raw) {
  if (raw == null) return okValue('')
  if (typeof raw !== 'string') return fail('projectLabel 必须是字符串', 'invalid-label')
  const label = raw.trim().replace(/\s+/g, ' ')
  if (!label) return okValue('')
  if (/[\u0000-\u001f\u007f]/.test(label)) return fail('projectLabel 不能包含控制字符', 'invalid-label')
  const words = label.split(' ')
  if (words.length > MAX_PROJECT_LABEL_WORDS) {
    return fail(`projectLabel 最多 ${MAX_PROJECT_LABEL_WORDS} 个英文单词，当前 ${words.length} 个`, 'invalid-label')
  }
  if (!words.every((w) => /^[A-Za-z0-9][A-Za-z0-9._+#-]*$/.test(w))) {
    return fail('projectLabel 只接受英文单词（字母或数字开头，可含点、下划线、连字符）', 'invalid-label')
  }
  return okValue(label)
}

// ---------------------------------------------------------------- 路径与解析

/** 计算 memory-docs 的会话目录（不创建目录、不做 IO）。 */
export function docsDirFor(cwd, sessionName) {
  try {
    const c = checkCwd(cwd)
    if (!c.ok) return c
    const s = checkSessionName(sessionName)
    if (!s.ok) return s
    return { ok: true, cwd: c.value, sessionName: s.value, dir: path.join(c.value, DOCS_ROOT, s.value, DOCS_SUBDIR) }
  } catch (err) {
    return crash(err)
  }
}

/** docsDirFor 的落盘版：额外确认工作区目录真实存在。 */
function resolveDocsDir(cwd, sessionName) {
  const base = docsDirFor(cwd, sessionName)
  if (!base.ok) return base
  let stat
  try {
    stat = fs.statSync(base.cwd)
  } catch {
    return fail(`工作区目录不存在：${base.cwd}`, 'invalid-cwd')
  }
  if (!stat.isDirectory()) return fail(`工作区路径不是目录：${base.cwd}`, 'invalid-cwd')
  return base
}

/**
 * 解析 .md：首行是单行 JSON frontmatter，其余是正文。
 * 容忍 BOM 与 CRLF；首行不是合法 JSON 对象时标记 bad（调用方决定跳过还是报错）。
 */
function parseDocText(rawText) {
  const text = stripBom(String(rawText ?? '')).replace(/\r\n?/g, '\n')
  const nl = text.indexOf('\n')
  const first = (nl === -1 ? text : text.slice(0, nl)).trim()
  if (!first.startsWith('{')) return { frontmatter: null, body: text, bad: true }
  let frontmatter
  try {
    frontmatter = JSON.parse(first)
  } catch {
    return { frontmatter: null, body: text, bad: true }
  }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    return { frontmatter: null, body: text, bad: true }
  }
  return { frontmatter, body: nl === -1 ? '' : text.slice(nl + 1), bad: false }
}

function entryFromDoc(doc) {
  const out = {}
  for (const key of ENTRY_FIELDS) out[key] = doc[key]
  return out
}

function serializeDoc(doc, body) {
  return `${JSON.stringify(entryFromDoc(doc))}\n${body ?? ''}`
}

// ---------------------------------------------------------------- 元数据归一

/** 把任意来源（索引行 / frontmatter）归一成条目；id 非法或不是对象时返回 null。 */
function coerceEntry(rec, fallbackId) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null
  const idRes = checkId(typeof rec.id === 'string' && rec.id.trim() ? rec.id : fallbackId)
  if (!idRes.ok) return null
  const id = idRes.value
  const titleRes = typeof rec.title === 'string' && rec.title.trim() ? okValue(rec.title.trim().slice(0, MAX_TITLE_CHARS)) : null
  const tagsRes = normalizeTags(rec.tags)
  const labelRes = normalizeProjectLabel(rec.projectLabel)
  const createdAt = isoOr(rec.created, nowIso())
  return {
    id,
    title: titleRes ? titleRes.value : id,
    description: typeof rec.description === 'string' ? rec.description.slice(0, MAX_DESCRIPTION_CHARS) : '',
    tags: tagsRes.ok ? tagsRes.value : [],
    projectLabel: labelRes.ok ? labelRes.value : '',
    enabled: rec.enabled !== false,
    familyShared: rec.familyShared === true,
    created: createdAt,
    updated: isoOr(rec.updated, createdAt),
    rev: Number.isInteger(rec.rev) && rec.rev >= 1 ? rec.rev : 1,
    archived: rec.archived === true,
    ownerSessionId: typeof rec.ownerSessionId === 'string' ? rec.ownerSessionId.trim() : '',
    chars: Number.isInteger(rec.chars) && rec.chars >= 0 ? rec.chars : null,
  }
}

/**
 * 合并「索引条目 + 文件 frontmatter」得到当前元数据；文件为准，索引兜底。
 * mtimeMs 用于 frontmatter 缺少时间字段时的最后兜底。
 */
function currentMeta(entry, frontmatter, id, archived, mtimeMs) {
  const base = entry && typeof entry === 'object' ? entry : {}
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {}
  const merged = { ...base }
  for (const key of ['title', 'description', 'tags', 'projectLabel', 'enabled', 'familyShared', 'ownerSessionId', 'chars']) {
    if (fm[key] !== undefined && fm[key] !== null) merged[key] = fm[key]
  }
  merged.id = id
  merged.archived = archived
  const mtimeIso = mtimeMs ? new Date(mtimeMs).toISOString() : nowIso()
  merged.created = definedScalar(fm.created) || base.created || mtimeIso
  merged.updated = definedScalar(fm.updated) || base.updated || mtimeIso
  merged.rev = Math.max(Number.isInteger(fm.rev) ? fm.rev : 0, Number.isInteger(base.rev) ? base.rev : 0, 1)
  return coerceEntry(merged, id)
}

function sortEntries(list) {
  return [...list].sort((a, b) => {
    if ((a.archived === true) !== (b.archived === true)) return a.archived === true ? 1 : -1
    const ta = Date.parse(a.updated) || 0
    const tb = Date.parse(b.updated) || 0
    if (tb !== ta) return tb - ta
    const tc = (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0)
    if (tc) return tc
    return a.id.localeCompare(b.id)
  })
}

// ---------------------------------------------------------------- 磁盘扫描与索引

/** 扫描根目录与 archive/ 下的 .md；同一 id 两边都有时根目录优先并给出警告。 */
function scanDocFiles(dir) {
  const files = new Map()
  const warnings = []
  const scan = (folder, archived, prefix) => {
    let names
    try {
      names = fs.readdirSync(folder)
    } catch {
      return
    }
    for (const name of names) {
      const match = /^(.+)\.md$/i.exec(name)
      if (!match) continue
      const rawId = match[1]
      const idRes = checkId(rawId)
      if (!idRes.ok) {
        warnings.push(`文件名不是合法 id，已跳过：${prefix}${name}`)
        continue
      }
      const full = path.join(folder, name)
      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        warnings.push(`无法读取文档，已跳过：${prefix}${name}`)
        continue
      }
      if (!stat.isFile()) continue
      const id = idRes.value
      const prev = files.get(id)
      if (prev) {
        if (prev.archived && !archived) {
          files.set(id, { id, file: full, archived, mtimeMs: stat.mtimeMs })
        }
        warnings.push(`同一 id 同时存在于根目录与 archive：${id}（已按根目录优先）`)
        continue
      }
      files.set(id, { id, file: full, archived, mtimeMs: stat.mtimeMs })
    }
  }
  scan(dir, false, '')
  scan(path.join(dir, ARCHIVE_DIR), true, 'archive/')
  return { files, warnings }
}

/** 以磁盘 .md 为准重建索引；坏 frontmatter 的文件跳过并记录警告。 */
function rebuildIndex(dir, indexMap, files, warnings) {
  const entries = []
  for (const [id, info] of files) {
    let raw
    try {
      raw = fs.readFileSync(info.file, 'utf8')
    } catch (err) {
      warnings.push(`读取失败，已跳过：${info.archived ? 'archive/' : ''}${id}.md（${String(err && err.message ? err.message : err)}）`)
      continue
    }
    const parsed = parseDocText(raw)
    if (parsed.bad) {
      warnings.push(`frontmatter 损坏，已跳过：${info.archived ? 'archive/' : ''}${id}.md`)
      continue
    }
    const fm = parsed.frontmatter
    if (typeof fm.id === 'string' && fm.id && fm.id !== id) {
      warnings.push(`frontmatter id（${fm.id}）与文件名（${id}）不一致，以文件名为准：${id}.md`)
    }
    const doc = currentMeta(indexMap.get(id), fm, id, info.archived, info.mtimeMs)
    if (!doc) {
      warnings.push(`元数据无法重建，已跳过：${id}.md`)
      continue
    }
    entries.push(doc)
  }
  return sortEntries(entries)
}

function writeIndex(dir, entries) {
  const payload = entries.length ? `${entries.map((entry) => JSON.stringify(entryFromDoc(entry))).join('\n')}\n` : ''
  atomicWrite(path.join(dir, INDEX_FILE), payload)
}

/**
 * 读取索引；发现坏行、重复 id、条目与磁盘不一致、索引缺失时自动以文件为准重建。
 * 目录不存在时不创建任何文件，直接返回空表。
 */
function loadIndex(dir) {
  const warnings = []
  const indexPath = path.join(dir, INDEX_FILE)
  let raw = null
  let exists = false
  try {
    raw = stripBom(fs.readFileSync(indexPath, 'utf8'))
    exists = true
  } catch {
    exists = false
  }

  const indexMap = new Map()
  let badLines = 0
  let duplicates = 0
  if (exists && raw != null) {
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let rec
      try {
        rec = JSON.parse(line)
      } catch {
        badLines++
        continue
      }
      const entry = coerceEntry(rec, null)
      if (!entry) {
        badLines++
        continue
      }
      if (indexMap.has(entry.id)) duplicates++
      indexMap.set(entry.id, entry)
    }
  }

  const scanned = scanDocFiles(dir)
  const files = scanned.files
  let mismatch = files.size !== indexMap.size
  if (!mismatch) {
    for (const [id, info] of files) {
      const entry = indexMap.get(id)
      if (!entry || entry.archived !== info.archived) {
        mismatch = true
        break
      }
    }
  }

  if (exists && !badLines && !duplicates && !mismatch) {
    return { entries: sortEntries([...indexMap.values()]), warnings: [] }
  }

  if (!exists && files.size === 0) {
    // 还没写过任何文档：读取不落盘
    return { entries: [], warnings: [], rebuilt: false }
  }

  if (badLines) warnings.push(`index.jsonl 有 ${badLines} 行无法解析，已跳过`)
  if (duplicates) warnings.push(`index.jsonl 有 ${duplicates} 条重复 id，已按文件重建`)
  warnings.push(...scanned.warnings)
  const entries = rebuildIndex(dir, indexMap, files, warnings)
  try {
    if (fs.existsSync(dir)) writeIndex(dir, entries)
  } catch (err) {
    warnings.push(`索引重建后写入失败：${String(err && err.message ? err.message : err)}`)
  }
  return { entries, warnings, rebuilt: true }
}

function locateDoc(dir, id) {
  const root = path.join(dir, `${id}.md`)
  try {
    if (fs.statSync(root).isFile()) return { file: root, archived: false, relative: `${id}.md` }
  } catch { /* 不存在 */ }
  const archived = path.join(dir, ARCHIVE_DIR, `${id}.md`)
  try {
    if (fs.statSync(archived).isFile()) return { file: archived, archived: true, relative: `${ARCHIVE_DIR}/${id}.md` }
  } catch { /* 不存在 */ }
  return null
}

// ---------------------------------------------------------------- 备份与软删

function pruneBackups(backupDir, id) {
  let names = []
  try {
    names = fs.readdirSync(backupDir)
  } catch {
    return
  }
  const prefix = `${id}~`
  const mine = names.filter((name) => name.startsWith(prefix)).sort().reverse()
  for (const name of mine.slice(MAX_BACKUPS_PER_DOC)) {
    try { fs.unlinkSync(path.join(backupDir, name)) } catch { /* 清不掉就留着 */ }
  }
}

/** 更新前把旧正文复制进 .backup/；失败则抛错，由调用方中止更新。 */
function backupDoc(dir, id, sourceFile, oldRev) {
  const backupDir = path.join(dir, BACKUP_DIR)
  fs.mkdirSync(backupDir, { recursive: true })
  const target = path.join(backupDir, `${id}~r${oldRev}~${Date.now()}.md`)
  fs.copyFileSync(sourceFile, target)
  pruneBackups(backupDir, id)
  return target
}

// ---------------------------------------------------------------- 导出：创建

/** 新建文档。ownerSessionId 记为文档所有者；未命名会话不创建任何目录。 */
export function createDoc(cwd, sessionName, ownerSessionId, input) {
  try {
    const ctx = resolveDocsDir(cwd, sessionName)
    if (!ctx.ok) return ctx
    const owner = checkOwner(ownerSessionId)
    if (!owner.ok) return owner
    if (input != null && (typeof input !== 'object' || Array.isArray(input))) {
      return fail('input 必须是对象', 'invalid-input')
    }
    const src = input || {}

    const titleRes = checkText(src.title, { field: 'title', max: MAX_TITLE_CHARS, required: true })
    if (!titleRes.ok) return titleRes
    const descRes = checkText(src.description, { field: 'description', max: MAX_DESCRIPTION_CHARS })
    if (!descRes.ok) return descRes
    const bodyRes = checkText(src.body, { field: 'body', max: MAX_BODY_CHARS })
    if (!bodyRes.ok) return bodyRes
    const tagsRes = normalizeTags(src.tags)
    if (!tagsRes.ok) return tagsRes
    const labelRes = normalizeProjectLabel(src.projectLabel)
    if (!labelRes.ok) return labelRes
    if (src.archived != null && typeof src.archived !== 'boolean') {
      return fail('archived 必须是布尔值', 'invalid-input')
    }
    const archived = src.archived === true

    let id
    if (src.id == null || src.id === '') {
      id = generateId()
      for (let attempt = 0; attempt < 3 && fs.existsSync(path.join(ctx.dir, `${id}.md`)); attempt++) id = generateId()
    } else {
      const idRes = checkId(src.id)
      if (!idRes.ok) return idRes
      id = idRes.value
    }

    let entries = []
    if (fs.existsSync(ctx.dir)) {
      if (locateDoc(ctx.dir, id)) return fail(`文档已存在：${id}`, 'already-exists')
      const loaded = loadIndex(ctx.dir)
      entries = loaded.entries
      if (entries.some((entry) => entry.id === id)) return fail(`文档已存在：${id}`, 'already-exists')
    }
    if (labelRes.value && !archived) {
      const clash = entries.find((entry) => entry.archived !== true && entry.enabled !== false && entry.projectLabel === labelRes.value)
      if (clash) return fail(`projectLabel「${labelRes.value}」已被 active 文档 ${clash.id} 使用；每个档案必须独立 label。`, 'duplicate-label')
    }

    const now = nowIso()
    const doc = {
      id,
      title: titleRes.value,
      description: descRes.value,
      tags: tagsRes.value,
      projectLabel: labelRes.value,
      enabled: src.enabled !== false,
      familyShared: false,
      created: now,
      updated: now,
      rev: 1,
      archived,
      ownerSessionId: owner.value,
      chars: String(bodyRes.value || '').trim().length,
    }
    const target = archived ? path.join(ctx.dir, ARCHIVE_DIR, `${id}.md`) : path.join(ctx.dir, `${id}.md`)
    atomicWrite(target, serializeDoc(doc, bodyRes.value))
    writeIndex(ctx.dir, sortEntries([doc, ...entries]))
    return { ok: true, id, doc, path: target }
  } catch (err) {
    return crash(err)
  }
}

function generateId() {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------- 导出：读取

/** 读取单篇文档（含 archive/）。frontmatter 损坏时返回错误，不做猜测。 */
export function readDoc(cwd, sessionName, id) {
  try {
    const ctx = resolveDocsDir(cwd, sessionName)
    if (!ctx.ok) return ctx
    const idRes = checkId(id)
    if (!idRes.ok) return idRes
    const found = locateDoc(ctx.dir, idRes.value)
    if (!found) return fail(`文档不存在：${idRes.value}`, 'not-found')

    let raw
    let stat
    try {
      raw = fs.readFileSync(found.file, 'utf8')
      stat = fs.statSync(found.file)
    } catch (err) {
      return crash(err)
    }
    const parsed = parseDocText(raw)
    if (parsed.bad) return fail(`frontmatter 损坏，无法读取：${found.relative}`, 'bad-frontmatter')

    const warnings = []
    const fm = parsed.frontmatter
    if (typeof fm.id === 'string' && fm.id && fm.id !== idRes.value) {
      warnings.push(`frontmatter id（${fm.id}）与文件名（${idRes.value}）不一致，以文件名为准`)
    }
    const doc = currentMeta(null, fm, idRes.value, found.archived, stat ? stat.mtimeMs : undefined)
    if (!doc) return fail(`元数据无法解析：${found.relative}`, 'bad-frontmatter')
    return { ok: true, id: doc.id, doc, body: parsed.body, path: found.file, warnings }
  } catch (err) {
    return crash(err)
  }
}

// ---------------------------------------------------------------- 导出：更新

/** 更新文档：必须带旧 rev；owner 不符或 rev 不符时不落盘。 */
export function outlineDoc(cwd, sessionName, id) {
  const r = readDoc(cwd, sessionName, id)
  if (!r.ok) return r
  const sections = splitDocSections(r.body || '').map((s) => ({
    heading: s.heading,
    offset: s.offset,
    chars: s.chars,
  }))
  return { ok: true, id: r.id, title: r.doc?.title || '', sections }
}

export function updateDoc(cwd, sessionName, ownerSessionId, id, input) {
  try {
    const ctx = resolveDocsDir(cwd, sessionName)
    if (!ctx.ok) return ctx
    const owner = checkOwner(ownerSessionId)
    if (!owner.ok) return owner
    const idRes = checkId(id)
    if (!idRes.ok) return idRes
    if (input == null || typeof input !== 'object' || Array.isArray(input)) {
      return fail('input 必须是对象（至少包含 rev）', 'invalid-input')
    }
    if (!fs.existsSync(ctx.dir)) return fail(`文档不存在：${idRes.value}`, 'not-found')

    const loaded = loadIndex(ctx.dir)
    const entry = loaded.entries.find((item) => item.id === idRes.value)
    const found = locateDoc(ctx.dir, idRes.value)
    if (!entry || !found) return fail(`文档不存在：${idRes.value}`, 'not-found')

    let raw
    let stat
    try {
      raw = fs.readFileSync(found.file, 'utf8')
      stat = fs.statSync(found.file)
    } catch (err) {
      return crash(err)
    }
    const parsed = parseDocText(raw)
    if (parsed.bad) return fail(`frontmatter 损坏，拒绝更新：${found.relative}`, 'bad-frontmatter')
    const current = currentMeta(entry, parsed.frontmatter, idRes.value, found.archived, stat.mtimeMs)
    if (!current) return fail(`元数据无法解析，拒绝更新：${found.relative}`, 'bad-frontmatter')

    if (!current.ownerSessionId) {
      return fail('文档没有记录 ownerSessionId，拒绝写入（请先修复 frontmatter 或重建索引）', 'forbidden')
    }
    if (current.ownerSessionId !== owner.value) {
      return fail(`无权限：文档属于会话 ${current.ownerSessionId}，当前为 ${owner.value}`, 'forbidden')
    }

    if (!Number.isInteger(input.rev)) return fail('更新必须带旧 rev（整数）', 'invalid-rev')
    if (input.rev !== current.rev) {
      return {
        ok: false,
        conflict: true,
        rev: current.rev,
        code: 'conflict',
        error: `rev 冲突：期望 rev ${current.rev}，收到 ${input.rev}`,
      }
    }

    const next = { ...current, updated: nowIso(), rev: current.rev + 1 }
    if (input.title !== undefined) {
      const titleRes = checkText(input.title, { field: 'title', max: MAX_TITLE_CHARS, required: true })
      if (!titleRes.ok) return titleRes
      next.title = titleRes.value
    }
    if (input.description !== undefined) {
      const descRes = checkText(input.description, { field: 'description', max: MAX_DESCRIPTION_CHARS })
      if (!descRes.ok) return descRes
      next.description = descRes.value
    }
    if (input.body !== undefined) {
      const bodyRes = checkText(input.body, { field: 'body', max: MAX_BODY_CHARS })
      if (!bodyRes.ok) return bodyRes
      next._body = bodyRes.value
    }
    if (input.tags !== undefined) {
      const tagsRes = normalizeTags(input.tags)
      if (!tagsRes.ok) return tagsRes
      next.tags = tagsRes.value
    }
    if (input.projectLabel !== undefined) {
      const labelRes = normalizeProjectLabel(input.projectLabel)
      if (!labelRes.ok) return labelRes
      next.projectLabel = labelRes.value
    }
    if (input.archived !== undefined) {
      if (typeof input.archived !== 'boolean') return fail('archived 必须是布尔值', 'invalid-input')
      next.archived = input.archived
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') return fail('enabled 必须是布尔值', 'invalid-input')
      next.enabled = input.enabled
    }
    if (input.familyShared !== undefined) {
      if (typeof input.familyShared !== 'boolean') return fail('familyShared 必须是布尔值', 'invalid-input')
      next.familyShared = input.familyShared
    }
    // 归档 = 默认停用；避免“启用中的档案直接归档”造成注入/绑定状态不一致。
    if (next.archived === true && input.enabled === undefined) next.enabled = false
    if (next.projectLabel && next.archived !== true && next.enabled !== false) {
      const clash = loaded.entries.find((item) => item.id !== idRes.value && item.archived !== true && item.enabled !== false && item.projectLabel === next.projectLabel)
      if (clash) return fail(`projectLabel「${next.projectLabel}」已被 active 文档 ${clash.id} 使用；每个档案必须独立 label。`, 'duplicate-label')
    }
    const body = next._body !== undefined ? next._body : parsed.body
    delete next._body
    next.chars = String(body || '').trim().length

    const targetArchived = next.archived === true
    const target = targetArchived
      ? path.join(ctx.dir, ARCHIVE_DIR, `${idRes.value}.md`)
      : path.join(ctx.dir, `${idRes.value}.md`)

    try {
      backupDoc(ctx.dir, idRes.value, found.file, current.rev)
    } catch (err) {
      return fail(`备份旧正文失败，已中止更新：${String(err && err.message ? err.message : err)}`, 'io')
    }

    atomicWrite(target, serializeDoc(next, body))
    if (path.resolve(target) !== path.resolve(found.file)) {
      try { fs.unlinkSync(found.file) } catch { /* 旧文件可能已不在 */ }
    }
    const entries = loaded.entries.map((item) => (item.id === idRes.value ? next : item))
    writeIndex(ctx.dir, sortEntries(entries))
    return { ok: true, id: idRes.value, doc: next, path: target, warnings: loaded.warnings }
  } catch (err) {
    return crash(err)
  }
}

// ---------------------------------------------------------------- 导出：软删

/** 软删除：正文移入 .trash/ 并从索引移除；之后 readDoc 不可见。 */
export function removeDoc(cwd, sessionName, ownerSessionId, id) {
  try {
    const ctx = resolveDocsDir(cwd, sessionName)
    if (!ctx.ok) return ctx
    const owner = checkOwner(ownerSessionId)
    if (!owner.ok) return owner
    const idRes = checkId(id)
    if (!idRes.ok) return idRes
    if (!fs.existsSync(ctx.dir)) return fail(`文档不存在：${idRes.value}`, 'not-found')

    const loaded = loadIndex(ctx.dir)
    const entry = loaded.entries.find((item) => item.id === idRes.value)
    const found = locateDoc(ctx.dir, idRes.value)
    if (!entry || !found) return fail(`文档不存在：${idRes.value}`, 'not-found')
    if (entry.archived !== true) {
      return fail('项目档案未归档，不能删除；请先归档，再删除。', 'must-archive-before-delete')
    }

    let storedOwner = (entry.ownerSessionId || '').trim()
    if (!storedOwner) {
      try {
        const parsed = parseDocText(fs.readFileSync(found.file, 'utf8'))
        if (!parsed.bad && typeof parsed.frontmatter.ownerSessionId === 'string') {
          storedOwner = parsed.frontmatter.ownerSessionId.trim()
        }
      } catch { /* 读不到就按无 owner 处理 */ }
    }
    if (!storedOwner) return fail('文档没有记录 ownerSessionId，拒绝删除', 'forbidden')
    if (storedOwner !== owner.value) {
      return fail(`无权限：文档属于会话 ${storedOwner}，当前为 ${owner.value}`, 'forbidden')
    }

    const trashDir = path.join(ctx.dir, TRASH_DIR)
    fs.mkdirSync(trashDir, { recursive: true })
    const trashedPath = path.join(trashDir, `${idRes.value}~${Date.now()}.md`)
    try {
      renameWithRetry(found.file, trashedPath)
    } catch {
      fs.copyFileSync(found.file, trashedPath)
      fs.unlinkSync(found.file)
    }

    writeIndex(ctx.dir, sortEntries(loaded.entries.filter((item) => item.id !== idRes.value)))
    const trashPruned = pruneTrash(trashDir)
    return { ok: true, id: idRes.value, trashed: true, trashedPath, trashPruned, warnings: loaded.warnings }
  } catch (err) {
    return crash(err)
  }
}

// ---------------------------------------------------------------- 导出：列表

/** 按 updated 倒序分页列出元数据（默认不含归档）。 */
export function listDocs(cwd, sessionName, opts) {
  try {
    const ctx = resolveDocsDir(cwd, sessionName)
    if (!ctx.ok) return ctx
    const options = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {}
    const limit = clampInt(options.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT)
    const offset = clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)
    if (!fs.existsSync(ctx.dir)) {
      return { ok: true, total: 0, limit, offset, items: [], warnings: [] }
    }

    const loaded = loadIndex(ctx.dir)
    let entries = loaded.entries
    if (options.includeArchived !== true) entries = entries.filter((entry) => !entry.archived)

    const tagFilter = typeof options.tag === 'string' ? options.tag.trim().toLowerCase() : ''
    if (tagFilter) entries = entries.filter((entry) => entry.tags.some((tag) => tag.toLowerCase() === tagFilter))
    const labelFilter = typeof options.projectLabel === 'string' ? options.projectLabel.trim().toLowerCase() : ''
    if (labelFilter) entries = entries.filter((entry) => entry.projectLabel.toLowerCase() === labelFilter)

    // 已归档沉底；同组按 updated 倒序，未归档的最新在前。
    entries = [...entries].sort((a, b) => {
      const aa = a.archived ? 1 : 0
      const bb = b.archived ? 1 : 0
      if (aa !== bb) return aa - bb
      return (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0)
    })

    const total = entries.length
    const items = entries.slice(offset, offset + limit).map((entry) => ({ ...entry }))
    return { ok: true, total, limit, offset, items, warnings: loaded.warnings }
  } catch (err) {
    return crash(err)
  }
}

// ---------------------------------------------------------------- 导出：搜索

function countOccurrences(haystack, token) {
  let count = 0
  let from = 0
  while (count < MAX_SCORE_OCCURRENCES) {
    const at = haystack.indexOf(token, from)
    if (at < 0) break
    count++
    from = at + token.length
  }
  return count
}

/** 有界片段：围绕首个命中点截取，折叠空白，长度不超过 MAX_SNIPPET_CHARS。 */
function makeSnippet(text, tokens) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!source) return ''
  const lower = source.toLowerCase()
  let at = -1
  for (const token of tokens) {
    const hit = lower.indexOf(token)
    if (hit >= 0 && (at < 0 || hit < at)) at = hit
  }
  let out
  if (at < 0) {
    out = source.slice(0, MAX_SNIPPET_CHARS)
  } else {
    const start = Math.max(0, at - SNIPPET_RADIUS)
    const end = Math.min(source.length, at + SNIPPET_RADIUS * 2)
    out = `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`
  }
  if (out.length > MAX_SNIPPET_CHARS) out = `${out.slice(0, MAX_SNIPPET_CHARS - 1)}…`
  return out
}

/** 按 Markdown 标题切 section；没有标题就整篇一节。offset 相对正文。 */
function splitDocSections(body) {
  const text = String(body ?? '')
  const re = /^(#{1,6})\s+(.+)$/gm
  const sections = []
  let last = 0
  let heading = '开头'
  let match
  const push = (start, end) => {
    if (end <= start) return
    const raw = text.slice(start, end)
    if (!raw.trim()) return
    sections.push({
      heading,
      offset: start,
      chars: end - start,
      text: raw,
    })
  }
  while ((match = re.exec(text)) !== null) {
    push(last, match.index)
    heading = String(match[2] || '').trim() || '未命名小节'
    last = match.index
  }
  push(last, text.length)
  if (sections.length === 0) sections.push({ heading: '正文', offset: 0, chars: text.length, text })
  return sections
}

function sectionHits(sections, tokens) {
  const hits = []
  for (const section of sections) {
    const lower = section.text.toLowerCase()
    let score = 0
    for (const token of tokens) score += countOccurrences(lower, token)
    if (score <= 0) continue
    hits.push({
      heading: section.heading,
      offset: section.offset,
      chars: section.chars,
      snippet: makeSnippet(section.text, tokens),
      score,
    })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, 3)
}

/** 关键词搜索：标题/描述/tags/正文，多词按 AND；默认不含归档；返回有界片段。 */
export function searchDocs(cwd, sessionName, query, opts) {
  try {
    const ctx = resolveDocsDir(cwd, sessionName)
    if (!ctx.ok) return ctx
    if (typeof query !== 'string' || !query.trim()) return fail('搜索关键词不能为空', 'invalid-query')
    const options = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {}
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const limit = clampInt(options.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT)
    const offset = clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)
    // 纯符号查询不进入 catalog 兜底，否则 total 为 0 却仍列出无关档案。
    if (!/[\p{L}\p{N}]/u.test(query)) {
      return { ok: true, query, tokens: [], total: 0, limit, offset, matchLevel: 'none', items: [], catalog: [], warnings: [] }
    }
    if (!fs.existsSync(ctx.dir)) {
      return { ok: true, query, tokens, total: 0, limit, offset, items: [], warnings: [] }
    }

    const loaded = loadIndex(ctx.dir)
    const warnings = [...loaded.warnings]
    const tagFilter = typeof options.tag === 'string' ? options.tag.trim().toLowerCase() : ''
    const labelFilter = typeof options.projectLabel === 'string' ? options.projectLabel.trim().toLowerCase() : ''
    const candidates = loaded.entries.filter((entry) => {
      if (options.includeArchived !== true && entry.archived) return false
      if (tagFilter && !entry.tags.some((tag) => tag.toLowerCase() === tagFilter)) return false
      if (labelFilter && entry.projectLabel.toLowerCase() !== labelFilter) return false
      return true
    })
    const docs = []
    for (const entry of candidates) {
      const found = locateDoc(ctx.dir, entry.id)
      if (!found) {
        warnings.push(`文档文件缺失，搜索跳过：${entry.id}`)
        continue
      }
      let raw
      let stat
      try {
        raw = fs.readFileSync(found.file, 'utf8')
        stat = fs.statSync(found.file)
      } catch {
        warnings.push(`读取失败，搜索跳过：${found.relative}`)
        continue
      }
      const parsed = parseDocText(raw)
      if (parsed.bad) {
        warnings.push(`frontmatter 损坏，搜索跳过：${found.relative}`)
        continue
      }
      const meta = currentMeta(entry, parsed.frontmatter, entry.id, found.archived, stat.mtimeMs) || coerceEntry(entry, entry.id)
      if (!meta) continue
      docs.push({
        meta,
        body: String(parsed.body || ''),
        sections: splitDocSections(parsed.body || ''),
      })
    }

    const evaluate = (mode) => {
      const out = []
      for (const doc of docs) {
        const title = doc.meta.title.toLowerCase()
        const description = doc.meta.description.toLowerCase()
        const tags = [...doc.meta.tags, doc.meta.projectLabel].join(' ').toLowerCase()
        const body = doc.body.toLowerCase()
        let score = 0
        let hitCount = 0
        for (const token of tokens) {
          let hit = false
          const th = countOccurrences(title, token)
          if (th) { score += 5 * th; hit = true }
          const gh = countOccurrences(tags, token)
          if (gh) { score += 3 * gh; hit = true }
          const dh = countOccurrences(description, token)
          if (dh) { score += 2 * dh; hit = true }
          if (mode !== 'metadata') {
            const bh = countOccurrences(body, token)
            if (bh) { score += bh; hit = true }
          }
          if (hit) hitCount++
        }
        const needAll = mode === 'exact'
        if (needAll ? hitCount !== tokens.length : hitCount === 0) continue
        const sections = mode === 'metadata' ? [] : sectionHits(doc.sections, tokens)
        out.push({
          entry: doc.meta,
          score: score + sections.reduce((n, s) => n + s.score, 0),
          matchLevel: mode,
          snippet: mode === 'metadata'
            ? makeSnippet(`${doc.meta.description || ''} ${doc.meta.title || ''}`, tokens)
            : (sections[0]?.snippet || makeSnippet(doc.body || doc.meta.description, tokens)),
          sections,
        })
      }
      out.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return (Date.parse(b.entry.updated) || 0) - (Date.parse(a.entry.updated) || 0)
      })
      return out
    }

    let matchLevel = 'exact'
    let matches = evaluate('exact')
    if (matches.length === 0) { matchLevel = 'partial'; matches = evaluate('partial') }
    if (matches.length === 0) { matchLevel = 'metadata'; matches = evaluate('metadata') }
    if (matches.length === 0) matchLevel = 'none'

    const total = matches.length
    const items = matches.slice(offset, offset + limit).map(({ entry, score, matchLevel: level, snippet, sections }) => ({
      ...entry, score, matchLevel: level, snippet, sections,
    }))
    let catalog = []
    if (matches.length === 0) {
      matchLevel = docs.length ? 'catalog' : 'none'
      catalog = [...docs]
        .sort((a, b) => (Date.parse(b.meta.updated) || 0) - (Date.parse(a.meta.updated) || 0))
        .slice(0, 5)
        .map((d) => ({
          id: d.meta.id,
          title: d.meta.title,
          description: d.meta.description,
          tags: d.meta.tags,
          projectLabel: d.meta.projectLabel,
          updated: d.meta.updated,
          rev: d.meta.rev,
          archived: d.meta.archived,
        }))
    }
    return { ok: true, query, tokens, matchLevel, total, limit, offset, items, catalog, warnings }
  } catch (err) {
    return crash(err)
  }
}
