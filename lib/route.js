import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSessionLog } from './archive.js'

function hasAnyMarkdown(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) return true
      if (e.isDirectory() && hasAnyMarkdown(path.join(dir, e.name))) return true
    }
  } catch { /* missing directory */ }
  return false
}

function packageVersion() {
  try {
    const p = fileURLToPath(new URL('../package.json', import.meta.url))
    return JSON.parse(fs.readFileSync(p, 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function compareSemver(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((x) => Number(x) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

const PKG_NAME = '@dafantong01/dsh-memory-palace'
const UPDATE_TTL_MS = 10 * 60 * 1000
let updateCache = { at: 0, value: null }

async function checkUpdate(force = false) {
  if (!force && updateCache.value && Date.now() - updateCache.at < UPDATE_TTL_MS) return updateCache.value
  const currentVersion = packageVersion()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch('https://registry.npmjs.org/%40dafantong01%2Fdsh-memory-palace/latest', {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`npm registry HTTP ${res.status}`)
    const data = await res.json()
    const latestVersion = typeof data?.version === 'string' ? data.version : currentVersion
    const value = { ok: true, currentVersion, latestVersion, hasUpdate: compareSemver(latestVersion, currentVersion) > 0 }
    updateCache = { at: Date.now(), value }
    return value
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), currentVersion, latestVersion: currentVersion, hasUpdate: false }
  } finally {
    clearTimeout(timer)
  }
}

async function installUpdate(ctx, version) {
  const pm = ctx?.get?.('pluginManager') || ctx?.get?.('plugin-manager')
  if (!pm || typeof pm.installBundle !== 'function') {
    return { ok: false, code: 'unavailable', error: '宿主没有 pluginManager.installBundle；请用插件市场或 dsh plugin add 更新。' }
  }
  const check = await checkUpdate()
  const target = String(version || check.latestVersion || '').trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(target)) return { ok: false, code: 'invalid-version', error: `版本号不合法：${target || '(空)'}` }
  const currentVersion = packageVersion()
  if (compareSemver(target, currentVersion) <= 0) return { ok: false, code: 'not-newer', error: `目标版本 ${target} 不高于当前 ${currentVersion}` }
  try {
    const result = await pm.installBundle(`${PKG_NAME}@${target}`)
    updateCache = { at: 0, value: null }
    return { ok: true, currentVersion, version: target, application: 'restart-required', result }
  } catch (err) {
    return { ok: false, code: 'install-failed', error: String(err?.message ?? err) }
  }
}

/**
 * 找会话所属工作区：优先活跃 agent，否则从会话日志头部的 session 事件里读。
 * 非活跃会话也要能改配置，所以不能只依赖 ctx.agents。
 * 日志扫描走 index.js 的 scanSessionLog（带 mtime+size 缓存），避免页签一次 GET 解压两遍。
 */
async function resolveTarget(ctx, sessionId, logScan, peekSessionCwd) {
  const agent = sessionId ? ctx.agents?.get?.(sessionId) : undefined
  const liveCwd = String(agent?.session?.header?.cwd ?? '')
  if (liveCwd) return { agent, cwd: liveCwd, win: null }
  const logPath = sessionId ? resolveSessionLog(sessionId) : null
  if (!logPath) return { agent: undefined, cwd: '', win: null }
  // 启动快路径：只读日志头部的 session 事件，避免为了 cwd 全量解压大日志。
  if (typeof peekSessionCwd === 'function') {
    const fastCwd = await peekSessionCwd(logPath)
    if (fastCwd) return { agent: undefined, cwd: fastCwd, win: null }
  }
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
    req.setEncoding('utf8')
    let body = ''
    let bytes = 0
    let done = false
    const fail = (err) => { if (!done) { done = true; reject(err) } }
    req.on('data', (c) => {
      if (done) return
      body += c
      bytes += Buffer.byteLength(c, 'utf8')
      if (bytes > 65536) fail(new Error('body too large'))
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
export function createMemoryPalaceRoute({ ctx, read, resolveConfig, readState, writeState, effectiveWindow, turnStats, peekSessionCwd, archive, requestArchive, ns, getEvents, gateState, logScan, log, coreDebug, coreList, coreWrite, coreRemove, coreMove, confirmToken, docsList, docsSearch, docsRead, docsCreate, docsUpdate, docsRemove, familyStatus, familyRoot, familyJoin, familyDetach, familyAbdicate, familyDissolve, familyTransfer, familyRebuild, familyCleanFormerCore, familyRenameFolder, corePending, coreInjectState, coreInjectPreview, ensureFork, ensureForkBySid, coreCandidates, coreCandidateAccept, coreCandidateDismiss, projectsList, projectSet }) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      // 两段式：默认返回“轻量视图”（不含统计、不解码日志），页签先秒开；
      // 客户端随后用 stats=1 再请求一次异步补统计。
      const wantsStats = url.searchParams.get('stats') === '1'
      const forceStats = url.searchParams.get('fresh') === '1'
      if (req.method === 'GET') {
        const action = url.searchParams.get('action')
        if (action === 'check-update') {
          return json(res, 200, await checkUpdate())
        }
        const target = await resolveTarget(ctx, sessionId, logScan, peekSessionCwd)
        const { agent, cwd } = target
        if (!cwd) return json(res, 404, { error: 'session not found' })
        if (typeof ensureFork === 'function') ensureFork(agent)
        if (typeof ensureForkBySid === 'function') await ensureForkBySid(cwd, sessionId)
        const cfg = resolveConfig(read, cwd, sessionId)
        if (action === 'core-debug') {
          if (typeof coreDebug !== 'function') return json(res, 501, { ok: false, error: 'core debug unavailable' })
          return json(res, 200, { ok: true, ...coreDebug(cwd, cfg) })
        }
        if (action === 'core-list') {
          if (typeof coreList !== 'function') return json(res, 501, { ok: false, error: 'core list unavailable' })
          const section = String(url.searchParams.get('section') || 'all')
          const r = coreList(cwd, cfg, section)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (action === 'docs-list') {
          if (typeof docsList !== 'function') return json(res, 501, { ok: false, error: 'docs list unavailable' })
          const r = docsList(cwd, cfg, {
            includeArchived: url.searchParams.get('includeArchived') === '1',
            limit: Number(url.searchParams.get('limit') || 50),
            offset: Number(url.searchParams.get('offset') || 0),
          })
          return json(res, r.ok ? 200 : 400, r)
        }
        if (action === 'docs-search') {
          if (typeof docsSearch !== 'function') return json(res, 501, { ok: false, error: 'docs search unavailable' })
          const r = docsSearch(cwd, cfg, String(url.searchParams.get('query') || ''), {
            includeArchived: url.searchParams.get('includeArchived') === '1',
            limit: Number(url.searchParams.get('limit') || 20),
            tag: url.searchParams.get('tag') || undefined,
            projectLabel: url.searchParams.get('projectLabel') || undefined,
          })
          return json(res, r.ok ? 200 : 400, r)
        }
        if (action === 'docs-read') {
          if (typeof docsRead !== 'function') return json(res, 501, { ok: false, error: 'docs read unavailable' })
          const r = docsRead(cwd, cfg, String(url.searchParams.get('id') || ''), {
            maxChars: url.searchParams.get('maxChars'),
            offset: url.searchParams.get('offset'),
          })
          return json(res, r.ok ? 200 : 404, r)
        }
        if (action === 'family-status') {
          if (typeof familyStatus !== 'function') return json(res, 501, { ok: false, error: 'family unavailable' })
          const r = familyStatus(cwd, sessionId)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (action === 'core-inject-state') {
          if (typeof coreInjectState !== 'function') return json(res, 501, { ok: false, error: 'core inject state unavailable' })
          return json(res, 200, coreInjectState(cwd, cfg, sessionId))
        }
        if (action === 'core-candidates') {
          if (typeof coreCandidates !== 'function') return json(res, 501, { ok: false, error: 'core candidates unavailable' })
          return json(res, 200, coreCandidates(cwd, cfg, sessionId))
        }
        if (action === 'projects-list') {
          if (typeof projectsList !== 'function') return json(res, 501, { ok: false, error: 'projects unavailable' })
          return json(res, 200, projectsList(cwd, cfg))
        }
        const nsDir = cfg.dir || path.join(cwd, cfg.rootDirName)
        const win = wantsStats
          ? ((agent && effectiveWindow ? await effectiveWindow(agent, cfg) : target.win) || cfg.contextWindowTokens)
          : cfg.contextWindowTokens
        const state = readState(cwd, cfg.rootDirName, sessionId)
        const s = state[sessionId] ?? {}
        const stats = wantsStats && turnStats ? await turnStats(sessionId, cwd, cfg, forceStats) : null
        return json(res, 200, {
          partial: !wantsStats,
          workspace: cwd,
          sessionId,
          name: cfg.name || '',
          folder: cfg.folder,
          nsMismatch: Boolean(cfg.nsMismatch),
          nsLabel: `${cfg.rootDirName}/${cfg.folder}`,
          enabled: cfg.enabled,
          globalEnabled: cfg.globalEnabled,
          sessionEnabled: cfg.sessionEnabled,
          active: Boolean(cfg.enabled && cfg.sessionEnabled && cfg.name),
          triggerPressure: cfg.triggerPressure,
          contextWindowTokens: win,
          contextWindowSource: 'auto',
          checkEveryTurns: cfg.checkEveryTurns,
          cacheVerifyEvery: cfg.cacheVerifyEvery,
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
          coreInjection: cfg.coreInjection,
          coreInjectionSetting: cfg.coreInjectionSetting || cfg.coreInjection,
          coreInjectionBudget: cfg.coreInjectionBudget,
          coreTierImportantTurns: cfg.coreTierImportantTurns,
          coreTierImportantTokens: cfg.coreTierImportantTokens,
          coreTierNormalTurns: cfg.coreTierNormalTurns,
          coreTierNormalTokens: cfg.coreTierNormalTokens,
          coreConfirmToken: confirmToken || '',
          familyId: cfg.familyId || '',
          familyRole: cfg.familyRole || 'independent',
          familyStatus: cfg.familyStatus || '',
          coreReadOnly: Boolean(cfg.coreReadOnly),
          coreFolder: cfg.coreFolder || '',
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
        // 本机 API 的写入口：只接受 JSON POST，并拒绝跨站来源，避免任意网页 CSRF 写入。
        const ct = String(req.headers['content-type'] ?? '').toLowerCase()
        if (!ct.startsWith('application/json')) {
          return json(res, 415, { error: 'content-type must be application/json' })
        }
        const origin = req.headers.origin
        if (origin) {
          try {
            const u = new URL(origin)
            if (u.host !== req.headers.host) return json(res, 403, { error: 'cross-origin request rejected' })
          } catch {
            return json(res, 403, { error: 'invalid origin' })
          }
        }
        const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
        if (site && site !== 'same-origin' && site !== 'none') {
          return json(res, 403, { error: 'cross-site request rejected' })
        }
        const body = await readBody(req)
        const sid = String(body.sessionId ?? '')
        const { agent, cwd } = await resolveTarget(ctx, sid, logScan, peekSessionCwd)
        const subHeader = agent?.session?.header ?? {}
        const isSubagent = Number(subHeader.delegationDepth ?? 0) > 0
          || Boolean(subHeader.parentSessionId)
          || subHeader.subagent === true
          || String(subHeader.id ?? '').startsWith('subagent-')
        if (!cwd) return json(res, 404, { error: 'session not found' })
        if (typeof ensureFork === 'function') ensureFork(agent)
        if (typeof ensureForkBySid === 'function') await ensureForkBySid(cwd, sid)
        const cfg = resolveConfig(read, cwd, sid)
        const nsDir0 = cfg.dir || path.join(cwd, cfg.rootDirName)
        if (body.action === 'perf-log') {
          try {
            const dir = path.join(cwd, cfg.rootDirName, cfg.folder || '_unassigned')
            fs.mkdirSync(dir, { recursive: true })
            fs.appendFileSync(path.join(dir, 'perf.jsonl'), JSON.stringify({
              at: new Date().toISOString(),
              sessionId: sid,
              event: String(body.event || ''),
              ms: Number(body.ms) || 0,
              detail: body.detail && typeof body.detail === 'object' ? body.detail : undefined,
            }) + '\n', 'utf8')
          } catch { /* 计时日志失败不影响页签 */ }
          return json(res, 200, { ok: true })
        }
        if (body.action === 'core-write') {
          if (typeof coreWrite !== 'function') return json(res, 501, { ok: false, error: 'core write unavailable' })
          const r = await coreWrite(cwd, cfg, { ...body, source: 'user' }, sid)
          return json(res, r.ok ? 200 : (r.code === 'conflict' ? 409 : 400), r)
        }
        if (body.action === 'core-inject-preview') {
          if (typeof coreInjectPreview !== 'function') return json(res, 501, { ok: false, error: 'core inject preview unavailable' })
          return json(res, 200, { ok: true, text: String(coreInjectPreview(cwd, cfg, sessionId) ?? '') })
        }
        if (body.action === 'core-candidate-accept') {
          if (typeof coreCandidateAccept !== 'function') return json(res, 501, { ok: false, error: 'candidate accept unavailable' })
          const r = coreCandidateAccept(cwd, cfg, sid, String(body.id || ''))
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'core-candidate-dismiss') {
          if (typeof coreCandidateDismiss !== 'function') return json(res, 501, { ok: false, error: 'candidate dismiss unavailable' })
          const r = coreCandidateDismiss(cwd, cfg, sid, String(body.id || ''))
          return json(res, 200, r)
        }
        if (body.action === 'projects-set') {
          if (typeof projectSet !== 'function') return json(res, 501, { ok: false, error: 'projects unavailable' })
          const r = projectSet(cwd, cfg, body.label, body.enabled !== false)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'core-move') {
          if (typeof coreMove !== 'function') return json(res, 501, { ok: false, error: 'core move unavailable' })
          const needsConfirm = body.from === 'rules'
          const confirmed = Boolean(confirmToken) && req.headers['x-memory-palace-confirm'] === confirmToken
          if (needsConfirm && !confirmed) {
            return json(res, 403, { ok: false, error: 'rules 的转移需要页签确认令牌；HTTP 直连不能绕过。' })
          }
          const r = await coreMove(cwd, cfg, body.id, body.from, body.to, needsConfirm && confirmed, sid)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'core-remove') {
          if (typeof coreRemove !== 'function') return json(res, 501, { ok: false, error: 'core remove unavailable' })
          const needsConfirm = body.board === 'rules' || String(body.id || '').startsWith('rules-')
          const confirmed = Boolean(confirmToken) && req.headers['x-memory-palace-confirm'] === confirmToken
          if (needsConfirm && !confirmed) {
            return json(res, 403, { ok: false, error: 'rules 删除需要页签确认令牌；HTTP 直连不能绕过。' })
          }
          const r = await coreRemove(cwd, cfg, body.id, body.board, needsConfirm && confirmed, sid)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'core-pending') {
          if (typeof corePending !== 'function') return json(res, 501, { ok: false, error: 'core pending unavailable' })
          const r = corePending(cwd, cfg, body.id, body.board)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'docs-create') {
          if (typeof docsCreate !== 'function') return json(res, 501, { ok: false, error: 'docs create unavailable' })
          const input = { ...body, body: body.content ?? body.body }
          const r = await docsCreate(cwd, cfg, sid, input)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'install-update') {
          const r = await installUpdate(ctx, body.version)
          return json(res, r.ok ? 200 : (r.code === 'unavailable' ? 501 : 400), r)
        }
        if (body.action === 'docs-update') {
          if (typeof docsUpdate !== 'function') return json(res, 501, { ok: false, error: 'docs update unavailable' })
          if (body.archived !== undefined) {
            const confirmed = Boolean(confirmToken) && req.headers['x-memory-palace-confirm'] === confirmToken
            if (!confirmed) return json(res, 403, { ok: false, error: '归档/取消归档需要页签确认令牌；HTTP 直连不能绕过。' })
          }
          const input = { ...body, body: body.content ?? body.body }
          const r = await docsUpdate(cwd, cfg, sid, body.id, input)
          return json(res, r.ok ? 200 : (r.conflict ? 409 : 400), r)
        }
        if (body.action === 'docs-remove') {
          if (typeof docsRemove !== 'function') return json(res, 501, { ok: false, error: 'docs remove unavailable' })
          const r = await docsRemove(cwd, cfg, sid, body.id)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action.startsWith('family-') && isSubagent) {
          return json(res, 403, { ok: false, error: '子智能体不能创建/加入/解散/选举家族。' })
        }
        if (body.action === 'family-root') {
          if (typeof familyRoot !== 'function') return json(res, 501, { ok: false, error: 'family unavailable' })
          const r = await familyRoot(cwd, cfg, sid)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'family-join') {
          if (typeof familyJoin !== 'function') return json(res, 501, { ok: false, error: 'family unavailable' })
          const r = await familyJoin(cwd, cfg, sid, String(body.rootSessionId || ''))
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'family-detach') {
          if (typeof familyDetach !== 'function') return json(res, 501, { ok: false, error: 'family unavailable' })
          const r = await familyDetach(cwd, cfg, sid, Boolean(body.copyMother))
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'family-abdicate') {
          if (typeof familyAbdicate !== 'function') return json(res, 501, { ok: false, error: 'family unavailable' })
          const r = await familyAbdicate(cwd, sid)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'family-rebuild') {
          if (typeof familyRebuild !== 'function') return json(res, 501, { ok: false, error: 'family rebuild unavailable' })
          const r = await familyRebuild(cwd, cfg, sid, String(body.decision || 'no'))
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'family-clean-former-core') {
          if (typeof familyCleanFormerCore !== 'function') return json(res, 501, { ok: false, error: 'family clean unavailable' })
          const r = await familyCleanFormerCore(cwd, cfg, sid)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'family-dissolve') {
          if (typeof familyDissolve !== 'function') return json(res, 501, { ok: false, error: 'family unavailable' })
          const r = await familyDissolve(cwd, sid)
          return json(res, r.ok ? 200 : 400, r)
        }
        if (body.action === 'family-transfer') {
          if (typeof familyTransfer !== 'function') return json(res, 501, { ok: false, error: 'family transfer unavailable' })
          const r = await familyTransfer(cwd, cfg, sid, String(body.newRootSessionId || ''), String(body.newRootName || ''))
          return json(res, r.ok ? 200 : 400, r)
        }
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
            } else if (k === 'coreInjection') {
              const s = String(v)
              if (!['off', 'on', 'test', 'inherit'].includes(s)) throw new Error('coreInjection 必须是 off / on / test / inherit')
              prev[k] = s
            } else if (k === 'coreInjectionBudget') {
              const n = Number(v)
              if (!(n >= 1000 && n <= 20000)) throw new Error('coreInjectionBudget 必须在 1000–20000')
              prev[k] = Math.floor(n)
            } else if (k === 'cacheVerifyEvery') {
              const n = Number(v)
              if (!Number.isInteger(n) || n < 10 || n > 100) throw new Error('cacheVerifyEvery 必须是 10–100 的整数')
              prev[k] = n
            } else if (['coreTierImportantTurns', 'coreTierImportantTokens', 'coreTierNormalTurns', 'coreTierNormalTokens'].includes(k)) {
              const n = Number(v)
              const max = k.endsWith('Tokens') ? 500000 : 200
              if (!(n >= 1 && n <= max)) throw new Error(`${k} 必须在 1–${max}`)
              prev[k] = Math.floor(n)
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
            if (String(otherFolder).toLowerCase() !== nextFolder.toLowerCase()) continue
            // 映射里的旧会话可能已删除：只有确认会话日志不存在、且目录里没有任何归档时，
            // 才把空壳目录改名回收；旧归档仍在时仍然拒绝抢占。
            let alive = null
            try { alive = resolveSessionLog(otherSid) } catch { alive = null }
            if (alive) throw new Error(`名字「${nextFolder}」已被本工作区另一个会话占用，换一个`)
            const otherDir = path.join(cwd, cfg.rootDirName, String(otherFolder))
            if (hasAnyMarkdown(otherDir)) {
              throw new Error(`名字「${nextFolder}」的旧目录里还有归档，不能抢占；请换一个`)
            }
            if (fs.existsSync(otherDir) && String(otherFolder).toLowerCase() !== String(cfg.folder).toLowerCase()) {
              const safe = String(otherFolder).replace(/[^A-Za-z0-9._-]/g, '_')
              fs.renameSync(otherDir, path.join(cwd, cfg.rootDirName, `.stale-${safe}-${Date.now()}`))
            }
            delete map[otherSid]
            ns.saveNsMap(cwd, cfg.rootDirName, map)
          }
          if (nextFolder !== cfg.folder) {
            const sameDir = nextFolder.toLowerCase() === String(cfg.folder).toLowerCase()
            if (!sameDir) {
              if (fs.existsSync(target)) throw new Error(`文件夹「${nextFolder}」已存在（可能是别的会话留下的），换一个名字`)
              fs.mkdirSync(path.dirname(target), { recursive: true })
              // _core / _docs 已在该会话目录内，rename 整个目录即可一起迁移。
              if (fs.existsSync(dir)) fs.renameSync(dir, target)
              else fs.mkdirSync(target, { recursive: true })
            }
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
        let familyWarning = ''
        if (pendingName !== undefined && typeof familyRenameFolder === 'function') {
          try {
            const fr = await familyRenameFolder(cwd, sid, folder, prev.name || folder)
            if (fr && fr.ok === false) familyWarning = String(fr.error || '家族目录同步失败')
          } catch (err) {
            familyWarning = String(err?.message || err)
          }
        }
        return json(res, 200, { ok: true, workspace: cwd, name: prev.name ?? '', folder, config: prev, ...(familyWarning ? { warning: familyWarning } : {}) })
      }
      return json(res, 405, { error: 'method not allowed' })
    } catch (err) {
      log?.('route error: ' + (err?.message ?? String(err)))
      return json(res, 400, { error: String(err?.message ?? err) })
    }
  }
}

export const MEMORY_PALACE_ROUTE = '/memory-palace-api'
