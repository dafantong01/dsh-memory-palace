import fs from 'node:fs'
import path from 'node:path'
import { resolveSessionLog } from './archive.js'

/**
 * 找会话所属工作区：优先活跃 agent，否则从会话日志头部的 session 事件里读。
 * 非活跃会话也要能改配置，所以不能只依赖 ctx.agents。
 * 日志扫描走 index.js 的 scanSessionLog（带 mtime+size 缓存），避免页签一次 GET 解压两遍。
 */
async function resolveTarget(ctx, sessionId, logScan) {
  const agent = sessionId ? ctx.agents?.get?.(sessionId) : undefined
  const liveCwd = String(agent?.session?.header?.cwd ?? '')
  if (liveCwd) return { agent, cwd: liveCwd, win: null }
  const logPath = sessionId ? resolveSessionLog(sessionId) : null
  if (!logPath) return { agent: undefined, cwd: '', win: null }
  try {
    const scan = typeof logScan === 'function' ? await logScan(logPath) : { cwd: '', win: null }
    return { agent: undefined, cwd: scan.cwd || '', win: scan.win ?? null }
  } catch {
    return { agent: undefined, cwd: '', win: null }
  }
}

/** 读取请求体（上限 64 KB）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    let done = false
    const fail = (err) => { if (!done) { done = true; reject(err) } }
    req.on('data', (c) => {
      if (done) return
      body += String(c)
      if (body.length > 65536) fail(new Error('body too large'))
    })
    req.on('end', () => {
      if (done) return
      done = true
      try { resolve(body ? JSON.parse(body) : {}) } catch { reject(new Error('invalid JSON')) }
    })
    req.on('error', fail)
  })
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** 归档总量：索引里的行数与字节数（只统计，不清理）。 */
function stripBom(s) {
  return String(s ?? '').replace(/^\uFEFF/, '')
}

function archiveTotals(dir) {
  const idx = path.join(dir, 'index.jsonl')
  if (!fs.existsSync(idx)) return { count: 0, bytes: 0 }
  let count = 0
  let bytes = 0
  for (const line of stripBom(fs.readFileSync(idx, 'utf8')).split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      count += 1
      bytes += Number(r.bytes) || 0
    } catch { /* ignore */ }
  }
  return { count, bytes }
}

/** 最近 20 条归档索引。 */
function recentArchives(dir, limit = 20) {
  const idx = path.join(dir, 'index.jsonl')
  if (!fs.existsSync(idx)) return []
  const lines = stripBom(fs.readFileSync(idx, 'utf8')).trim().split('\n').slice(-limit)
  const out = []
  for (const line of lines) {
    try { out.push(JSON.parse(line)) } catch { /* ignore */ }
  }
  return out.reverse()
}

/**
 * /api/memory-palace
 *   GET  ?sessionId=...            读状态 + 最近归档
 *   POST { sessionId, action, values }  切开关 / 改阈值
 */
