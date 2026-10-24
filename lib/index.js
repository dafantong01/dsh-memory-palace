import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import {
  resolveSessionLog, decodeEvents, decompressLog, estimateTokens, buildTurns, writeArchive, appendMonthSummary, reconcilePendingIndex, alreadyArchived, retainedFrom, retainedFromCapped, turnBytes, turnTokens, fmtTurnSpan, detectContextWindow, fmtTime, fmtMonth,
} from './archive.js'
import { createMemoryPalaceRoute, MEMORY_PALACE_ROUTE } from './route.js'

export const name = 'dsh-memory-palace'

/** Cordis 服务注入：不声明 inject，ctx.tools 会报 "cannot get property tools without inject"。 */
export const inject = ['tools', 'commands', 'webServer', 'agents', 'tokenMeter']

const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
}

/**
 * 全局默认配置（profile 级）。
 * 所有字段声明为 volatile：DSH 插件页只把可热更新的字段渲染成表单，读取一律走 .get()。
 * 工作区级的 memory-palace/config.json 会覆盖这里的同名项。
 */
export const Config = z.object({
  enabled: z.boolean()
    .volatile()
    .default(true)
    .description('全局总闸。默认允许，但真正生效还需要目标工作区里显式开启（memory-palace/config.json 的 enabled=true）。'),
  triggerPressure: z.number().min(0.2).max(0.95)
    .volatile()
    .default(0.6)
    .description('上下文占用估算达到该比例时触发归档（DSH 原生压缩在 80%，默认 60% 留余量）。'),
  contextWindowTokens: z.number().min(1000)
    .volatile()
    .default(1048576)
    .description('用于估算占用率的上下文窗口大小（token）。'),
  retainBytes: z.number().min(0)
    .volatile()
    .default(100000)
    .description('保留最近多少字节不归档（retainFraction<=0 时才用它）。'),
  batchByteFraction: z.number().min(0.05).max(1)
    .volatile()
    .default(0.5)
    .description('批量兜底：可归档文本量达到「无需归档量」的这个比例时，即使轮数不够最小批量也触发。'),
  retainFraction: z.number().min(0).max(0.5)
    .volatile()
    .default(0.12)
    .description('保留窗口占上下文窗口的比例上限（默认 12%，低于 DSH 压缩默认的 16% 尾部）。'),
  maxFileBytes: z.number().min(1000)
    .volatile()
    .default(5000000)
    .description('单个归档文件上限（字节）。超过会按轮次切分成 -p1、-p2 多个文件（按轮粒度：单轮超限时该轮独占一卷，可能超过上限）。'),
  enabledSessions: z.array(z.string())
    .volatile()
    .default([])
    .description('会话白名单（session id）。非空时只有这些会话可能触发，其余静默。'),
  enableSteer: z.boolean()
    .volatile()
    .default(true)
    .description('是否用 steer 注入归档提醒。关闭后只保留工具，不主动提示。'),
  compactAfterArchive: z.boolean()
    .volatile()
    .default(false)
    .description('归档后是否触发一次上下文压缩。compactNow 不接受范围，压缩引擎按 DSH 自己的保留策略决定留多少（默认约 16% 历史 + 64K 余量），与本插件的 30 轮/100KB 保留窗口无关；两者不一致时可能压掉尚未归档的近期轮次。默认关闭。'),
  includeReasoning: z.boolean()
    .volatile()
    .default(true)
    .description('归档是否包含助手思考原文（reasoning）。关掉可避免源码片段/内部判断进入归档。'),
  checkEveryTurns: z.number().min(1)
    .volatile()
    .default(5)
    .description('每多少轮检查一次是否该归档（越小越灵敏，开销也越大）。'),
  minBatchTurns: z.number().min(1)
    .volatile()
    .default(10)
    .description('一次至少攒够多少轮才触发归档；不够就继续等，避免每几轮生成一个文件。'),
  selfNameSlug: z.string()
    .volatile()
    .default('assistant')
    .description('归档文件名前缀：会话模型自称的拼音（默认 assistant）。'),
  rootDirName: z.string()
    .volatile()
    .default('memory-palace')
    .description('工作区下的根目录名，必须全英文小写。'),
  enabledWorkspaces: z.array(z.string())
    .volatile()
    .default([])
    .description('只在这些工作区生效（绝对路径）。空数组 = 不启用（fail-closed），必须显式填写才会工作。'),
  injectNotice: z.boolean()
    .volatile()
    .default(true)
    .description('触发时是否注入一条极短提示，叫模型调用归档工具。'),
  searchTurnLimit: z.number().min(1).max(30)
    .volatile()
    .default(12)
    .description('palace_search 默认按轮聚合时返回多少轮（整数，1–30）。'),
  groupByTurn: z.boolean()
    .volatile()
    .default(true)
    .description('palace_search 是否默认按轮聚合（每轮一条代表命中）。'),
  recallStrength: z.string()
    .volatile()
    .default('low')
    .description('回忆强度：off / low / medium / high / forced。off=只归档不读；low=优先读摘要；medium=摘要→检索→原文；high=允许递归；forced=每条用户消息后都必须检索并回报。'),
  recursionMaxDepth: z.number().min(1).max(5)
    .volatile()
    .default(1)
    .description('递归回忆的最大轮次（仅 high/forced 生效，整数 1–5）。'),
  recursionMaxWidth: z.number().min(1).max(5)
    .volatile()
    .default(1)
    .description('每轮递归最多追几个关键词（仅 high/forced 生效，整数 1–5）。旧键，等价于 recallBudgetKeywords。'),
  recallBudgetRounds: z.number().min(1).max(5)
    .volatile()
    .default(1)
    .description('回忆预算：最多几轮（仅 high/forced 生效，1–5）。只是给模型的建议上限，插件不强制执行递归。'),
  recallBudgetKeywords: z.number().min(1).max(5)
    .volatile()
    .default(1)
    .description('回忆预算：每轮最多几个关键词（仅 high/forced 生效，1–5）。同样只是建议上限。'),
})

/** 允许工作区级覆盖的键：enabled 也开放，工作区配置文件就是开关。 */
const OVERRIDABLE = [
  'enabled', 'triggerPressure', 'contextWindowTokens', 'retainFraction', 'batchByteFraction', 'retainBytes', 'maxFileBytes',
  'checkEveryTurns', 'minBatchTurns', 'selfNameSlug', 'injectNotice', 'includeReasoning', 'compactAfterArchive',
  'searchTurnLimit', 'groupByTurn', 'recallStrength', 'recursionMaxDepth', 'recursionMaxWidth',
  'recallBudgetRounds', 'recallBudgetKeywords',
]

/** 去掉 UTF-8 BOM（旧文件可能是带 BOM 写的，按行 JSON.parse 会全失败）。 */
function stripBom(s) {
  return String(s ?? '').replace(/^\uFEFF/, '')
}

/** 读取一个 volatile 配置的当前值（每次调用都取最新）。 */
function makeReader(config) {
  return (name) => {
    const v = config?.[name]
    if (v && typeof v.get === 'function') {
      try { return v.get() } catch { return undefined }
    }
    return v
  }
}

/**
 * 写 inbox 前的形状校验。
 * 事故教训：steer() 只接受 UserMessage 对象，传字符串会写坏 agent/inbox/spliced，
 * 让会话加载失败。校验不过就绝对不写。
 */
export function assertUserMessage(m) {
  if (!m || typeof m !== 'object') throw new Error('steer 需要 UserMessage 对象，收到 ' + typeof m)
  if (typeof m.id !== 'string' || !m.id) throw new Error('UserMessage 缺 id')
  if (m.role !== 'user') throw new Error('UserMessage.role 必须是 user')
  if (!Array.isArray(m.content) || m.content.length === 0) throw new Error('UserMessage.content 必须是非空数组')
  for (const b of m.content) {
    if (!b || typeof b !== 'object' || typeof b.type !== 'string') throw new Error('content 块非法')
    if (b.type === 'text' && typeof b.text !== 'string') throw new Error('text 块必须带字符串 text')
  }
  if (!m.source || typeof m.source !== 'object' || typeof m.source.kind !== 'string' || m.source.kind === 'plugin') throw new Error('UserMessage.source 必须是带 kind 的对象')
  return m
}

/** 插件内部日志，任何情况下都不抛出。 */
function safeLog(ctx, msg) {
  try { ctx?.logger?.warn?.('[dsh-memory-palace] ' + msg) } catch { /* ignore */ }
}

/** 读工作区级配置（现在只当“新会话的默认值”）；不存在或损坏时返回空对象。 */
function loadWorkspaceConfig(cwd, rootDirName) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, rootDirName, 'config.json'), 'utf8'))
    const out = {}
    for (const k of OVERRIDABLE) if (raw[k] !== undefined) out[k] = raw[k]
    return out
  } catch {
    return {}
  }
}

/** 根目录名只接受英文小写 slug，防止把归档写到工作区外。 */
function safeRootDirName(name) {
  const s = String(name ?? '')
  return /^[a-z][a-z0-9-]{1,63}$/.test(s) ? s : 'memory-palace'
}

/**
 * 记忆命名：英文（大小写均可）+ 数字 + 空格 + 下划线 + 连字符，1–32 位。
 * 首尾不允许空格；中文与路径分隔符一律拒绝。
 */
function sanitizeName(input) {
  const raw = String(input ?? '')
  if (!raw.trim()) return { ok: true, name: '' }
  if (raw !== raw.trim()) return { ok: false, error: '名字的首尾不能有空格' }
  if (raw.length > 32) return { ok: false, error: '名字最长 32 个字符' }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(raw)) {
    return { ok: false, error: '名字只能用英文（大小写均可）、数字、空格、下划线、连字符；不能中文，首尾不能是空格或符号' }
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(raw)) return { ok: false, error: '这是 Windows 保留名，换一个' }
  return { ok: true, name: raw }
}

function nsMapPath(cwd, rootDirName) {
  return path.join(cwd, rootDirName, '.namespaces.json')
}

function loadNsMap(cwd, rootDirName) {
  try {
    const raw = JSON.parse(fs.readFileSync(nsMapPath(cwd, rootDirName), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function saveNsMap(cwd, rootDirName, map) {
  const dir = path.join(cwd, rootDirName)
  fs.mkdirSync(dir, { recursive: true })
  const file = nsMapPath(cwd, rootDirName)
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/** 本会话的命名空间目录：命名后 = 名字，未命名 = 会话ID。 */
function nsFor(cwd, rootDirName, sid) {
  const map = loadNsMap(cwd, rootDirName)
  const raw = sid ? map[sid] : undefined
  // map 里的值也要校验：手改 map 不能把读写导向 rootDirName 之外。
  const safe = typeof raw === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(raw) ? raw : null
  const folder = safe || sid || '_no-session'
  return { folder, dir: path.join(cwd, rootDirName, folder), map }
}

/** 读本会话的配置文件（命名空间目录下）。 */
function loadSessionConfig(cwd, rootDirName, sid) {
  const { dir } = nsFor(cwd, rootDirName, sid)
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
    const out = {}
    for (const k of OVERRIDABLE) if (raw[k] !== undefined) out[k] = raw[k]
    if (typeof raw.name === 'string') out.name = raw.name
    return out
  } catch {
    return {}
  }
}

/** 合并：全局默认 ← 工作区默认 ← 本会话配置；并附上命名空间信息。 */
function resolveConfig(read, cwd, sid) {
  const rootDirName = safeRootDirName(read('rootDirName'))
  const ws = cwd ? loadWorkspaceConfig(cwd, rootDirName) : {}
  const base = {
    enabled: Boolean(read('enabled')),
    triggerPressure: Number(read('triggerPressure') ?? 0.6),
    contextWindowTokens: Number(read('contextWindowTokens') ?? 1048576),
    retainBytes: Number(read('retainBytes') ?? 100000),
    retainFraction: Number(read('retainFraction') ?? 0.12),
    batchByteFraction: Number(read('batchByteFraction') ?? 0.5),
    maxFileBytes: Number(read('maxFileBytes') ?? 5000000),
    checkEveryTurns: Number(read('checkEveryTurns') ?? 5),
    minBatchTurns: Number(read('minBatchTurns') ?? 10),
    selfNameSlug: String(read('selfNameSlug') ?? 'assistant'),
    rootDirName,
    enabledWorkspaces: read('enabledWorkspaces') ?? [],
    enabledSessions: read('enabledSessions') ?? [],
    enableSteer: read('enableSteer') !== false,
    includeReasoning: read('includeReasoning') !== false,
    compactAfterArchive: read('compactAfterArchive') !== false,
    injectNotice: Boolean(read('injectNotice')),
    searchTurnLimit: Number(read('searchTurnLimit') ?? 12),
    groupByTurn: read('groupByTurn') !== false,
    recallStrength: String(read('recallStrength') ?? 'low'),
    workspaceEnabled: ws.enabled === true,
  }
  const cfg = Object.assign(base, ws)
  const sess = cwd ? loadSessionConfig(cwd, rootDirName, sid) : {}
  Object.assign(cfg, sess)
  // 预算：会话里的新键 > 会话里的旧键 > 全局默认；两个名字始终同步，避免新键默认值盖住旧键。
  const budgetRounds = sess.recallBudgetRounds ?? sess.recursionMaxDepth
  const budgetWidth = sess.recallBudgetKeywords ?? sess.recursionMaxWidth
  cfg.recallBudgetRounds = Number(budgetRounds ?? read('recallBudgetRounds') ?? 1)
  cfg.recallBudgetKeywords = Number(budgetWidth ?? read('recallBudgetKeywords') ?? 1)
  cfg.recursionMaxDepth = cfg.recallBudgetRounds
  cfg.recursionMaxWidth = cfg.recallBudgetKeywords
  const ns = cwd ? nsFor(cwd, rootDirName, sid) : null
  cfg.name = typeof sess.name === 'string' ? sess.name : ''
  cfg.folder = ns ? ns.folder : ''
  cfg.dir = ns ? ns.dir : ''
  cfg.hasSession = Boolean(sid)
  cfg.sessionEnabled = sess.enabled === true
  // 文件名前缀：会话显式设置 > 跟随记忆名 > 全局默认。
  // 记忆名可能带空格/大小写，落成文件名时把空格换成连字符。
  const safeSlug = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'session'
  if (sess.selfNameSlug) {
    cfg.selfNameSlug = safeSlug(sess.selfNameSlug)
  } else if (cfg.name) {
    cfg.selfNameSlug = safeSlug(cfg.name)
  } else {
    cfg.selfNameSlug = safeSlug(cfg.selfNameSlug)
  }
  // 真正生效：全局总闸 + 本会话开关 + 已命名（未命名不归档）
  cfg.active = Boolean(cfg.enabled) && cfg.sessionEnabled
  return cfg
}

/** 统一生效门：把全局/会话/命名/提示开关收成一处，返回“为什么没生效”。 */
function gateState(cfg) {
  const reasons = []
  if (!cfg.enabled) reasons.push('全局总闸关闭')
  if (!cfg.sessionEnabled) reasons.push('本会话开关关闭')
  if (!cfg.name) reasons.push('未命名（不会归档）')
  const active = reasons.length === 0
  const steer = active && cfg.enableSteer !== false && cfg.injectNotice !== false
  return { active, steer, reasons }
}

/** 本会话是否启用：全局总闸 + 会话开关 + 工具可见性 + 可选白名单。 */
function isActiveFor(ctx, cfg, agent) {
  const gate = gateState(cfg)
  if (!gate.active) return false
  let visible = true
  try {
    const globalTool = typeof ctx.tools.get === 'function' ? ctx.tools.get('palace_archive') : undefined
    if (globalTool) {
      visible = Boolean(ctx.tools.get('palace_archive', agent.ctx))
    } else if (typeof ctx.tools.schemas === 'function') {
      const schemas = ctx.tools.schemas(agent.ctx)
      if (Array.isArray(schemas)) visible = schemas.some((s) => s?.name === 'palace_archive')
    }
  } catch {
    visible = false
  }
  if (!visible) return false
  // 可选白名单：填了就再收紧一层；空数组不拦人。
  const list = cfg.enabledWorkspaces
  if (Array.isArray(list) && list.length > 0) {
    const cwd = String(agent?.session?.header?.cwd ?? '')
    if (!list.some((p) => p && cwd.toLowerCase().startsWith(String(p).toLowerCase()))) return false
  }
  const sessions = cfg.enabledSessions
  if (Array.isArray(sessions) && sessions.length > 0) {
    const sid = String(agent?.session?.header?.id ?? '')
    if (!sessions.includes(sid)) return false
  }
  return true
}

function sessionIdOf(agent) {
  return agent?.session?.header?.id ?? agent?.session?.id ?? null
}

/** 子智能体会话：不归档、不主动 steer（它们不是主线上下文，只保留任务与结果）。 */
function isSubagentSession(agent) {
  const h = agent?.session?.header ?? {}
  return Number(h.delegationDepth ?? 0) > 0
    || Boolean(h.parentSessionId)
    || h.subagent === true
    || String(h.id ?? '').startsWith('subagent-')
}

function readState(cwd, rootDirName, sid) {
  const { dir } = nsFor(cwd, rootDirName, sid)
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '.state.json'), 'utf8'))
  } catch {
    return {}
  }
}

function writeState(cwd, rootDirName, state, sid) {
  const { dir } = nsFor(cwd, rootDirName, sid)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, '.state.json')
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 读会话轮次。按日志 mtime+size 缓存，避免每 checkEveryTurns 轮都全量解压重建（P1-5）。
 * 缓存只保留最近 8 个会话；顺带把日志里的真实上下文窗口一起带出来。
 */
const decodeCache = new Map()
// 真实窗口按会话缓存，进程启动后只取一次（下次启动 DSH 才重新读）。
const windowCache = new Map()

async function loadTurns(agent, cfg = {}) {
  const includeReasoning = cfg.includeReasoning !== false
  const sid = sessionIdOf(agent)
  const log = sid ? resolveSessionLog(sid) : null
  if (!log) return { sid, turns: null, log: null, contextWindow: null }
  let st
  try {
    st = fs.statSync(log)
  } catch {
    return { sid, turns: null, log, contextWindow: null }
  }
  const cacheKey = `${log}|${includeReasoning ? 'r1' : 'r0'}`
  const hit = decodeCache.get(cacheKey)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    return { sid, turns: hit.turns, log, cached: true, contextWindow: hit.contextWindow }
  }
  const events = await decodeEvents(log)
  const turns = buildTurns(events, { includeReasoning })
  const contextWindow = detectContextWindow(events)
  decodeCache.set(cacheKey, { mtimeMs: st.mtimeMs, size: st.size, turns, contextWindow })
  if (decodeCache.size > 8) decodeCache.delete(decodeCache.keys().next().value)
  return { sid, turns, log, cached: false, contextWindow }
}

/** 有效窗口：优先日志里的真实值（进程内只读一次），否则回落到配置值。 */
async function effectiveWindow(agent, cfg) {
  const sid = sessionIdOf(agent)
  if (sid && windowCache.has(sid)) return windowCache.get(sid)
  // 复用 scanSessionLog 的缓存：避免为了窗口再全量解码一遍日志。
  const logPath = sid ? resolveSessionLog(sid) : null
  const scan = logPath ? await scanSessionLog(logPath) : { win: null }
  const value = Number(scan?.win) > 0 ? Number(scan.win) : Number(cfg.contextWindowTokens) || 1048576
  if (sid) windowCache.set(sid, value)
  return value
}

function retentionCapBytes(cfg, win) {
  const frac = Number(cfg.retainFraction)
  if (frac > 0 && win > 0) return Math.round(win * frac * 3)
  return Number(cfg.retainBytes) || 0
}

/**
 * 上下文压力。优先用 DSH 自己的计量（ctx.tokenMeter.measure），压缩后它会回落；
 * 日志累加法不会——日志里的旧原文永远都在，所以压缩后仍会误报 60%+。
 * 拿不到计量服务时才退回日志累加，并标记来源为 log-sum。
 */
/**
 * 廉价压力探测：只问 tokenMeter，不解码日志。用于“低于阈值就直接返回”的快路径，
 * 避免每 checkEveryTurns 轮都为了算归档区间去解压整份日志（实测会卡 5–10 秒）。
 */
function measurePressureFast(ctx, agent, cfg) {
  try {
    const meter = ctx?.tokenMeter
    if (meter && typeof meter.measure === 'function' && agent?.session) {
      const m = meter.measure(agent.session)
      const tokens = Number(m?.totalTokens)
      if (Number.isFinite(tokens) && tokens > 0) {
        const win = Number(cfg.contextWindowTokens) || 1048576
        return { pressure: tokens / win, tokens, source: 'tokenMeter' }
      }
    }
  } catch { /* ignore */ }
  return null
}

function measurePressure(ctx, agent, turns, win) {
  try {
    const meter = ctx?.tokenMeter
    if (meter && typeof meter.measure === 'function' && agent?.session) {
      const m = meter.measure(agent.session)
      const tokens = Number(m?.totalTokens)
      if (Number.isFinite(tokens) && tokens > 0) {
        return { pressure: tokens / win, tokens, source: 'tokenMeter' }
      }
    }
  } catch { /* 落到下限兜底 */ }
  const tokens = turns.reduce((sum, t) => sum + turnTokens(t), 0)
  return { pressure: tokens / win, tokens, source: 'log-sum' }
}

function planRange(turns, cfg, state, sid, win) {
  // 连续下界只取区间最大值（不能把空洞填平）；archivedThroughTurn 仅作旧状态兜底。
  const ranges = Array.isArray(state[sid]?.archivedRanges) ? state[sid].archivedRanges : []
  const from = ranges.length > 0
    ? ranges.reduce((m, r) => Math.max(m, Number(r[1]) || 0), 0)
    : Math.max(Number(state[sid]?.archivedThroughTurn ?? 0) || 0, 0)
  const tailFrom = retainedFromCapped(turns, Number.MAX_SAFE_INTEGER, retentionCapBytes(cfg, win))
  const eligible = turns.slice(0, tailFrom).filter((t) => t.turn > from && !t.injected)
  return { eligible, tailFrom, from }
}

/** 把轮次数组切成连续区间。 */
function contiguousRuns(turns) {
  const runs = []
  for (const t of turns) {
    const last = runs[runs.length - 1]
    if (last && t.turn === last[1] + 1) last[1] = t.turn
    else runs.push([t.turn, t.turn])
  }
  return runs
}