export function createMemoryPalaceRoute({ ctx, read, resolveConfig, readState, writeState, effectiveWindow, turnStats, archive, requestArchive, ns, getEvents, gateState, logScan, log }) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      // 两段式：默认返回“轻量视图”（不含统计、不解码日志），页签先秒开；
      // 客户端随后用 stats=1 再请求一次异步补统计。
      const wantsStats = url.searchParams.get('stats') === '1'
      if (req.method === 'GET') {
        const target = await resolveTarget(ctx, sessionId, logScan)
        const { agent, cwd } = target
        if (!cwd) return json(res, 404, { error: 'session not found' })
        const cfg = resolveConfig(read, cwd, sessionId)
        const nsDir = cfg.dir || path.join(cwd, cfg.rootDirName)
        const win = wantsStats
          ? ((agent && effectiveWindow ? await effectiveWindow(agent, cfg) : target.win) || cfg.contextWindowTokens)
          : cfg.contextWindowTokens
        const state = readState(cwd, cfg.rootDirName, sessionId)
        const s = state[sessionId] ?? {}
        const stats = wantsStats && turnStats ? await turnStats(sessionId, cwd, cfg) : null
        return json(res, 200, {
          partial: !wantsStats,
          workspace: cwd,
          sessionId,
          name: cfg.name || '',
          folder: cfg.folder,
          nsLabel: `${cfg.rootDirName}/${cfg.folder}`,
          enabled: cfg.enabled,
          sessionEnabled: cfg.sessionEnabled,
          active: Boolean(cfg.enabled && cfg.sessionEnabled && cfg.name),
          triggerPressure: cfg.triggerPressure,
          contextWindowTokens: win,
          contextWindowSource: 'auto',
          checkEveryTurns: cfg.checkEveryTurns,
          minBatchTurns: cfg.minBatchTurns,
          retainBytes: cfg.retainBytes,
          retainFraction: cfg.retainFraction,
          batchByteFraction: cfg.batchByteFraction,
          retentionCapBytes: Math.round((win || 0) * (Number(cfg.retainFraction) || 0) * 3),
          retentionCapTokens: Math.round((win || 0) * (Number(cfg.retainFraction) || 0)),
          maxFileBytes: cfg.maxFileBytes,
          selfNameSlug: cfg.selfNameSlug,
          enableSteer: cfg.enableSteer,
          includeReasoning: cfg.includeReasoning,
          compactAfterArchive: cfg.compactAfterArchive === true,
          searchTurnLimit: cfg.searchTurnLimit,
          groupByTurn: cfg.groupByTurn !== false,
          injectNotice: cfg.injectNotice !== false,
          recallStrength: cfg.recallStrength,
          recursionMaxDepth: cfg.recursionMaxDepth,
          recursionMaxWidth: cfg.recursionMaxWidth,
          recallBudgetRounds: cfg.recallBudgetRounds,
          recallBudgetKeywords: cfg.recallBudgetKeywords,
          recallPolicyText: (() => {
            const d = Math.min(Math.max(Number(cfg.recursionMaxDepth) || 1, 1), 5)
            const w = Math.min(Math.max(Number(cfg.recursionMaxWidth) || 1, 1), 5)
            switch (cfg.recallStrength) {
              case 'off': return '只归档，不读记忆；不注入任何回忆提示'
              case 'medium': return '摘要→检索→原文；启动后首条消息先读最近摘要；不递归'
              case 'high': return `同中，允许主动递归（≤${d} 轮、每轮 ≤${w} 个关键词）`
              case 'forced': return `每条消息后强制检索并简短回报；无归档则如实说没有记录（递归 ≤${d} 轮、每轮 ≤${w} 个关键词）`
              default: return '先读摘要，必要时再读原文；不递归、无额外注入'
            }
          })(),
          enableSteer: cfg.enableSteer !== false,
          events: typeof getEvents === 'function' ? getEvents() : [],
          gate: typeof gateState === 'function' ? gateState(cfg) : null,
          rootDirName: cfg.rootDirName,
          lastCheckTurn: s.lastCheckTurn ?? null,
          lastCheckAt: s.lastCheckAt ?? null,
          lastPressure: s.lastPressure ?? null,
          lastPressureSource: s.lastPressureSource ?? null,
          lastArchiveRange: s.lastArchiveRange ?? null,
          lastArchiveAt: s.lastArchiveAt ?? null,
          archivedThroughTurn: s.archivedThroughTurn ?? 0,
          stats,
          archives: recentArchives(nsDir),
          totals: archiveTotals(nsDir),
        })
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        const sid = String(body.sessionId ?? '')
        const { cwd } = await resolveTarget(ctx, sid, logScan)
        if (!cwd) return json(res, 404, { error: 'session not found' })
        const cfg = resolveConfig(read, cwd, sid)
        const nsDir0 = cfg.dir || path.join(cwd, cfg.rootDirName)
        if (body.action === 'archive') {
          const cat = String(body.category ?? '').trim()
          if (!cat) {
            if (typeof requestArchive !== 'function') return json(res, 400, { error: '手动归档不可用' })
            const text = await requestArchive({ cwd, sessionId: sid })
            return json(res, 200, { ok: true, message: String(text ?? '') })
          }
          if (typeof archive !== 'function') return json(res, 400, { error: '归档执行器不可用' })
          if (!/^[a-z][a-z0-9-]{1,63}$/.test(cat)) return json(res, 400, { error: '类别必须是英文小写 slug' })
          const text = await archive({
            cwd, sessionId: sid, category: cat,
            fromTurn: Number.isFinite(body.fromTurn) ? Number(body.fromTurn) : undefined,
            toTurn: Number.isFinite(body.toTurn) ? Number(body.toTurn) : undefined,
          })
          return json(res, 200, { ok: true, message: String(text ?? '') })
        }
        const file = path.join(nsDir0, 'config.json')
        let prev = {}
        try { prev = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { prev = {} }
        let pendingName

        if (body.action === 'on' || body.action === 'off') {
          prev.enabled = body.action === 'on'
        } else if (body.action === 'set') {
          const values = body.values ?? {}
          const numeric = ['retainBytes', 'maxFileBytes', 'checkEveryTurns', 'minBatchTurns']
          for (const [k, v] of Object.entries(values)) {
            // 废弃字段：旧页面仍可能带着它提交，静默忽略，不报错、也不写回。
            if (k === 'retainTurns') continue
            if (k === 'name') { pendingName = String(v ?? ''); continue }
            if (k === 'enabled' || k === 'enableSteer' || k === 'includeReasoning' || k === 'compactAfterArchive' || k === 'injectNotice' || k === 'groupByTurn') {
              prev[k] = Boolean(v)
            } else if (k === 'searchTurnLimit') {
              const n = Number(v)
              if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error('searchTurnLimit 必须是 1–30 的整数')
              prev[k] = n
            } else if (k === 'recallStrength') {
              const allowed = ['off', 'low', 'medium', 'high', 'forced']
              const s = String(v)
              if (!allowed.includes(s)) throw new Error('recallStrength 必须是 off / low / medium / high / forced')
              prev[k] = s
            } else if (k === 'recursionMaxDepth' || k === 'recursionMaxWidth') {
              const n = Number(v)
              if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`${k} 必须是 1–5 的整数`)
              prev[k] = n
            } else if (k === 'retainFraction') {
              const n = Number(v)
              if (!(n >= 0.02 && n <= 0.5)) throw new Error('retainFraction 必须在 0.02–0.5')
              prev[k] = n
            } else if (k === 'batchByteFraction') {
              const n = Number(v)
              if (!(n >= 0.05 && n <= 1)) throw new Error('batchByteFraction 必须在 0.05–1')
              prev[k] = n
            } else if (k === 'triggerPressure') {
              const n = Number(v)
              if (!(n >= 0.2 && n <= 0.95)) throw new Error('triggerPressure 必须在 0.2–0.95')
              prev[k] = n
            } else if (k === 'selfNameSlug') {
              const sv = String(v)
              if (!/^[a-z][a-z0-9-]{1,63}$/.test(sv)) throw new Error('selfNameSlug 必须是英文小写 slug')
              prev[k] = sv
            } else if (k === 'contextWindowTokens') {
              throw new Error(k + ' 由插件固定/自动探测，不允许手动修改。')
            } else if (numeric.includes(k)) {
              const n = Number(v)
              if (!Number.isFinite(n) || n < 0) throw new Error(`${k} 必须是非负数字`)
              prev[k] = Math.floor(n)
            } else {
              throw new Error(`不允许修改的键：${k}`)
            }
          }
        } else {
          return json(res, 400, { error: 'unknown action' })
        }

        // 废弃键：任何一次写配置都顺手清掉，旧配置会自然收敛。
        delete prev.retainTurns

        // 命名：新名字 = 文件夹名；空名字 = 用会话ID。改名要防抢占。
        let dir = nsDir0
        let folder = cfg.folder
        if (pendingName !== undefined) {
          if (!ns || typeof ns.sanitizeName !== 'function') throw new Error('命名功能不可用')
          const checked = ns.sanitizeName(pendingName)
          if (!checked.ok) throw new Error(checked.error)
          const nextFolder = checked.name || sid
          const target = path.join(cwd, cfg.rootDirName, nextFolder)
          const map = ns.loadNsMap(cwd, cfg.rootDirName)
          for (const [otherSid, otherFolder] of Object.entries(map)) {
            if (otherSid === sid) continue
            if (String(otherFolder).toLowerCase() === nextFolder.toLowerCase()) {
              throw new Error(`名字「${nextFolder}」已被本工作区另一个会话占用，换一个`)
            }
          }
          if (nextFolder !== cfg.folder) {
            if (fs.existsSync(target)) throw new Error(`文件夹「${nextFolder}」已存在（可能是别的会话留下的），换一个名字`)
            fs.mkdirSync(path.dirname(target), { recursive: true })
            if (fs.existsSync(dir)) fs.renameSync(dir, target)
            else fs.mkdirSync(target, { recursive: true })
            map[sid] = nextFolder
            ns.saveNsMap(cwd, cfg.rootDirName, map)
            dir = target
            folder = nextFolder
          }
          prev.name = checked.name
        }

        fs.mkdirSync(dir, { recursive: true })
        const filePath = path.join(dir, 'config.json')
        const tmp = `${filePath}.tmp-${process.pid}`
        fs.writeFileSync(tmp, JSON.stringify(prev, null, 2), 'utf8')
        fs.renameSync(tmp, filePath)
        return json(res, 200, { ok: true, workspace: cwd, name: prev.name ?? '', folder, config: prev })
      }
      return json(res, 405, { error: 'method not allowed' })
    } catch (err) {
      log?.('route error: ' + (err?.message ?? String(err)))
      return json(res, 400, { error: String(err?.message ?? err) })
    }
  }
}

export const MEMORY_PALACE_ROUTE = '/memory-palace-api'