/** 合并重叠/相邻区间。 */
function mergeRanges(ranges) {
  const sorted = [...ranges].filter((r) => Array.isArray(r) && r[0] <= r[1]).sort((a, b) => a[0] - b[0])
  const out = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** 区间覆盖的轮次总数。 */
function countRange(ranges) {
  let n = 0
  for (const [a, b] of ranges) if (b >= a) n += b - a + 1
  return n
}

/**
 * 会话日志扫描缓存：解压+逐行解析一次约几秒（日志 10 MB+）。
 * 页签 GET 同时需要 cwd、窗口、总轮数，之前各扫一遍；这里按 (path, mtime, size) 缓存，
 * 进程内复用，日志变了自动重扫。
 */
const logScanCache = new Map()
export async function scanSessionLog(logPath) {
  if (!logPath) return { cwd: '', win: null, totalTurns: 0 }
  let st
  try { st = fs.statSync(logPath) } catch { return { cwd: '', win: null, totalTurns: 0 } }
  const key = `${logPath}|${st.mtimeMs}|${st.size}`
  const hit = logScanCache.get(key)
  if (hit) return hit
  let out = { cwd: '', win: null, totalTurns: 0 }
  try {
    // 冷启动优化：只整份解压一次，然后逐行“按需解析”——
    // 只 JSON.parse turn/start、session、request/context 三类行，避免对上百 MB 文本全量 parse。
    const text = await decompressLog(logPath)
    let cwd = ''
    let lastTurn = 0
    let lastCtx = null
    for (const line of text.split('\n')) {
      if (!line) continue
      if (line.includes('"turn/start"')) {
        try {
          const e = JSON.parse(line)
          if (e?.type === 'turn/start') lastTurn = Math.max(lastTurn, Number(e.data?.turn ?? 0) || 0)
        } catch { /* 坏行跳过 */ }
        continue
      }
      if (!cwd && line.includes('"session"')) {
        try {
          const e = JSON.parse(line)
          if (e?.type === 'session') cwd = String(e.cwd ?? e.data?.cwd ?? '')
        } catch { /* ignore */ }
        continue
      }
      if (line.includes('"request/context"')) {
        try {
          const e = JSON.parse(line)
          if (e?.type === 'request/context') lastCtx = e
        } catch { /* ignore */ }
      }
    }
    out = { cwd, win: lastCtx ? detectContextWindow([lastCtx]) : null, totalTurns: lastTurn }
  } catch { /* 解不出来就返回空 */ }
  logScanCache.set(key, out)
  if (logScanCache.size > 8) logScanCache.delete(logScanCache.keys().next().value)
  return out
}

/**
 * 当前会话的轮次统计。不落盘；总轮数直接用日志扫描缓存，避免重复解码。
 */
/** 页签统计结果的短 TTL 缓存：避免在模型思考/流式输出时每次打开都重解压日志。 */
const statsCache = new Map()
const STATS_TTL_MS = 60_000
function invalidateStats(sid) {
  if (sid) statsCache.delete(sid)
}

async function turnStats(sid, cwd, cfg) {
  if (!sid || !cwd) return null
  const hit = statsCache.get(sid)
  if (hit && Date.now() - hit.at < STATS_TTL_MS) return hit.value
  let totalTurns = 0
  try {
    const scan = await scanSessionLog(resolveSessionLog(sid))
    totalTurns = scan.totalTurns
  } catch { /* ignore */ }
  if (!totalTurns) {
    const pseudo = { session: { header: { id: sid, cwd } } }
    try {
      const { turns } = await loadTurns(pseudo, cfg)
      if (turns && turns.length > 0) totalTurns = turns[turns.length - 1].turn
    } catch { /* 读不到就都记 0 */ }
  }
  const state = readState(cwd, cfg.rootDirName, sid)
  const ranges = Array.isArray(state[sid]?.archivedRanges) && state[sid].archivedRanges.length > 0
    ? state[sid].archivedRanges
    : (Number(state[sid]?.archivedThroughTurn ?? 0) > 0 ? [[1, Number(state[sid].archivedThroughTurn)]] : [])
  const archivedTurns = countRange(ranges)
  const value = {
    totalTurns,
    archivedTurns,
    pendingTurns: Math.max(0, totalTurns - archivedTurns),
    watermark: ranges.reduce((m, r) => Math.max(m, r[1]), 0),
  }
  statsCache.set(sid, { at: Date.now(), value })
  if (statsCache.size > 16) statsCache.delete(statsCache.keys().next().value)
  return value
}

function registerArchiveTool(ctx, read) {
  const def = {
    name: 'palace_archive',
    description:
      '把较早的对话轮次归档进当前工作区的 memory-palace 目录。'
      + '调用前先判断这些轮次属于什么类别，用一个英文小写 slug 作为类别名（如 migration-engineering、novel-worldbuilding、dsh-environment）。'
      + '插件会从会话日志逐字取出原文写入文件，你不需要复述内容。'
      + '如果这个会话里你有明确的自称（名字），请用 selfName 传进来（英文小写拼音），文件名会用它；不传则用工作区配置。'
      + '校验很严：区间里出现「日志中不存在的 turn」「超出保留边界」「已归档」「同一轮分到多个类别」时，整次调用失败、一个字节都不写，并列出具体 turn。'
      + '归档前请先 palace_turns 看清每轮内容，不要用“第几条消息”换算 turn。'
      + '归档文件写入后只读，任何情况下都不要修改旧档。',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '英文小写分类 slug：a-z、0-9、连字符。整段归一类时用。' },
        fromTurn: { type: 'number', description: '起始轮次（含）。省略则从上次归档水位之后开始。' },
        toTurn: { type: 'number', description: '结束轮次（含）。省略则到保留边界为止。' },
        segments: {
          type: 'array',
          description: '逐轮判断类别时用：按类别切分的轮次区间数组，每项 {category, fromTurn, toTurn}。'
            + '同一个 category 可以出现多次；给了 segments 就忽略 category/fromTurn/toTurn。'
            + '每个 turn 只能属于一个类别，区间不要重叠。',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              fromTurn: { type: 'number' },
              toTurn: { type: 'number' },
            },
            required: ['category', 'fromTurn', 'toTurn'],
          },
        },
        selfName: { type: 'string', description: '可选：你在本会话里的自称（英文小写拼音/slug），用作归档文件名前缀。省略则用工作区配置。' },
        summaries: {
          type: 'array',
          description: '每个类别一段摘要（推荐）：[{category, text}, …]。text 只概述该类别下“本次被归档的那几轮”，200–800 字，不要复述更早历史。'
            + '会逐段追加到当月摘要文件 <会话>/<YYYY-MM>/_summary.md 末尾（前缀是归档日期 + 类别 + 轮次范围），只追加不改旧内容。',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['category', 'text'],
          },
        },
        summary: {
          type: 'string',
          description: '仅在只归档一个类别时可用：等同于给该类别一段摘要。多类别时请用 summaries，否则各分类拿不到各自的摘要。',
        },
      },
      required: [],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      const hasSegments = Array.isArray(args.segments) && args.segments.length > 0
      const slug = String(args.category ?? '').trim()
      if (!hasSegments && !/^[a-z][a-z0-9-]{1,63}$/.test(slug)) {
        throw new Error('类别必须是英文小写 slug（a-z、0-9、连字符），例如 migration-engineering；或改用 segments 逐段指定类别。')
      }
      const cwd = String(agent?.session?.header?.cwd ?? '')
      if (!cwd) throw new Error('读不到当前工作区路径，无法归档。')
      if (isSubagentSession(agent)) {
        throw new Error('子智能体会话不归档：它的内容不是主线上下文，只需保留任务与结果摘要。')
      }
      const sidEarly = sessionIdOf(agent)
      const cfg = resolveConfig(read, cwd, sidEarly)
      // fail-closed：本会话未开启不允许写归档。
      if (!cfg.enabled || !cfg.sessionEnabled) {
        throw new Error('记忆回廊未在本会话开启：先在页签里打开开关，或执行 /palace on。')
      }
      if (!cfg.name) {
        throw new Error('本会话还没有命名记忆。先在「记忆回廊」页签里填一个名字并保存，之后才会开始归档。')
      }
      const { sid, turns } = await loadTurns(agent, cfg)
      if (!turns || turns.length === 0) throw new Error('读不到会话日志或日志为空，未归档。')
      const state = readState(cwd, cfg.rootDirName, sid)
      // 上次归档若出现「文件写了、索引没写」，先补索引再继续。
      let reconcileNote = ''
      try {
        const rec = reconcilePendingIndex(cfg.dir)
        if (rec.added > 0) reconcileNote = `（已补写上次漏记的 ${rec.added} 行索引）`
      } catch { /* 补索引失败不影响本次归档 */ }
      // 保留边界只由保留策略决定，与水位无关——水位高了也不能把边界算没（R-1）。
      const win = await effectiveWindow(agent, cfg)
      const tailFrom = retainedFromCapped(turns, Number.MAX_SAFE_INTEGER, retentionCapBytes(cfg, win))
      // boundary = 可归档的最后一轮；0 表示“全部在保留区”，不是“无限制”。
      // 再压一层：永远不归档最后一轮（它可能正在生成，写下去会截断当前轮）。
      const logLastTurn = turns[turns.length - 1].turn
      const safeLast = logLastTurn > 1 ? logLastTurn - 1 : 0
      const rawBoundary = tailFrom > 0 ? turns[tailFrom - 1].turn : 0
      const boundary = rawBoundary > 0 ? Math.min(rawBoundary, safeLast) : 0
      const stateRanges = Array.isArray(state[sid]?.archivedRanges) && state[sid].archivedRanges.length > 0
        ? state[sid].archivedRanges
        : []
      // 覆盖集以「索引里真实存在的行」为准；没有索引才退回 state 区间。
      // 这样 legacy 的 archivedThroughTurn（单点最大值）不会把中间空洞填平。
      const covered = new Set()
      const indexPath = path.join(cfg.dir, 'index.jsonl')
      if (fs.existsSync(indexPath)) {
        try {
          for (const line of stripBom(fs.readFileSync(indexPath, 'utf8')).split('\n')) {
            if (!line.trim()) continue
            let row
            try { row = JSON.parse(line) } catch { continue }
            if (Array.isArray(row.turns) && row.turns.length > 0) {
              for (const t of row.turns) covered.add(Number(t))
            } else {
              const a = Number(row.fromTurn)
              const b = Number(row.toTurn)
              if (Number.isFinite(a) && Number.isFinite(b)) for (let t = a; t <= b; t++) covered.add(t)
            }
          }
        } catch { /* 索引坏则退回 state */ }
      }
      if (covered.size === 0) {
        for (const [a, b] of stateRanges) for (let t = a; t <= b; t++) covered.add(t)
      }
      const watermark = covered.size > 0
        ? Math.max(...covered)
        : (Number(state[sid]?.archivedThroughTurn ?? 0) || 0)
      const nameArg = String(args.selfName ?? '').trim()
      if (nameArg && !/^[a-z][a-z0-9-]{1,63}$/.test(nameArg)) {
        throw new Error('selfName 必须是英文小写 slug（a-z、0-9、连字符）。')
      }

      // 按 turn 号索引可归档轮次（有内容的才算）。
      const byTurn = new Map(turns.filter((t) => t.items.length > 0 && !t.injected).map((t) => [t.turn, t]))
      // 日志里实际存在的 turn（含无正文的工具轮），用于区分「这一轮没内容」和「这一轮根本不存在」。
      const allTurns = new Set(turns.map((t) => t.turn))
      const lastLogTurn = logLastTurn
      const groups = new Map()
      const addTurn = (cat, t) => {
        if (!groups.has(cat)) groups.set(cat, [])
        groups.get(cat).push(t)
      }

      const explicitLo = Number.isFinite(args.fromTurn)
      let skippedEmpty = 0
      if (hasSegments) {
        // 逐段指定类别：轮次顺序不变，每个 turn 只能落一个类别。
        // 任何“不该归档/不存在”的轮次都让整次调用失败，绝不静默跳过（否则水位会骗人）。
        const claimed = new Set()
        const beyond = []
        const alreadyDone = []
        const missing = []
        const claimedDupes = []
        for (const seg of args.segments) {
          const cat = String(seg?.category ?? '').trim()
          if (!/^[a-z][a-z0-9-]{1,63}$/.test(cat)) {
            throw new Error(`segments 里的类别不合法：${cat || '(空)'}（必须是英文小写 slug）`)
          }
          const a = Number(seg.fromTurn)
          const b = Number(seg.toTurn)
          if (!Number.isInteger(a) || !Number.isInteger(b)) {
            throw new Error(`turn 必须是整数：${seg.fromTurn}–${seg.toTurn}`)
          }
          if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) {
            throw new Error(`segments 范围无效：${seg.fromTurn}–${seg.toTurn}`)
          }
          if (a < 1) throw new Error(`segments 起点不能小于 1：${a}（turn 从 1 开始）`)
          for (let n = a; n <= b; n++) {
            if (n > lastLogTurn) { missing.push(n); continue }
            if (boundary <= 0) { beyond.push(n); continue } // boundary=0：全部在保留区，不允许归档
            if (n > boundary) { beyond.push(n); continue }
            if (!allTurns.has(n)) { skippedEmpty += 1; continue } // 无正文轮（纯 steer/注入）
            if (covered.has(n)) { alreadyDone.push(n); continue }
            if (claimed.has(n)) { claimedDupes.push(n); continue }
            const t = byTurn.get(n)
            if (!t) { skippedEmpty += 1; continue }
            claimed.add(n)
            addTurn(cat, t)
          }
        }
        if (beyond.length > 0 || alreadyDone.length > 0 || missing.length > 0 || claimedDupes.length > 0) {
          const fmt = (arr) => arr.slice(0, 12).join(', ') + (arr.length > 12 ? ` …共 ${arr.length} 个` : '')
          throw new Error(
            'segments 里包含了不能归档的轮次，整次调用已拒绝（一个字节都没写）：'
            + (missing.length ? `\n- 日志里不存在这些 turn（最新只到 ${lastLogTurn}）：${fmt(missing)}` : '')
            + (beyond.length
              ? (boundary <= 0
                ? `\n- 当前无可归档轮次（全部在保留区，或只剩正在生成的最后一轮），不是轮次号写错了。被请求的 turn：${fmt(beyond)}`
                : `\n- 超出保留边界（可归档到 turn ${boundary} 为止）：${fmt(beyond)}`)
              : '')
            + (alreadyDone.length ? `\n- 已经归档过：${fmt(alreadyDone)}` : '')
            + (claimedDupes.length ? `\n- 同一轮被分到多个类别：${fmt(claimedDupes)}` : '')
            + '\n请先用 palace_turns 看清每轮内容与范围，只归档保留边界以内、尚未归档的轮次；不要用“第几条消息”换算 turn。',
          )
        }
      } else {
        // 显式给了区间：越界同样整次失败，不静默截断。
        if (explicitLo) {
          if (!Number.isInteger(args.fromTurn)) throw new Error(`fromTurn 必须是整数：${args.fromTurn}`)
          if (args.fromTurn < 1) throw new Error(`fromTurn 不能小于 1：${args.fromTurn}`)
        }
        if (Number.isFinite(args.toTurn)) {
          if (!Number.isInteger(args.toTurn)) throw new Error(`toTurn 必须是整数：${args.toTurn}`)
          if (args.toTurn > lastLogTurn) {
            throw new Error(`toTurn ${args.toTurn} 超出日志末尾（最新 turn ${lastLogTurn}），整次调用已拒绝。`)
          }
          if (boundary > 0 && args.toTurn > boundary) {
            throw new Error(`toTurn ${args.toTurn} 超出保留边界（turn ${boundary}），这些轮次还没到归档时机；整次调用已拒绝。`)
          }
        }
        const lo = explicitLo ? Math.max(1, args.fromTurn) : Math.max(1, watermark + 1)
        const hi = Number.isFinite(args.toTurn) ? args.toTurn : boundary
        const clampedHi = boundary > 0 ? Math.min(hi, boundary) : 0
        if (lo > clampedHi) {
          // 水位已经越过保留边界：不是数据丢失，是最近的轮次还受保留区保护。
          if (boundary <= 0) {
            return `当前无可归档轮次（全部在保留区；或只剩正在生成的最后一轮）。`
          }
          if (watermark >= boundary) {
            return `当前无可归档轮次（全部在保留区）：turn 1–${watermark} 都已归档；turn ${boundary + 1} 之后属于保留区（约 ${(retentionCapBytes(cfg, win) / 1024).toFixed(0)} KB ≈ 窗口的 ${Math.round((cfg.retainFraction || 0) * 100)}%），等会话继续增长、边界越过 ${watermark} 后再归档。`
          }
          return `当前无可归档轮次（全部在保留区）：边界 turn ${boundary}，已归档到 turn ${watermark}，请求范围 ${lo}–${hi}，保留文本量约 ${(retentionCapBytes(cfg, win) / 1024).toFixed(0)} KB（窗口的 ${Math.round((cfg.retainFraction || 0) * 100)}%）。`
        }
        for (const t of byTurn.values()) {
          if (t.turn < lo || t.turn > clampedHi) continue
          if (covered.has(t.turn)) continue
          addTurn(slug, t)
        }
      }

      const allPicked = [...groups.values()].flat().sort((a, b) => a.turn - b.turn)
      if (allPicked.length === 0) {
        return '这些轮次都已经归档过（或不在可归档范围内），没有新的可归档内容。'
      }

      // 先解析 summaries 并校验类别，任何“写了却不生效”的情况必须在落盘之前拒绝（FIX-4）。
      const sumArg = args.summaries
      const perCat = new Map()
      if (Array.isArray(sumArg)) {
        for (const it of sumArg) {
          if (!it || typeof it !== 'object') continue
          const c = String(it.category ?? '').trim()
          if (c) perCat.set(c, String(it.text ?? ''))
        }
      } else if (sumArg && typeof sumArg === 'object') {
        for (const [k, v] of Object.entries(sumArg)) perCat.set(String(k), String(v ?? ''))
      }
      const fallbackSummaryEarly = String(args.summary ?? '').trim()
      const plannedCats = new Set(groups.keys())
      const unmatched = [...perCat.keys()].filter((c) => !plannedCats.has(c))
      if (perCat.size > 0 && unmatched.length === perCat.size) {
        throw new Error(
          `summaries 的类别（${unmatched.join(', ')}）都不在本次 segments 中（实际类别：${[...plannedCats].join(', ')}）；`
          + '已拒绝，未写任何文件。请先核对 segments 与 summaries 的 category。',
        )
      }

      // 每个类别一次写入 = 一个文件（超过 maxFileBytes 才按轮分卷）。
      const results = []
      const nsLabel = `${cfg.rootDirName}/${cfg.folder}`
      const nowMs = Date.now() // 本次归档统一时间，文件与摘要落在同一个月
      for (const [cat, list] of groups) {
        list.sort((a, b) => a.turn - b.turn)
        const res = writeArchive({
          nsDir: cfg.dir,
          nsLabel,
          selfNameSlug: nameArg || cfg.selfNameSlug,
          category: cat,
          turns: list,
          now: nowMs,
          maxFileBytes: Number(cfg.maxFileBytes) > 0 ? Number(cfg.maxFileBytes) : 5_000_000,
          meta: {
            sessionId: sid,
            sessionTitle: agent?.session?.header?.title,
            reason: hasSegments ? '会话模型按类别分段归档' : (explicitLo ? '会话模型指定范围归档' : '会话模型按保留边界归档'),
          },
        })
        results.push({ cat, count: list.length, res, turns: list.map((t) => t.turn) })
      }

      const lastTurn = allPicked[allPicked.length - 1].turn
      const mergedRanges = mergeRanges([...stateRanges, ...contiguousRuns(allPicked)])
      // archivedThroughTurn 只表示「从 1 开始连续覆盖到哪」，不能拿最大值当连续下界（否则空洞被填平）。
      let throughTurn = 0
      for (const [a, b] of mergedRanges.slice().sort((x, y) => x[0] - y[0])) {
        if (a <= throughTurn + 1) throughTurn = Math.max(throughTurn, b)
        else break
      }
      state[sid] = {
        ...(state[sid] ?? {}),
        archivedRanges: mergedRanges,
        archivedThroughTurn: throughTurn,
        lastArchiveAt: fmtTime(nowMs),
        lastArchiveRange: `${allPicked[0].turn}-${lastTurn}`,
      }
      // 先写摘要、后写状态：摘要失败时 state 还没更新，重试不会变成“已归档过”。
      // sumArg/perCat 已在落盘前解析并校验（FIX-4），这里直接复用。
      const fallbackSummary = fallbackSummaryEarly
      // 月份按对话首轮时间，而不是归档时刻；摘要段头同时写“归档时间 + 对话时间范围”。
      const convStart = allPicked[0]?.startedAt ?? nowMs
      const lastPicked = allPicked[allPicked.length - 1]
      const convEnd = lastPicked?.endedAt ?? lastPicked?.startedAt ?? nowMs
      const month = fmtMonth(convStart)
      let wrote = 0
      const wroteCats = []
      for (const r of results) {
        const text = String(perCat.get(r.cat) ?? (results.length === 1 ? fallbackSummary : '')).trim()
        if (!text) continue
        appendMonthSummary({
          nsDir: cfg.dir,
          month,
          label: `[${r.cat}] ${fmtTurnSpan(r.turns)}`,
          text,
          convStart,
          convEnd,
        })
        wrote += 1
        wroteCats.push(r.cat)
      }
      const usedCats = new Set(results.map((r) => r.cat))
      const unusedCats = [...perCat.keys()].filter((c) => !usedCats.has(c))
      const summaryNote = wrote > 0
        ? `\n已写入 ${wrote} 段摘要（${wroteCats.join(', ')}）：${cfg.rootDirName}/${cfg.folder}/${month}/_summary.md`
        + (unusedCats.length ? `\n⚠ summaries 里这些类别不在本次 segments 中，已忽略：${unusedCats.join(', ')}` : '')
        : '\n（本次没给 summaries，摘要文件未更新。多类别时请用 summaries=[{category,text},…]。）'
      writeState(cwd, cfg.rootDirName, state, sid)
      invalidateStats(sid) // 归档后统计会变，下一次页签打开重新算

      // 归档后把旧轮次从活跃上下文里换掉（等同一次 /compact）：全文已经在磁盘上，不会丢。
      let compactNote = ''
      if (cfg.compactAfterArchive === true) {
        try {
          if (ctx.compaction && typeof ctx.compaction.compactNow === 'function') {
            ctx.compaction.compactNow(agent, AbortSignal.timeout(180000), 'memory-palace')
              .then(() => safeLog(ctx, 'compaction finished after archive'))
              .catch((e) => safeLog(ctx, 'compaction skipped: ' + (e?.message ?? String(e))))
            compactNote = '\n已触发上下文压缩（把旧轮次换成摘要）。'
          } else {
            compactNote = '\n（宿主未提供 compaction 服务，未压缩上下文。）'
          }
        } catch (err) {
          safeLog(ctx, 'compaction trigger failed: ' + (err?.message ?? String(err)))
        }
      }

      const lines = results.map((r) => {
        const parts = r.res.parts > 1 ? `，分 ${r.res.parts} 卷` : ''
        return `[${r.cat}] ${fmtTurnSpan(r.turns)}${parts}\n  ${r.res.files.join('\n  ')}`
      })
      const skippedNote = skippedEmpty > 0 ? `\n（跳过 ${skippedEmpty} 个无正文轮次）` : ''
      return `已归档 ${allPicked.length} 轮，共 ${results.length} 个类别：\n${lines.join('\n')}${reconcileNote}${summaryNote}${compactNote}${skippedNote}`
    },
  }
  ctx.tools.register(def)
  return def
}

/**
 * 在归档正文里找轮次标题，返回 [{turn, line}]（行号从 0 起）。
 * 新文件用 `## TURN n ·`；只有整份都没有新标记时才退回旧格式 `## 第 n 轮 ·`。
 * 这样正文里被引用的旧标题不会把切片切错。
 */
function turnIndex(lines) {
  const modern = []
  const legacy = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = /^## TURN (\d+) · /.exec(line)
    if (m) { modern.push({ turn: Number(m[1]), line: i }); continue }
    const l = /^## 第 (\d+) 轮 · /.exec(line)
    if (l) legacy.push({ turn: Number(l[1]), line: i })
  }
  // 多数派决定用哪套标记：正文里偶尔出现大写 TURN 的引用，不会把整份文件带偏。
  if (modern.length === 0) return legacy
  if (legacy.length === 0) return modern
  return modern.length >= legacy.length ? modern : legacy
}

/**
 * 进程内检索缓存：同一份文件（mtime+size 没变）只读一次磁盘。
 * 不落盘，重启即清空；最多缓存 5 份文件，避免内存膨胀。
 */
const searchCache = new Map()

/** 最近事件环形缓冲：steer/归档/检索失败都记一行，页签可见（不用翻会话日志）。 */
const eventLog = []
function recordEvent(kind, detail) {
  try {
    eventLog.push({ t: new Date().toISOString().replace('T', ' ').slice(0, 19), kind: String(kind), detail: String(detail ?? '').slice(0, 300) })
    while (eventLog.length > 50) eventLog.shift()
  } catch { /* ignore */ }
}

function loadSearchable(abs) {
  let st
  try { st = fs.statSync(abs) } catch { return null }
  const hit = searchCache.get(abs)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit
  let text
  try { text = fs.readFileSync(abs, 'utf8') } catch { return null }
  const lines = text.split('\n')
  const entry = {
    mtimeMs: st.mtimeMs,
    size: st.size,
    lines,
    lowerLines: lines.map((l) => l.toLowerCase()),
    turns: turnIndex(lines),
  }
  searchCache.set(abs, entry)
  if (searchCache.size > 5) searchCache.delete(searchCache.keys().next().value)
  return entry
}

/** 取指定行区间的轮次集合（fromTurn/toTurn），没有范围就返回 null。 */
function sliceTurns(lines, fromTurn, toTurn) {
  const idx = turnIndex(lines)
  if (idx.length === 0) return null
  const want = idx.filter((t) => t.turn >= fromTurn && t.turn <= toTurn)
  if (want.length === 0) return ''
  const start = want[0].line
  const last = want[want.length - 1]
  const next = idx.find((t) => t.line > last.line)
  const end = next ? next.line : lines.length
  return lines.slice(start, end).join('\n')
}

/** 解析归档文件路径：索引里存“相对命名空间”的路径；老数据是 memory-palace/ 开头的相对工作区路径。 */
function resolveArchivePath(cwd, rootDirName, nsDir, rel) {
  const norm = String(rel ?? '').replace(/\\/g, '/')
  if (norm === rootDirName || norm.startsWith(rootDirName + '/')) return path.resolve(cwd, norm)
  return path.join(nsDir, norm)
}

/** 选命名空间目录：默认自己；给了 namespace 就按名字找（大小写不敏感）。 */
function pickNsDir(cwd, rootDirName, sid, namespace) {
  const mine = nsFor(cwd, rootDirName, sid)
  const wanted = String(namespace ?? '').trim()
  if (!wanted) return { dir: mine.dir, folder: mine.folder, ok: true }
  const lower = wanted.toLowerCase()
  if (mine.folder.toLowerCase() === lower) return { dir: mine.dir, folder: mine.folder, ok: true }
  const map = loadNsMap(cwd, rootDirName)
  for (const folder of Object.values(map)) {
    // map 的值也要校验：手改 .namespaces.json 不能把读取导向别的目录。
    const name = String(folder)
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(name)) continue
    if (name.toLowerCase() === lower) {
      return { dir: path.join(cwd, rootDirName, name), folder: name, ok: true }
    }
  }
  return { ok: false, dir: mine.dir, folder: mine.folder }
}

function registerSearchTool(ctx, read) {
  return ctx.tools.register({
    name: 'palace_search',
    description:
      '检索当前工作区 memory-palace 的归档。默认只查索引（快、省）；给 keyword 时会在归档正文里搜，'
      + '默认按轮聚合（每轮只返回一条代表命中 + 该轮命中数），多关键词用空格分隔（需全部命中）。'
      + '只回片段不返回全文——需要细节再用 palace_read 按轮次取。只读。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '关键词；多个词用空格分隔（AND）。留空则按时间倒序列索引。' },
        date: { type: 'string', description: '可选 YYYY-MM-DD，只看该日归档。' },
        category: { type: 'string', description: '可选：只在该类别里搜（例如 debugging）。' },
        namespace: { type: 'string', description: '可选：别的会话的记忆命名空间名；省略 = 只查自己。' },
        all: { type: 'boolean', description: '可选：true 时扫描本工作区所有命名空间（结果标来源命名空间）；默认只查自己。' },
        includeSummary: { type: 'boolean', description: '可选：true 时额外扫摘要（_summary.md），结果标为“摘要里提到”。默认只在原文 0 命中时自动回查。' },
        groupByTurn: { type: 'boolean', description: '默认 true：每轮只返回一条代表命中。设 false 则按原始命中行返回。' },
        limitTurns: { type: 'number', description: '按轮聚合时最多返回多少轮，默认取配置（12），上限 30。' },
        limit: { type: 'number', description: '旧参数：按原始命中行计数（groupByTurn=false 时生效），默认 20，上限 200。' },
      },
      required: [],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const cwd = String(exec.agent?.session?.header?.cwd ?? '')
      const sid = sessionIdOf(exec.agent)
      const cfg = resolveConfig(read, cwd, sid)
      // 目标命名空间：默认自己；`all:true` 扫全部（排除备份目录）。
      let targets
      if (args.all) {
        const map = loadNsMap(cwd, cfg.rootDirName)
        const dirs = new Map([[cfg.folder, cfg.dir]])
        for (const f of Object.values(map)) {
          const folder = String(f)
          if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(folder)) continue
          dirs.set(folder, path.join(cwd, cfg.rootDirName, folder))
        }
        targets = [...dirs].filter(([, d]) => fs.existsSync(path.join(d, 'index.jsonl'))).map(([folder, dir]) => ({ folder, dir }))
      } else {
        const picked = pickNsDir(cwd, cfg.rootDirName, sid, args.namespace)
        if (!picked.ok) return `找不到记忆命名空间「${String(args.namespace).trim()}」。`
        targets = [{ folder: picked.folder, dir: picked.dir }]
      }
      if (targets.length === 0) return '归档记忆为空（没有任何命名空间有归档）。'
      let rows = []
      for (const t of targets) {
        try {
          const list = stripBom(fs.readFileSync(path.join(t.dir, 'index.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => {
            try { return JSON.parse(l) } catch { return null }
          }).filter(Boolean)
          rows.push(...list.map((r) => ({ ...r, _folder: t.folder, _dir: t.dir })))
        } catch (err) {
          recordEvent('search-error', `${t.folder}: ${String(err?.message ?? err)}`)
        }
      }
      if (rows.length === 0) {
        return args.all ? '归档记忆为空（索引都读不到）。' : '归档记忆为空（本会话还没有任何归档）。'
      }
      let hits = rows
      if (args.date) hits = hits.filter((r) => (r.archivedAt ?? '').startsWith(args.date))
      if (args.category) hits = hits.filter((r) => r.category === String(args.category).trim())
      const keyword = String(args.keyword ?? '').trim()
      const showFile = (rel, folder) => {
        const norm = String(rel ?? '').replace(/\\/g, '/')
        return norm.startsWith(cfg.rootDirName + '/') ? norm : `${folder}/${norm}`
      }
      const catLabel = (h) => (args.all ? `${h.ns} · ${h.cat}` : h.cat)

      if (!keyword) {
        const n = Math.min(Math.max(Number(args.limit) || 20, 1), 200)
        const list = hits.slice(-n).reverse()
        if (list.length === 0) return '没有匹配的归档。'
        return list.map((r) => `${r.archivedAt}  [${args.all ? r._folder + ' · ' : ''}${r.category}]  ${showFile(r.file, r._folder)}  (${(r.bytes / 1024).toFixed(1)} KB, turn ${r.fromTurn}–${r.toTurn})  来源 ${String(r.sessionId ?? '').replace(/^session-/, '').slice(0, 8)}…`).join('\n')
      }

      // 多关键词 AND（空格分隔；引号包住的短语整体匹配）
      const tokens = (keyword.match(/"([^"]+)"|[^\s"]+/g) ?? [keyword]).map((t) => t.replace(/^"|"$/g, '').toLowerCase()).filter(Boolean)
      // 旧键语义冻结：只给了 limit（没给 groupByTurn/limitTurns）时，按老的“原始命中条数”模式跑。
      const legacyCall = args.limit !== undefined && args.groupByTurn === undefined && args.limitTurns === undefined
      const groupByTurn = args.groupByTurn !== undefined
        ? args.groupByTurn !== false
        : (!legacyCall && cfg.groupByTurn !== false)
      const capTurns = Math.min(Math.max(Number(args.limitTurns) || Number(cfg.searchTurnLimit) || 12, 1), 30)
      const capRaw = Math.min(Math.max(Number(args.limit) || 20, 1), 200)
      const MAX_OUT = 8000
      // 参数冲突提示：groupByTurn=true 时 limit 不生效，别让人以为条数被限制了。
      const limitNote = (args.limit !== undefined && groupByTurn) ? '（groupByTurn=true 时 limit 不生效，请用 limitTurns）\n' : ''
      let readErrors = 0
      const perTurn = new Map() // key: file|turn → { file, cat, turn, best, count }
      const rawHits = []

      for (const r of hits.slice().reverse()) {
        const abs = resolveArchivePath(cwd, cfg.rootDirName, r._dir, r.file)
        let entry
        try {
          if (!fs.existsSync(abs)) { readErrors += 1; continue }
          entry = loadSearchable(abs)
        } catch { readErrors += 1; continue }
        if (!entry) { readErrors += 1; continue }
        const { lines, lowerLines, turns: idx } = entry
        const firstTurnLine = idx.length > 0 ? idx[0].line : 0
        const byLine = new Map(idx.map((t) => [t.line, t.turn]))
        let lastTurn = null
        let inUserBlock = false
        for (let i = 0; i < lines.length; i++) {
          if (byLine.has(i)) lastTurn = byLine.get(i)
          if (i < firstTurnLine || lines[i].length < 4) continue
          const line = lines[i]
          if (line.startsWith('### 用户')) { inUserBlock = true; continue }
          if (line.startsWith('### ')) { inUserBlock = false; continue }
          const low = lowerLines[i]
          let ok = true
          let firstAt = -1
          let count = 0
          for (const tk of tokens) {
            const at = low.indexOf(tk)
            if (at < 0) { ok = false; break }
            if (firstAt < 0 || at < firstAt) firstAt = at
            let p = at
            while (p >= 0) { count += 1; p = low.indexOf(tk, p + tk.length) }
          }
          if (!ok) continue
          const turn = lastTurn
          const from = Math.max(0, firstAt - 100)
          const snippet = line.slice(from, from + 220).replace(/\s+/g, ' ').trim()
          // 工具/JSON/命令行行的识别：这种行适合当证据，不适合当“这轮在聊什么”的代表
          const toolish = /^\s*(?:\{|\[|```|\$|>|\d+[:：]\s)|\bfile_path\b|"command"|\\n|Select-Object|ForEach-Object|Import-Module/.test(line)
          const hit = { file: r.file, cat: r.category, ns: r._folder, folder: r._folder, turn, lineNo: i + 1, snippet, count, inUser: inUserBlock, toolish, src: String(r.sessionId ?? '') }
          if (groupByTurn) {
            const key = `${r._folder}|${r.file}|${turn ?? '?'}`
            const cur = perTurn.get(key)
            if (!cur) perTurn.set(key, { ...hit, best: hit, total: count })
            else {
              cur.total += count
              // 代表行优先级：用户消息行(3) > 普通文本行(2) > 工具/JSON/代码行(1)；同级比密度，再比长度
              const tier = (h) => (h.inUser ? 3 : (h.toolish ? 1 : 2))
              const better = tier(hit) > tier(cur.best)
                || (tier(hit) === tier(cur.best) && hit.count > cur.best.count)
                || (tier(hit) === tier(cur.best) && hit.count === cur.best.count && hit.snippet.length > cur.best.snippet.length)
              if (better) cur.best = hit
            }
          } else {
            rawHits.push(hit)
            if (rawHits.length >= capRaw) break
          }
        }
        if (!groupByTurn && rawHits.length >= capRaw) break
      }

      const fmtHit = (h, extra) => `[${catLabel(h)}] turn ${h.turn ?? '?'}${extra} · 行 ${h.lineNo}\n  文件：${showFile(h.file, h.folder)}\n  来源会话：${h.src ? h.src.replace(/^session-/, '').slice(0, 8) + '…' : '未知'}\n  …${h.snippet}…`

      // 摘要兜底：原文 0 命中时扫一遍 _summary.md（每月只有几 KB），
      // 避免“摘要里的概述性说法搜不到”被误当成“记忆里没有”。摘要命中不返回轮次，明确标注。
      const scanSummaries = (dirs, toks, limit = 5) => {
        const out = []
        for (const d of dirs) {
          let entries = []
          try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
          for (const e of entries) {
            if (!e.isDirectory() || !/^\d{4}-\d{2}$/.test(e.name)) continue
            let raw = ''
            try { raw = stripBom(fs.readFileSync(path.join(d, e.name, '_summary.md'), 'utf8')) } catch { continue }
            for (const b of raw.split(/\n(?=## )/)) {
              if (!b.startsWith('## ')) continue
              const low = b.toLowerCase()
              if (!toks.every((t) => low.includes(t))) continue
              const at = Math.max(0, Math.min(...toks.map((t) => { const i = low.indexOf(t); return i < 0 ? 999999 : i })) - 80)
              out.push({
                folder: path.basename(d),
                month: e.name,
                head: b.split('\n')[0].replace(/^## /, '').slice(0, 120),
                snippet: b.slice(at, at + 220).replace(/^## [^\n]*\n?/, '').replace(/\s+/g, ' ').trim(),
              })
              if (out.length >= limit) return out
            }
          }
        }
        return out
      }
      const summarySection = () => {
        try {
          const found = scanSummaries(targets.map((t) => t.dir), tokens, 5)
          if (!found.length) return ''
          return '\n\n摘要里提到（**摘要不是轮次**；要原文请换关键词，或用 palace_read 按轮次读）：\n'
            + found.map((s) => `  · ${s.month} [${s.folder}] ${s.head}\n    …${s.snippet}…`).join('\n')
        } catch (err) {
          recordEvent('summary-fallback-error', String(err?.message ?? err))
          return ''
        }
      }

      let text
      if (groupByTurn) {
        const list = [...perTurn.values()].slice(0, capTurns)
        if (list.length === 0) {
          return limitNote + `正文里没有找到「${keyword}」` + (readErrors ? `（另有 ${readErrors} 个文件读取失败）` : '') + '。' + summarySection()
        }
        text = `命中 ${list.length} 轮（按轮聚合；每轮只给一条代表命中，括号内是该轮总命中数）：\n\n`
          + list.map((h) => fmtHit(h.best, `（${h.total} 处）`)).join('\n\n')
      } else {
        if (rawHits.length === 0) {
          return limitNote + `正文里没有找到「${keyword}」` + (readErrors ? `（另有 ${readErrors} 个文件读取失败）` : '') + '。' + summarySection()
        }
        text = `命中 ${rawHits.length} 行（原始命中；要按轮聚合用 groupByTurn=true）：\n\n` + rawHits.map((h) => fmtHit(h, '')).join('\n\n')
      }
      text = limitNote + text
      if (args.includeSummary) text += summarySection()
      if (readErrors > 0) text += `\n\n（有 ${readErrors} 个归档文件读取失败，已跳过）`
      if (text.length > MAX_OUT) {
        text = text.slice(0, MAX_OUT) + `\n…（结果过长已截断；请缩小范围：加 category / date，或调小 limitTurns）`
        recordEvent('search-truncated', `keyword=${keyword} chars=${text.length}`)
      }
      return text
    },
  })
}

/** 轮次清单：归档前先看清“哪一轮装了什么”，避免用消息条数换算 turn。 */
function registerTurnsTool(ctx, read) {
  return ctx.tools.register({
    name: 'palace_turns',
    description:
      '列出本会话的轮次清单（turn 号 + 发言者 + 开头片段），用于归档前确认“每一轮装的是什么”。'
      + 'turn 是日志事件序号（含系统指令、插件 steer、纯工具轮），不要用“第几条消息”换算。'
      + '不传范围时给最近 40 轮；最多返回 80 行。只读。',
    parameters: {
      type: 'object',
      properties: {
        fromTurn: { type: 'number', description: '起始轮次（含）。' },
        toTurn: { type: 'number', description: '结束轮次（含）。' },
        limit: { type: 'number', description: '最多返回多少行，默认 40（上限 80）。' },
      },
      required: [],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      const cwd = String(agent?.session?.header?.cwd ?? '')
      const sid = sessionIdOf(agent)
      const cfg = resolveConfig(read, cwd, sid)
      const { turns } = await loadTurns(agent, cfg)
      if (!turns || turns.length === 0) throw new Error('读不到会话日志。')
      const last = turns[turns.length - 1].turn
      const cap0 = Math.min(Math.max(Number(args.limit) || 40, 1), 80)
      // 不传范围 = 最近 cap0 轮（从尾部取，不是从会话开头）。
      const lo = Number.isFinite(args.fromTurn) ? Number(args.fromTurn) : Math.max(1, last - cap0 + 1)
      const hi = Number.isFinite(args.toTurn) ? Number(args.toTurn) : last
      const cap = cap0
      const list = turns.filter((t) => t.turn >= lo && t.turn <= hi).slice(0, cap)
      if (list.length === 0) return `turn ${lo}–${hi} 之间没有轮次（日志里最新的是 turn ${last}）。`
      const pick = (t, kinds) => t.items.find((it) => kinds.includes(it.kind) && it.text)
      // 每轮摘要：主句最多 70 字；主句太短（<=30 字）时补上一轮/下一轮首句，各最多 30 字；
      // 整行硬上限 150 字——能看懂「已重启」「晚安」在干什么，清单也不会变长。
      const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
      const summarizeTurn = (t) => {
        const u = pick(t, ['user'])
        const a = pick(t, ['text'])
        const tool = t.items.find((it) => it.kind === 'tool-call')
        if (u) return { who: '用户', text: clip(u.text, 70) }
        if (a) return { who: '助手', text: clip(a.text, 70) }
        if (tool) return { who: '工具轮', text: `tool: ${String(tool.name ?? '').split(/[\\/]/).pop()}` }
        if (t.items.some((it) => it.kind === 'reasoning')) return { who: '仅思考', text: '' }
        return { who: '空', text: '' }
      }
      const lines = list.map((t) => {
        const s = summarizeTurn(t)
        let line = `[${t.turn}] ${s.who}：${s.text}`
        if (s.text.length <= 30) {
          const i = turns.findIndex((x) => x.turn === t.turn)
          const ctx = []
          if (i > 0) {
            const p = summarizeTurn(turns[i - 1])
            if (p.text) ctx.push(`前[${turns[i - 1].turn}] ${p.who}：${clip(p.text, 30)}`)
          }
          if (i >= 0 && i < turns.length - 1) {
            const n = summarizeTurn(turns[i + 1])
            if (n.text) ctx.push(`后[${turns[i + 1].turn}] ${n.who}：${clip(n.text, 30)}`)
          }
          if (ctx.length) line += ` ｜ ${ctx.join(' ｜ ')}`
        }
        return line.length > 150 ? line.slice(0, 150) + '…' : line
      })
      const more = turns.filter((t) => t.turn >= lo && t.turn <= hi).length > cap ? `\n（只显示前 ${cap} 行；缩小范围或调小 limit）` : ''
      return `turn ${lo}–${hi}（日志共 ${turns.length} 轮，最新 turn ${last}）：\n` + lines.join('\n') + more
    },
  })
}

function registerSummaryTool(ctx, read) {
  return ctx.tools.register({
    name: 'palace_summary',
    description:
      '读本会话的「月度记忆摘要」（<会话>/<YYYY-MM>/_summary.md，每月一份、只追加，段头标注类别+轮次）。'
      + '不知道某段记忆在哪个年月时：先按大致年月范围读摘要 → 定位到具体归档文件 → 再用 palace_search / palace_read 取原文。'
      + '不指定 month 时列出最近几个月的摘要末尾；给了 month（YYYY-MM）返回该月摘要全文，可加 category 只看某类。只读。',
    parameters: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: '可选：别的会话的命名空间名；省略 = 只看自己。' },
        append: {
          type: 'string',
          description: '可选：写一段摘要到当月（或 month 指定月）的 _summary.md 末尾。'
            + '用于给“还没归档、但已经聊过的重要近况”补摘要——只概述你指定的那几轮，200–800 字。',
        },
        fromTurn: { type: 'number', description: '配合 append：这段摘要覆盖的起始轮次（用于段头标注）。' },
        toTurn: { type: 'number', description: '配合 append：这段摘要覆盖的结束轮次。' },
        month: { type: 'string', description: '可选 YYYY-MM；给了就返回该月摘要全文（上限 6 万字符）；配合 append 时指定写入月份。' },
        category: { type: 'string', description: '可选：只看该月里某个类别的摘要段落。' },
        limit: { type: 'number', description: '不指定 month 时列出最近几个月，默认 12（上限 36）。' },
      },
      required: [],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const cwd = String(exec.agent?.session?.header?.cwd ?? '')
      const sid = sessionIdOf(exec.agent)
      const cfg = resolveConfig(read, cwd, sid)
      const picked = pickNsDir(cwd, cfg.rootDirName, sid, args.namespace)
      if (!picked.ok) throw new Error(`找不到记忆命名空间「${String(args.namespace).trim()}」。`)
      const nsDir = picked.dir
      const catFilter = String(args.category ?? '').trim()

      // 补写摘要：给「还没归档、但已经聊过」的近期内容落一段摘要，让摘要层永远覆盖到最近。
      const appendText = String(args.append ?? '').trim()
      if (appendText) {
        if (!cfg.name) throw new Error('本会话还没命名，不能写摘要。先在页签里命名。')
        // 只能写自己的命名空间：跨会话写摘要等于污染别人的记忆。
        if (picked.folder !== cfg.folder) {
          throw new Error(`只能写本会话（${cfg.folder}）的摘要，不能写「${picked.folder}」。`)
        }
        const month = String(args.month ?? '').trim() || fmtMonth(Date.now())
        if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month 格式是 YYYY-MM，例如 2026-10。')
        const lo = Number(args.fromTurn)
        const hi = Number(args.toTurn)
        const span = Number.isFinite(lo) && Number.isFinite(hi)
          ? `[${catFilter || 'live'}] ${lo === hi ? `turn ${lo}` : `turn ${lo}–${hi}`}`
          : `[${catFilter || 'live'}] 补记`
        const file = appendMonthSummary({ nsDir, month, label: span, text: appendText })
        return `已追加摘要：${path.relative(cwd, file).replace(/\\/g, '/')}`
      }

      const months = fs.existsSync(nsDir)
        ? fs.readdirSync(nsDir).filter((n) => {
          if (!/^\d{4}-\d{2}$/.test(n)) return false
          try { return fs.statSync(path.join(nsDir, n)).isDirectory() } catch { return false }
        }).sort()
        : []
      if (months.length === 0) return '还没有任何月度摘要（归档之后才会有）。'

      const countFiles = (m) => {
        let c = 0
        const d = path.join(nsDir, m)
        for (const cat of fs.readdirSync(d)) {
          const p = path.join(d, cat)
          try { if (!fs.statSync(p).isDirectory()) continue } catch { continue }
          c += fs.readdirSync(p).filter((f) => f.endsWith('.md') && f !== '_summary.md').length
        }
        return c
      }

      const month = String(args.month ?? '').trim()
      if (month) {
        if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month 格式是 YYYY-MM，例如 2026-10。')
        const file = path.join(nsDir, month, '_summary.md')
        if (!fs.existsSync(file)) throw new Error(`没有 ${month} 的摘要文件。`)
        let text = fs.readFileSync(file, 'utf8')
        if (catFilter) {
          const blocks = text.split(/\n(?=## )/)
          const head = blocks.shift() ?? ''
          const keep = blocks.filter((b) => b.includes(`[${catFilter}]`))
          if (keep.length === 0) throw new Error(`${month} 的摘要里没有类别「${catFilter}」。`)
          text = [head, ...keep].join('\n')
        }
        // 动态补文件路径：段头不写死路径，读的时候按索引实时解析（改名/搬移不会产生死链）。
        try {
          const rowsPath = path.join(nsDir, 'index.jsonl')
          const rows = fs.existsSync(rowsPath)
            ? stripBom(fs.readFileSync(rowsPath, 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
            : []
          const showFile = (rel) => {
            const norm = String(rel ?? '').replace(/\\/g, '/')
            return norm.startsWith(cfg.rootDirName + '/') ? norm : `${picked.folder}/${norm}`
          }
          text = text.replace(/^## (.+?)$/gm, (line, rest) => {
            const m = /\[([^\]]+)\]\s*turn\s+(\d+)(?:\s*[–-]\s*(\d+))?/.exec(rest)
            if (!m) return line
            const cat = m[1]
            const a = Number(m[2])
            const b = m[3] ? Number(m[3]) : a
            const row = rows.find((r) => r.category === cat && Number(r.fromTurn) <= a && b <= Number(r.toTurn))
            return row ? `${line}  → 文件：${showFile(row.file)}` : line
          })
        } catch { /* 补路径失败不影响读摘要 */ }
        const cap = 60000
        const note = '> turn = 日志事件序号（含系统指令、插件注入、工具调用），不是“第几条消息”。\n\n'
        return note + (text.length > cap ? text.slice(0, cap) + `\n…（已截断；共 ${text.length} 字符）` : text)
      }

      const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 36)
      const recent = months.slice(-limit).reverse()
      const parts = recent.map((m) => {
        const files = countFiles(m)
        const file = path.join(nsDir, m, '_summary.md')
        if (!fs.existsSync(file)) return `${m}：无摘要（${files} 个归档文件）`
        const text = fs.readFileSync(file, 'utf8').trim()
        const tail = text.length > 700 ? '…' + text.slice(-700) : text
        return `${m}：${files} 个归档文件\n摘要末尾：\n${tail}`
      })
      return '> turn = 日志事件序号（含系统指令、插件注入、工具调用），不是“第几条消息”。\n\n'
        + `共 ${months.length} 个月份。读某月全文：palace_summary(month="YYYY-MM")。\n\n` + parts.join('\n\n— — —\n\n')
    },
  })
}

function registerReadTool(ctx, read) {
  return ctx.tools.register({
    name: 'palace_read',
    description:
      '读归档文件。推荐用法：先 palace_search 拿到文件与轮次，再用 palace_read 取那些轮次的完整原文。'
      + '可以只给 fromTurn/toTurn（自动找文件）；不给轮次则只返回开头一段（有上限）。'
      + '永远不要把整份大文件灌进上下文。只读。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '归档文件路径（可省略；省略时用 fromTurn 在索引里找）。' },
        namespace: { type: 'string', description: '可选：别的会话的记忆命名空间名；省略 = 只看自己。' },
        fromTurn: { type: 'number', description: '起始轮次（含）。给了就和 toTurn 一起按轮次切片。' },
        toTurn: { type: 'number', description: '结束轮次（含）。' },
        maxChars: { type: 'number', description: '最多返回字符数，默认 60000（上限 60000）。' },
        offset: { type: 'number', description: '字符偏移；单轮超过上限时用它分段读，返回值会告诉下一次的 offset。' },
      },
      required: [],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const cwd = String(exec.agent?.session?.header?.cwd ?? '')
      const sid = sessionIdOf(exec.agent)
      const cfg = resolveConfig(read, cwd, sid)
      const picked = pickNsDir(cwd, cfg.rootDirName, sid, args.namespace)
      if (!picked.ok) throw new Error(`找不到记忆命名空间「${String(args.namespace).trim()}」。`)
      const nsDir = picked.dir
      const root = path.resolve(cwd, cfg.rootDirName)
      // path 可省略：给了 fromTurn 就去索引里找覆盖该轮次的归档文件。
      let relPath = String(args.path ?? '').replace(/\\/g, '/')
      // 允许把 search 显示的「文件夹/…」路径直接粘回来，去掉前缀，避免双拼一层。
      if (relPath === picked.folder) relPath = ''
      else if (relPath.startsWith(picked.folder + '/')) relPath = relPath.slice(picked.folder.length + 1)
      if (!relPath) {
        const wantTurn = Number(args.fromTurn)
        if (!Number.isFinite(wantTurn)) {
          throw new Error('要么给 path，要么给 fromTurn（会自动找包含该轮次的归档文件）。')
        }
        const indexPath = path.join(nsDir, 'index.jsonl')
        const rows = fs.existsSync(indexPath)
          ? stripBom(fs.readFileSync(indexPath, 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
          : []
        const hit = rows.filter((r) => Number(r.fromTurn) <= wantTurn && wantTurn <= Number(r.toTurn)).pop()
        if (!hit) throw new Error(`索引里没有覆盖 turn ${wantTurn} 的归档。`)
        relPath = resolveArchivePath(cwd, cfg.rootDirName, nsDir, hit.file)
      }
      const abs = path.isAbsolute(relPath) ? relPath : resolveArchivePath(cwd, cfg.rootDirName, nsDir, relPath)
      const inside = path.relative(root, abs)
      if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
        throw new Error(`只能读 ${cfg.rootDirName}/ 下的文件。`)
      }
      // 只允许读本命名空间（或 legacy 根下本命名空间的归档），且不暴露元数据文件。
      const normRel = String(relPath).replace(/\\/g, '/')
      const isLegacy = normRel.startsWith(cfg.rootDirName + '/')
      const inNs = path.relative(nsDir, abs)
      if (isLegacy) {
        // legacy 前缀路径必须落在本会话命名空间内，否则等于绕过隔离直读别人原文。
        const afterRoot = normRel.slice(cfg.rootDirName.length + 1)
        const firstSeg = afterRoot.split('/')[0]
        if (firstSeg !== picked.folder) {
          throw new Error(`只能读本会话命名空间（${picked.folder}）下的文件；跨会话请用 namespace 参数走工具接口。`)
        }
      } else if (inNs === '' || inNs.startsWith('..') || path.isAbsolute(inNs)) {
        throw new Error('只能读本会话命名空间下的归档文件。')
      }
      if (/^(\.namespaces\.json|\.state\.json|config\.json|index\.jsonl|\.pending-index\.jsonl)$/.test(path.basename(abs))) {
        throw new Error('元数据文件不可读，请用 palace_config / palace_summary。')
      }
      if (!fs.existsSync(abs)) throw new Error('文件不存在：' + relPath)
      const size = fs.statSync(abs).size
      const reqMax = Number(args.maxChars)
      const cap = Math.min(Math.max(Number.isFinite(reqMax) && reqMax > 0 ? reqMax : 60000, 500), 60000)
      const capNote = Number.isFinite(reqMax) && reqMax > 60000 ? `（maxChars 上限 60000，已按上限读取；请求 ${reqMax}）` : ''
      const text = fs.readFileSync(abs, 'utf8')

      let body = text
      let note = ''
      const hasRange = Number.isFinite(args.fromTurn) || Number.isFinite(args.toTurn)
      if (hasRange) {
        const from = Number.isFinite(args.fromTurn) ? Number(args.fromTurn) : 0
        const to = Number.isFinite(args.toTurn) ? Number(args.toTurn) : Number.MAX_SAFE_INTEGER
        const sliced = sliceTurns(text.split('\n'), from, to)
        if (sliced === null) throw new Error('这个文件里没有轮次标题，改用 maxChars 读开头。')
        if (!sliced) throw new Error(`文件里没有 turn ${from}–${to}。`)
        body = sliced
        note = `（只返回 turn ${from === 0 ? '最早' : from}–${to === Number.MAX_SAFE_INTEGER ? '最新' : to} 的原文）`
      }
      const rawOff = Number(args.offset)
      const off = Math.max(0, Number.isFinite(rawOff) ? rawOff : 0)
      const offNote = Number.isFinite(rawOff) && rawOff < 0 ? `（offset 为负，已按 0 处理）` : ''
      if (off > 0 && off >= body.length) throw new Error(`offset ${off} 超出范围（共 ${body.length} 字符）。`)
      const end = Math.min(off + cap, body.length)
      const piece = body.slice(off, end)
      if (capNote) note += capNote
      if (offNote) note += offNote
      if (off > 0 || end < body.length) {
        note += `（返回第 ${off}–${end} 字符 / 共 ${body.length}；${end < body.length ? `用 offset=${end} 继续` : '已到结尾'}）`
      }
      // 回链：只从“本次返回的轮次”里提取，避免把整份归档文件里的无关轮次/文件名算进来。
      // 没有指定范围时明确标成“文件级”，不冒充本轮引用。
      let links = ''
      try {
        // 只从“用户/助手正文”里提取回链：工具返回、思考、skill 正文里出现的文件名不算对话引用（FIX-6）。
        const convOnly = (src) => {
          const out = []
          let keep = false
          for (const line of String(src).split('\n')) {
            if (line.startsWith('### ')) {
              keep = line.startsWith('### 用户') || line.startsWith('### 助手（assistant）')
              continue
            }
            if (keep) out.push(line)
          }
          return out.join('\n')
        }
        const linkSource = hasRange ? convOnly(body) : ''
        const turnSet = new Set()
        for (const m of linkSource.matchAll(/\bturn\s+(\d{1,6})\b/gi)) turnSet.add(Number(m[1]))
        const files = new Set()
        for (const m of linkSource.matchAll(/[A-Za-z0-9_.\-\u4e00-\u9fa5]+\.(?:md|js|cjs|mjs|ts|json|ps1|cmd|txt|zip|tgz|png|jpg)\b/gi)) files.add(m[0])
        const tools = new Set()
        for (const m of linkSource.matchAll(/\b(?:palace_archive|palace_search|palace_read|palace_summary|palace_turns|palace_config)\b/g)) tools.add(m[0])
        const ownTurns = new Set()
        if (hasRange) {
          const from = Number.isFinite(args.fromTurn) ? Number(args.fromTurn) : 0
          const to = Number.isFinite(args.toTurn) ? Number(args.toTurn) : Number.MAX_SAFE_INTEGER
          for (let t = from; t <= Math.min(to, from + 200); t++) ownTurns.add(t)
        }
        const otherTurns = [...turnSet].filter((t) => !ownTurns.has(t)).sort((a, b) => a - b).slice(0, 10)
        const parts = []
        if (otherTurns.length) parts.push(`turn ${otherTurns.join(', ')}`)
        if (files.size) parts.push(`文件 ${[...files].slice(0, 5).join(', ')}`)
        if (tools.size) parts.push(`工具 ${[...tools].slice(0, 5).join(', ')}`)
        if (parts.length) {
          links = hasRange
            ? `\n\n回链（仅限本次读取的轮次）：${parts.join(' · ')}（自动提取，仅供参考）`
            : `\n\n回链（文件级，非本轮引用；要本轮级别请传 fromTurn/toTurn）：${parts.join(' · ')}（自动提取，仅供参考）`
        }
      } catch { /* 提取失败不影响读取 */ }
      const out = note ? `${note}\n\n${piece}` : piece
      return (links && off === 0 ? out + links : out)
    },
  })
}

/** 工作区级配置工具：让会话模型能查/改本工作区的阈值，不需要界面。 */
function registerConfigTool(ctx, read) {
  return ctx.tools.register({
    name: 'palace_config',
    description:
      '查看或修改当前工作区的记忆回廊配置（memory-palace/config.json）。'
      + '可改项：enabled、triggerPressure、retainBytes、maxFileBytes、checkEveryTurns、minBatchTurns、selfNameSlug、includeReasoning、compactAfterArchive、injectNotice。'
      + '只影响当前工作区，不改变其他工作区与全局默认。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set'], description: 'get 查看，set 修改。' },
        values: { type: 'object', description: 'set 时的键值对，只接受可改项。' },
      },
      required: ['action'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const cwd = String(exec.agent?.session?.header?.cwd ?? '')
      if (!cwd) throw new Error('读不到当前工作区路径。')
      const sid = sessionIdOf(exec.agent)
      const cfg = resolveConfig(read, cwd, sid)
      if (args.action === 'get') {
        const ws = loadWorkspaceConfig(cwd, cfg.rootDirName)
        const sc = loadSessionConfig(cwd, cfg.rootDirName, sid)
        // 只展示正式键 recallBudget*；旧键 recursionMax* 仅保留在读取兼容层，不出现在输出里。
        const strip = (o) => {
          if (!o || typeof o !== 'object') return o
          const { recursionMaxDepth, recursionMaxWidth, ...rest } = o
          return rest
        }
        return JSON.stringify({ effective: strip(cfg), workspaceDefaults: strip(ws), sessionConfig: strip(sc) }, null, 2)
      }
      const input = args.values ?? {}
      const clean = {}
      for (const [k, v] of Object.entries(input)) {
        if (!OVERRIDABLE.includes(k)) throw new Error(`不允许修改的键：${k}`)
        if (k === 'enabled' || k === 'includeReasoning' || k === 'compactAfterArchive' || k === 'injectNotice' || k === 'groupByTurn') {
          clean[k] = Boolean(v)
        } else if (k === 'contextWindowTokens') {
          throw new Error(k + ' 由插件固定/自动探测，不允许手动修改。')
        } else if (k === 'searchTurnLimit') {
          const n = Number(v)
          if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error('searchTurnLimit 必须是 1–30 的整数')
          clean[k] = n
        } else if (k === 'recallStrength') {
          const allowed = ['off', 'low', 'medium', 'high', 'forced']
          const s = String(v)
          if (!allowed.includes(s)) throw new Error('recallStrength 必须是 off / low / medium / high / forced')
          clean[k] = s
        } else if (k === 'recursionMaxDepth' || k === 'recursionMaxWidth' || k === 'recallBudgetRounds' || k === 'recallBudgetKeywords') {
          const n = Number(v)
          if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`${k} 必须是 1–5 的整数`)
          clean[k] = n
        } else if (k === 'retainFraction') {
          const n = Number(v)
          if (!(n >= 0.02 && n <= 0.5)) throw new Error('retainFraction 必须在 0.02–0.5')
          clean[k] = n
        } else if (k === 'batchByteFraction') {
          const n = Number(v)
          if (!(n >= 0.05 && n <= 1)) throw new Error('batchByteFraction 必须在 0.05–1')
          clean[k] = n
        } else if (k === 'triggerPressure') {
          const n = Number(v); if (!(n >= 0.2 && n <= 0.95)) throw new Error('triggerPressure 必须在 0.2–0.95')
          clean[k] = n
        } else if (['contextWindowTokens', 'retainBytes', 'maxFileBytes', 'checkEveryTurns', 'minBatchTurns'].includes(k)) {
          const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${k} 必须是非负数字`)
          clean[k] = Math.floor(n)
        } else if (k === 'selfNameSlug') {
          const s = String(v); if (!/^[a-z][a-z0-9-]{1,63}$/.test(s)) throw new Error('selfNameSlug 必须是英文小写 slug')
          clean[k] = s
        }
      }
      if (Object.keys(clean).length === 0) throw new Error('没有可写入的字段。')
      // 写会话层（<会话>/config.json），与 /palace on|off 一致；会话层优先级最高。
      const file = path.join(cfg.dir, 'config.json')
      const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
      const next = { ...prev, ...clean }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
      return `已更新本会话配置：${JSON.stringify(clean)}\n文件：${path.relative(cwd, file).replace(/\\/g, '/')}`
    },
  })
}

/** 工作区开关命令：/palace [status|on|off]。给人用的入口，不需要界面。 */
function registerPalaceCommand(ctx, read) {
  if (!ctx?.commands || typeof ctx.commands.register !== 'function') return null
  return ctx.commands.register({
    name: 'palace',
    description: '记忆回廊：查看状态、开启/关闭当前工作区的归档',
    input: { hint: '[status|on|off]' },
    handler: async ({ agent, rawInput }) => {
      const cwd = String(agent?.session?.header?.cwd ?? '')
      if (!cwd) return { kind: 'error', text: '读不到当前工作区路径。' }
      const sid = sessionIdOf(agent)
      const cfg = resolveConfig(read, cwd, sid)
      const file = path.join(cfg.dir, 'config.json')
      const arg = String(rawInput ?? '').trim().toLowerCase() || 'status'

      if (arg === 'status') {
        const ws = loadWorkspaceConfig(cwd, cfg.rootDirName)
        const stats = await turnStats(sid, cwd, cfg)
        return {
          kind: 'success',
          text: [
            `工作区：${cwd}`,
            `记忆命名：${cfg.name || '(未命名，暂不归档)'}`,
            `文件夹：${cfg.rootDirName}/${cfg.folder}`,
            `本会话开关：${cfg.sessionEnabled ? '开' : '关'}`,
            `全局总闸：${read('enabled') === false ? '关' : '开'}（原始配置）`,
            `当前生效：${cfg.enabled && cfg.sessionEnabled && cfg.name ? '是' : '否'}`,
            `触发阈值：${(cfg.triggerPressure * 100).toFixed(0)}%（估算窗口 ${cfg.contextWindowTokens} tokens）`,
            `无需归档的近期文本量：${Math.round((cfg.contextWindowTokens || 0) * (cfg.retainFraction || 0)).toLocaleString()} tokens（窗口 × ${Math.round((cfg.retainFraction || 0) * 100)}%）`,
            `单文件上限：${(cfg.maxFileBytes / 1000000).toFixed(1)} MB（超出按轮分卷）`,
            `自动提示 steer：${cfg.enableSteer ? '开' : '关'}`,
            stats
              ? `轮次：总 ${stats.totalTurns} · 已归档 ${stats.archivedTurns} · 待归档 ${stats.pendingTurns} · 水位 ${stats.watermark}`
              : '轮次：读不到会话日志',
            (() => {
              const idx = path.join(cfg.dir, 'index.jsonl')
              if (!fs.existsSync(idx)) return '归档总量：0 份'
              let c = 0
              let b = 0
              for (const line of stripBom(fs.readFileSync(idx, 'utf8')).split('\n')) {
                if (!line.trim()) continue
                try { const r = JSON.parse(line); c += 1; b += Number(r.bytes) || 0 } catch { /* ignore */ }
              }
              return `归档总量：${c} 份 · ${(b / 1024 / 1024).toFixed(2)} MB`
            })(),
            (() => {
              const st = readState(cwd, cfg.rootDirName, sid)
              const s = st[sid] ?? {}
              return `本会话：上次检查 turn ${s.lastCheckTurn ?? '-'}，上次归档 ${s.lastArchiveRange ?? '-'}（${s.lastArchiveAt ?? '-'}）`
            })(),
            (() => {
              // 对账：状态区间 vs 索引真实覆盖，把“区间说有、索引没有”的轮次揪出来。
              const st = readState(cwd, cfg.rootDirName, sid)
              const s = st[sid] ?? {}
              const ranges = Array.isArray(s.archivedRanges) ? s.archivedRanges : []
              if (ranges.length === 0) return '对账：无归档区间'
              const idx = path.join(cfg.dir, 'index.jsonl')
              if (!fs.existsSync(idx)) return `对账：状态有 ${ranges.length} 段区间，但索引不存在`
              const cov = new Set()
              for (const line of stripBom(fs.readFileSync(idx, 'utf8')).split('\n')) {
                if (!line.trim()) continue
                let r
                try { r = JSON.parse(line) } catch { continue }
                if (Array.isArray(r.turns) && r.turns.length > 0) for (const t of r.turns) cov.add(Number(t))
                else for (let t = Number(r.fromTurn); t <= Number(r.toTurn); t++) cov.add(t)
              }
              const missing = []
              for (const [a, b] of ranges) for (let t = a; t <= b; t++) if (!cov.has(t)) missing.push(t)
              if (missing.length === 0) return '对账：状态区间与索引一致'
              return `对账：状态里有 ${missing.length} 轮没进索引（${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''}），可对这些轮次补归档`
            })(),
            `工作区覆盖：${JSON.stringify(ws)}`,
            `配置文件：${path.relative(cwd, file).replace(/\\/g, '/')}`,
          ].join('\n'),
        }
      }

      if (arg === 'on' || arg === 'off') {
        let prev = {}
        try { prev = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { prev = {} }
        prev.enabled = arg === 'on'
        delete prev.retainTurns // 废弃键，写配置时顺手清掉
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(prev, null, 2), 'utf8')
        return {
          kind: 'success',
          text: arg === 'on'
            ? `记忆回廊已对本会话开启。文件夹：${cfg.rootDirName}/` + (cfg.name ? '' : '（未命名，命名并保存后才开始归档）')
            : '记忆回廊已对本会话关闭。已有归档不会被删除。',
        }
      }

      return { kind: 'error', text: '用法：/palace [status|on|off]' }
    },
  })
}

export function apply(ctx, config) {
  const read = makeReader(config)
  // 页签里的「手动归档」按钮复用工具执行器，避免两套归档逻辑。
  let archiveExecute = null
  // 注册失败只记日志，绝不把异常抛给插件树（一次空包曾把 workspaceController 整个带崩）。
  for (const register of [registerArchiveTool, registerTurnsTool, registerSearchTool, registerSummaryTool, registerReadTool, registerConfigTool]) {
    try {
      const def = register(ctx, read)
      if (def && def.name === 'palace_archive' && typeof def.execute === 'function') archiveExecute = def.execute
    } catch (err) {
      safeLog(ctx, 'tool registration failed: ' + (err?.message ?? String(err)))
    }
  }
  try {
    registerPalaceCommand(ctx, read)
  } catch (err) {
    safeLog(ctx, 'command registration failed: ' + (err?.message ?? String(err)))
  }
  // 常驻提示：让「查长期记忆」成为默认动作，而不是碰巧想起。
  try {
    const guidance = '【长期记忆·记忆回廊】你的记忆在 memory-palace/<你的记忆名>/，'
      + '这个文件夹里的文件都属于你，不要靠文件名前缀判断归属（前缀只是历史署名）；记忆名在「记忆回廊」页签里能看到。'
      + '何时查：涉及更早的细节、旧决定、被压缩掉的历史，或用户问起"之前说过什么"；前文能回答的别查，别反复搜同一件事。'
      + '怎么查：不确定在哪个年月时，先 palace_summary 读大致年月范围的摘要（摘要在 <年月>/_summary.md，每月一份、按类别分段；可用 category 只看某类），定位到具体归档文件，再 palace_search 找轮次（可加 category 过滤），最后 palace_read 取原文；不要凭印象编造，没命中就直说没有记录。'
      + '补摘要：重要近况还没归档时，可用 palace_summary(append=…, fromTurn, toTurn) 主动补一段到当月摘要，让摘要层覆盖到最近。'
      + '归档：只在系统提示你归档时调用 palace_archive，按 segments 逐轮给类别，并用 summaries 只概述“本次被归档的那几轮”（每个类别一段）；本会话未命名时不要归档。'
      + '归档前先用 palace_turns 看清每轮内容再分类；turn 是日志事件序号（含系统指令/插件提示/纯工具轮），禁止用“第几条消息”换算。'
      + '跨会话：默认只查自己；要读同工作区其他会话，显式传 namespace（对方文件夹名）。别人的记忆只作参考，别把别人的约定当成你的规则。'
      + '只读：不要修改或删除 memory-palace 下的任何文件。'
    ctx.inject(['systemPrompt'], (prompted) => {
      prompted.get('systemPrompt').section({
        name: 'memory-palace-recall',
        order: 160,
        text: () => (read('enabled') === false ? '' : guidance),
      })
      // 静默前置注入：请求组装前把头部/压缩摘要放进上下文（不走 steer、不产生二次回答）。
      prompted.get('systemPrompt').context({
        name: 'memory-palace-recall-context',
        order: 900,
        interpolate: false,
        // required：宿主抑制“可选”运行时上下文时也会保留；不标记可能被过滤，
        // 表现为 provider 被调用过、但模型上下文里看不到。
        required: true,
        text: (assembleCtx) => recallContextText(read, assembleCtx),
      })
    })
  } catch (err) {
    safeLog(ctx, 'guidance registration failed: ' + (err?.message ?? String(err)))
  }
  // 会话页签的数据接口（客户端半通过 fetch 调它）。
  // 只挂 exact：DSH 的 prefix 路由匹配规则与预期不同，实测 exact 稳定。
  try {
    let web = ctx.webServer
    if (!web && typeof ctx.get === 'function') { try { web = ctx.get('webServer') } catch { /* ignore */ } }
    if (web && typeof web.register === 'function') {
      const handler = createMemoryPalaceRoute({
        ctx, read, resolveConfig, readState, writeState, effectiveWindow, turnStats,
        ns: { sanitizeName, loadNsMap, saveNsMap, nsFor },
        getEvents: () => eventLog.slice(-20),
        gateState,
        logScan: scanSessionLog,
        archive: archiveExecute
          ? async ({ cwd, sessionId, category, fromTurn, toTurn }) => {
            const fakeAgent = { session: { header: { cwd, id: sessionId } } }
            return archiveExecute({ category, fromTurn, toTurn }, { agent: fakeAgent })
          }
          : null,
        // 手动归档 = 给模型发一条指令，类别由模型自己判断。
        requestArchive: async ({ cwd, sessionId }) => {
          const agent = ctx.agents?.get?.(sessionId)
          if (!agent) throw new Error('这个会话当前不在运行，没法给它发归档指令；请切到该会话再点。')
          const cfg = resolveConfig(read, cwd, sessionId)
          const { turns } = await loadTurns(agent, cfg)
          if (!turns || turns.length === 0) throw new Error('读不到会话日志，未发送指令。')
          const win = await effectiveWindow(agent, cfg)
          const state = readState(cwd, cfg.rootDirName, sessionId)
          const { eligible } = planRange(turns, cfg, state, sessionId, win)
          if (eligible.length === 0) {
            return '暂无可归档轮次：其余都在保留区内（窗口的 12%）。'
          }
          const lo = eligible[0].turn
          const hi = eligible[eligible.length - 1].turn
          const text = `【手动归档】用户在页签里点了「现在归档」。请调用 palace_archive，用 segments 逐段给类别，覆盖 turn ${lo}–${hi}；`
            + '先调用 palace_turns 看清每一轮装的是什么，再决定类别——turn 是日志事件序号，不要用“第几条消息”换算。'
            + '逐轮判断每轮属于哪个类别（英文小写 slug），同一类别可拆多段，每个 turn 只能归一类；同一次调用里同一类别写进同一个文件。'
            + 'summaries 只概述“本次被归档的那几轮”，不要写归档区间之外的内容（否则摘要会指向不存在的原文）。'
            + '不要解释、不要复述原文，完成后一句话告诉我结果即可。'
          const message = assertUserMessage({
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: 'dsh-memory-palace' },
          })
          agent.steer(message)
          safeLog(ctx, `manual archive requested: turn ${lo}-${hi}`)
          return `已提醒模型归档 turn ${lo}–${hi}，类别由它判断。`
        },
        log: (m) => safeLog(ctx, m),
      })
      ctx.effect(() => web.register({ kind: 'exact', path: MEMORY_PALACE_ROUTE, handler }), 'memory-palace: data route')
    }
  } catch (err) {
    safeLog(ctx, 'route registration failed: ' + (err?.message ?? String(err)))
  }

  // 监听上下文压缩完成：给该会话打“下次组装注入完整摘要”的标记。
  // 事件来自首方用法（dsh-client-product-analytics 也这么听）；收不到不会报错，只会静默失效，
  // 所以这里额外记事件，页签“最近事件”里能看到有没有触发。
  try {
    ctx.on('session/event', (session, event) => {
      try {
        const sid = session?.header?.id ?? session?.id
        if (!sid || !event) return
        // 记录最后一条用户消息来源：插件自己 steer 出来的消息不能再触发下一轮 steer（FIX-2）。
        if (event.type === 'user/message') {
          const kind = event.data?.source?.kind
          if (typeof kind === 'string' && kind) lastUserSourceBySid.set(String(sid), kind)
          return
        }
        if (event.type !== 'compaction/end') return
        pendingFullAfterCompaction.add(String(sid))
        recordEvent('compaction-detected', String(sid).slice(0, 8) + '…')
      } catch { /* ignore */ }
    })
  } catch (err) {
    safeLog(ctx, 'session/event subscribe failed: ' + (err?.message ?? String(err)))
  }

  // 每 checkEveryTurns 轮检查一次：估算占用率，达到阈值就 steer 一句，让模型去归档。
  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    try {
      await onTurnStopping(ctx, read, agent, turn)
    } catch (err) {
      safeLog(ctx, 'turn-stopping failed: ' + (err?.message ?? String(err)))
    }
  })
}

/** 回忆强度：forced 每条消息后强制检索；中/高由 systemPrompt.context 前置注入摘要。进程级状态，重启清空。 */
const recallForcedAt = new Map()
// 注入后标记“下一轮是模型对这条 steer 的回应”，跳过它，避免 steer→turn→steer 自激。
const awaitingSteerReply = new Set()
// 最后一条用户消息的来源（user / dsh-memory-palace / …），用来识别“本轮本身就是插件注入”。
const lastUserSourceBySid = new Map()
// 上次发 steer 的时间：短冷却窗兜底，防止工具步连续 turn-stopping 时连发多条指令。
const lastSteerSentAt = new Map()
const STEER_COOLDOWN_MS = 15000

/**
 * 记忆注入策略（两条独立链，都是一次性普通上下文消息，不是系统提示）：
 * 1. 每次启动后首轮：注入极简头部（约百来字），只提示“有记忆可用”；
 * 2. 每次上下文压缩完成后（compaction/end）：注入最近一个月的完整摘要一次，直到下次压缩。
 *    最近一个月摘要不足 500 token 时，最多再往前补一个月；没有就停。
 */
const pendingFullAfterCompaction = new Set()

/**
 * 压缩后只给“去读哪个归档摘要”的指引，不注入全文（避免与宿主压缩摘要抢注意力，也省 token）。
 * 当前年月没有摘要时，最多往前追溯一个月；都没有就不注入。
 */
function listSummaryMonths(cfg) {
  try {
    return fs.readdirSync(cfg.dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse()
      .filter((m) => fs.existsSync(path.join(cfg.dir, m, '_summary.md')))
  } catch { return [] }
}

function pickCompactionNotice(cfg, minTokens = 500) {
  // 用“实际有摘要的最新月份”，而不是日历当前月：跨月/跨年很久没聊时，
  // 日历月可能是空的，按日历算会指向不存在的摘要。
  const months = listSummaryMonths(cfg)
  if (months.length === 0) return null
  const picked = [months[0]]
  let firstText = ''
  try { firstText = stripBom(fs.readFileSync(path.join(cfg.dir, months[0], '_summary.md'), 'utf8')) } catch { /* ignore */ }
  if (estimateTokens(firstText) < minTokens && months[1]) picked.push(months[1])
  return {
    months: picked,
    files: picked.map((m) => `${cfg.rootDirName}/${cfg.folder}/${m}/_summary.md`),
  }
}

/**
 * 动态上下文 provider（请求组装前求值）。任何异常都返回空串，绝不让提示词组装失败。
 */
function recallContextText(read, assembleCtx) {
  try {
    const agent = assembleCtx?.agent
    const cwd = String(agent?.session?.header?.cwd ?? '')
    const sid = sessionIdOf(agent)
    if (!cwd || !sid) return ''
    if (isSubagentSession(agent)) return ''
    const cfg = resolveConfig(read, cwd, sid)
    if (!gateState(cfg).active) return ''
    const strength = ['off', 'low', 'medium', 'high', 'forced'].includes(cfg.recallStrength) ? cfg.recallStrength : 'low'
    if (strength === 'off' || strength === 'low') return ''
    if (cfg.enableSteer === false) return ''
    // 压缩后：只给“去读哪份归档摘要”的指引，不注入全文。
    if (pendingFullAfterCompaction.has(sid)) {
      pendingFullAfterCompaction.delete(sid)
      const notice = pickCompactionNotice(cfg)
      recordEvent('recall-after-compaction', `…${sid.slice(-6)} ${notice ? notice.months.join(' / ') : '无摘要'}`)
      if (!notice) return ''
      // 追溯与否由代码决定：选了几个月就让模型读几个月，不再把“太短”的判断丢回给模型。
      const calls = notice.months.map((m) => `palace_summary(month="${m}")`).join(' 和 ')
      const filesTxt = notice.files.join('、')
      return '【记忆回廊 · 压缩后提示】你刚刚被自动压缩，较早的对话已被系统折成一段摘要放在上下文里。'
        + `压缩后请先调用 ${calls} 读取近期归档摘要（按类别整理；文件：${filesTxt}），再继续当前对话。`
        + '系统压缩摘要优先；它没覆盖到的内容，用归档摘要补充。'
    }
    // 启动时不注入：重启后会话历史本身已在上下文里，“上一轮聊到哪”不需要摘要补。
    // 只有压缩后（pendingFullAfterCompaction）才注入一次指引。
    return ''
  } catch (err) {
    recordEvent('recall-context-error', String(err?.message ?? err))
    return ''
  }
}

function maybeRecallSteer(agent, cfg, turn, sid) {
  if (!sid) return
  if (cfg.enableSteer === false) return // 显式关掉 steer 时，任何档位都不注入
  const strength = ['off', 'low', 'medium', 'high', 'forced'].includes(cfg.recallStrength) ? cfg.recallStrength : 'low'
  if (strength === 'off') return
  if (!gateState(cfg).active) return
  if (awaitingSteerReply.has(sid)) {
    awaitingSteerReply.delete(sid)
    recordEvent('recall-steer-skip', `turn ${turn}（本轮是对上一条 steer 的回应）`)
    return
  }
  // 本轮用户消息本身就是插件注入（不是真人输入）：绝不再触发新一轮检索，否则“指令搜指令”。
  if (lastUserSourceBySid.get(sid) === 'dsh-memory-palace') {
    recordEvent('recall-steer-skip', `turn ${turn}（本轮用户消息来自插件注入）`)
    return
  }
  const lastAt = Number(lastSteerSentAt.get(sid)) || 0
  if (Date.now() - lastAt < STEER_COOLDOWN_MS) {
    recordEvent('recall-steer-skip', `turn ${turn}（冷却中，距上次 steer ${Math.round((Date.now() - lastAt) / 1000)}s）`)
    return
  }
  const clamp = (n) => Math.min(Math.max(Number(n) || 1, 1), 5)
  const depth = clamp(cfg.recallBudgetRounds ?? cfg.recursionMaxDepth)
  const width = clamp(cfg.recallBudgetKeywords ?? cfg.recursionMaxWidth)
  const steer = (text) => {
    const msg = assertUserMessage({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: `[记忆回廊·系统注入] ${text}` }],
      source: { kind: 'dsh-memory-palace' },
    })
    agent.steer(msg)
    awaitingSteerReply.add(sid)
    lastSteerSentAt.set(sid, Date.now())
    recordEvent('recall-steer', `${strength} turn ${turn}`)
  }
  if (strength === 'forced') {
    if (recallForcedAt.get(sid) === turn) return
    recallForcedAt.set(sid, turn)
    steer(`【系统指令 · 记忆回忆】从用户这条消息里挑关键词，调用 palace_search 检索已归档原文（必要时加 all:true 扫全部命名空间）。`
      + `若用户消息里没有可检索的关键词或线索，就如实说没有可用线索、跳过检索，不要硬凑词。`
      + `若返回「归档记忆为空」就如实说没有记录，不要编造。检索后简短回答回忆到了什么。`
      + `递归预算：最多 ${depth} 轮、每轮最多 ${width} 个关键词（建议，非强制；插件不校验）。`)
    return
  }
  // 中/高/强制的“首条摘要”已改为 systemPrompt.context 前置注入（请求前生效），
  // 这里不再发 steer，避免“答完再注入导致模型二次回答”。
}

async function onTurnStopping(ctx, read, agent, turn) {
  {
    if (isSubagentSession(agent)) return // 子智能体不归档、不 steer
    const cwd = String(agent?.session?.header?.cwd ?? '')
    const sid0 = sessionIdOf(agent)
    const cfg = resolveConfig(read, cwd, sid0)
    const gate = gateState(cfg)
    if (!gate.active) {
      recordEvent('gate-off', gate.reasons.join(' / '))
      return
    }
    if (!isActiveFor(ctx, cfg, agent)) return
    try { maybeRecallSteer(agent, cfg, turn, sid0) } catch (err) { recordEvent('recall-steer-error', String(err?.message ?? err)) }
    const every = Number(cfg.checkEveryTurns) || 5
    if (every < 1 || turn % every !== 0) return
    // 快路径：先只看计量，压力没到阈值就不解码日志（否则每 3 轮卡 5–10 秒）。
    const fast = measurePressureFast(ctx, agent, cfg)
    const threshold = Number(cfg.triggerPressure) || 0.6
    if (fast && fast.pressure < threshold) {
      const st = readState(cwd, cfg.rootDirName, sid0)
      st[sid0] = {
        ...(st[sid0] ?? {}),
        lastCheckTurn: turn,
        lastCheckAt: fmtTime(Date.now()),
        lastPressure: Number(fast.pressure.toFixed(3)),
        lastPressureSource: fast.source,
      }
      try { writeState(cwd, cfg.rootDirName, st, sid0) } catch { /* ignore */ }
      return
    }
    let loaded
    try {
      loaded = await loadTurns(agent, cfg)
    } catch {
      return
    }
    const { sid, turns } = loaded
    if (!turns || turns.length === 0) return
    const state = readState(cwd, cfg.rootDirName, sid)
    const win = await effectiveWindow(agent, cfg)
    const { eligible, tailFrom } = planRange(turns, cfg, state, sid, win)
    const measured = measurePressure(ctx, agent, turns, win)
    const pressure = measured.pressure
    // 可观测性（P3-1）：先记检查点，再判可归档区间，避免“eligible 为空就什么都不留”。
    state[sid] = { ...(state[sid] ?? {}), lastCheckTurn: turn, lastCheckAt: fmtTime(Date.now()), lastPressure: Number(pressure.toFixed(3)), lastPressureSource: measured.source }
    writeState(cwd, cfg.rootDirName, state, sid)
    // 批量门槛：轮数够了，或者可归档文本量已经达到保留上限的一半（长轮次会话也能触发）。
    const minBatch = Math.max(1, Number(cfg.minBatchTurns) || 1)
    const capB = retentionCapBytes(cfg, win)
    const eligibleBytes = eligible.reduce((s, t) => s + turnBytes(t), 0)
    const byteGate = capB * (Number(cfg.batchByteFraction) || 0.5)
    if (eligible.length < minBatch && eligibleBytes < byteGate) return
    if (pressure < cfg.triggerPressure) return
    // 统一门：injectNotice / enableSteer 任一关掉就不主动提示（工具仍可用）。
    if (!gate.steer) { recordEvent('steer-off', `injectNotice=${cfg.injectNotice} enableSteer=${cfg.enableSteer}`); return }
    // 冷却：同一次归档没发生前，不重复催。否则每 checkEveryTurns 轮就弹一次，所有窗口都会刷屏。
    const lastSteer = Number(state[sid]?.lastSteerTurn ?? -99999)
    if (turn - lastSteer < Math.max(10, every * 2)) return
    const lo = eligible[0].turn
    const hi = eligible[eligible.length - 1].turn
    const kept = tailFrom < turns.length ? turns.length - tailFrom : 0
    const text =
      `【系统指令 · 记忆回廊】会话上下文占用 ${(Math.min(pressure, 9.99) * 100).toFixed(1)}%（窗口 ${cfg.contextWindowTokens} tokens${measured.source === 'log-sum' ? '，日志估算' : '，DSH 计量'}），已超过阈值 ${(cfg.triggerPressure * 100).toFixed(0)}%。`
      + `先调用 palace_turns(fromTurn=${lo}, toTurn=${hi}) 看清每一轮装的是什么，再决定类别；turn 是日志事件序号，不要用“第几条消息”换算。`
      + `再用 palace_archive 的 segments=[{category, fromTurn, toTurn}, …] 逐段给类别。`
      + `逐轮判断每轮属于哪个类别（英文小写 slug），同一类别可以拆成多段；每个 turn 只能归一类，区间不要重叠。`
      + `同一次调用里，同一类别会写进同一个文件（超过单文件上限才分卷）。`
      + `还要带 summaries=[{category, text}, …]：每个类别只概述它那几轮的关键内容（200–800 字），**不要写区间之外的内容**，否则摘要会指向不存在的原文。`
      + `不要解释、不要复述原文、不要问我，直接调用。这是内部归档动作，完成后用一句话告诉我结果即可。`
      + `（最近 ${kept} 轮保留不动，不会被归档。）`
    try {
      // steer 要的是 UserMessage 对象；传裸字符串会写坏 inbox、让会话无法加载。
      const message = assertUserMessage({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: `[记忆回廊·系统注入] ${text}` }],
        source: { kind: 'dsh-memory-palace' },
      })
      agent.steer(message)
      awaitingSteerReply.add(sid)
      lastSteerSentAt.set(sid, Date.now())
      state[sid] = { ...(state[sid] ?? {}), lastSteerTurn: turn, updatedAt: fmtTime(Date.now()) }
      writeState(cwd, cfg.rootDirName, state, sid)
    } catch (err) {
      safeLog(ctx, 'steer skipped: ' + (err?.message ?? String(err)))
    }
  }
}
