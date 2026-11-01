import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import z from '@deepseek-ai/schemastery'
import {
  resolveSessionLog, decodeEvents, decompressLog, createEventStream, estimateTokens, buildTurns, writeArchive, appendMonthSummary, reconcilePendingIndex, alreadyArchived, retainedFrom, retainedFromCapped, turnBytes, turnTokens, fmtTurnSpan, detectContextWindow, fmtTime, fmtMonth,
} from './archive.js'
import { createMemoryPalaceRoute, MEMORY_PALACE_ROUTE } from './route.js'
import { createDoc, readDoc, updateDoc, removeDoc, listDocs, searchDocs, outlineDoc } from './docs.js'
import { ensureLayout } from './layout.js'
import { loadFamilies, familyOfSession, assignRoot, joinFamily, detachFamily, abdicateRoot, dissolveFamily, familyStatus, pruneMissingMembers, electRoot, transferRoot, markFamilyRebuild, resolveFamilyRebuild, withFamilyFileLock } from './family.js'
import { expandQuery, normalizeCategory, detectCueWords } from './recall-terms.js'
import { extractCandidates } from './auto-capture.js'
import { pruneTrash } from './trash.js'

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
  coreInjection: z.string()
    .volatile()
    .default('off')
    .description('热记忆注入开关：off / on / test。off 不注入；on 正常注入；test 仅当前会话以 [测试] 头注入。默认 off，避免与其他记忆工具重复注入。'),
  coreInjectionBudget: z.number().min(1000).max(20000)
    .volatile()
    .default(10000)
    .description('memory-core 每轮注入的 token 预算；填写/读取上限为它的 130%。总用量不足时不强行塞满。'),
  coreTierImportantTurns: z.number().min(1).max(100)
    .volatile()
    .default(5)
    .description('important 级记忆至少每隔多少轮注入一次。'),
  coreTierImportantTokens: z.number().min(0).max(200000)
    .volatile()
    .default(10000)
    .description('important 级记忆累计输出 token 阈值；与轮数任一达到即注入。'),
  coreTierNormalTurns: z.number().min(1).max(200)
    .volatile()
    .default(12)
    .description('normal 级记忆至少每隔多少轮注入一次。'),
  coreTierNormalTokens: z.number().min(0).max(500000)
    .volatile()
    .default(30000)
    .description('normal 级记忆累计输出 token 阈值；与轮数任一达到即注入。'),
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
  'coreInjection', 'coreInjectionBudget',
  'coreTierImportantTurns', 'coreTierImportantTokens', 'coreTierNormalTurns', 'coreTierNormalTokens',
  'searchTurnLimit', 'groupByTurn', 'recallStrength', 'recursionMaxDepth', 'recursionMaxWidth',
  'recallBudgetRounds', 'recallBudgetKeywords',
]

const archiveIndexCache = new Map()

function readArchiveIndexCached(dir) {
  const file = path.join(dir, 'index.jsonl')
  const st = fs.statSync(file)
  const hit = archiveIndexCache.get(dir)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit
  let badLines = 0
  const rows = stripBom(fs.readFileSync(file, 'utf8')).split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { badLines++; return null }
  }).filter(Boolean)
  const value = { mtimeMs: st.mtimeMs, size: st.size, rows, badLines }
  archiveIndexCache.set(dir, value)
  return value
}

function resolveScopeTargets(cwd, cfg, sid, scope = 'own') {
  const ownFolder = cfg.folder || cfg.name
  const map = loadNsMap(cwd, cfg.rootDirName)
  const targets = new Map()
  const add = (folder) => {
    const f = String(folder || '')
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(f)) return
    const dir = path.join(cwd, cfg.rootDirName, f)
    if (fs.existsSync(path.join(dir, 'index.jsonl'))) targets.set(f, { folder: f, dir })
  }
  if (scope === 'workspace') {
    add(ownFolder)
    for (const f of Object.values(map)) add(f)
  } else if (scope === 'family') {
    add(ownFolder)
    const st = familyStatus(cwd, sid)
    const fam = st?.membership?.family
    if (fam) {
      add(map[fam.rootSessionId] || fam.rootFolder)
      for (const m of fam.members || []) add(map[m.sessionId] || m.folder)
    }
  } else {
    add(ownFolder)
  }
  return { ok: true, scope, targets: [...targets.values()] }
}

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

/** 每个工作区只做一次布局迁移；失败不阻断读取，但会在事件里留记录。 */
const layoutChecked = new Set()
function ensureWorkspaceLayout(cwd) {
  if (!cwd || layoutChecked.has(cwd)) return
  try {
    const r = ensureLayout(cwd)
    if (r.ok) {
      layoutChecked.add(cwd)
      if (r.moved?.length) recordEvent('layout-migrated', `${cwd} · ${r.moved.length} 个目录`)
    } else {
      recordEvent('layout-migration-failed', `${cwd} · ${r.error || 'unknown'}`)
    }
  } catch (err) {
    recordEvent('layout-migration-failed', `${cwd} · ${String(err?.message ?? err)}`)
  }
}

/** 合并：全局默认 ← 工作区默认 ← 本会话配置；并附上命名空间信息。 */
function resolveConfig(read, cwd, sid) {
  if (cwd) ensureWorkspaceLayout(cwd)
  const rootDirName = safeRootDirName(read('rootDirName'))
  const globalEnabled = read('enabled') !== false
  const ws = cwd ? loadWorkspaceConfig(cwd, rootDirName) : {}
  const base = {
    enabled: globalEnabled,
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
    coreInjection: String(read('coreInjection') ?? 'off'),
    coreInjectionBudget: Number(read('coreInjectionBudget') ?? 10000),
    coreTierImportantTurns: Number(read('coreTierImportantTurns') ?? 5),
    coreTierImportantTokens: Number(read('coreTierImportantTokens') ?? 10000),
    coreTierNormalTurns: Number(read('coreTierNormalTurns') ?? 12),
    coreTierNormalTokens: Number(read('coreTierNormalTokens') ?? 30000),
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
  const famLoaded = cwd ? loadFamilies(cwd) : { ok: false, state: { families: {} } }
  const membership = famLoaded.ok ? familyOfSession(famLoaded.state, sid) : null
  const familyActive = Boolean(membership && membership.family.status === 'active')
  cfg.familyId = familyActive ? membership.family.familyId : ''
  cfg.familyRole = familyActive ? membership.role : 'independent'
  cfg.familyStatus = membership?.family.status || ''
  cfg.familyRootSessionId = familyActive ? membership.family.rootSessionId : ''
  cfg.familyRootFolder = familyActive ? membership.family.rootFolder : ''
  cfg.coreFolder = familyActive && membership.role === 'child' ? membership.family.rootFolder : cfg.folder
  cfg.coreReadOnly = familyActive && membership.role === 'child'
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
  cfg.globalEnabled = globalEnabled
  cfg.enabled = globalEnabled && cfg.enabled !== false
  cfg.active = Boolean(cfg.enabled) && cfg.sessionEnabled
  cfg.coreInjection = ['off', 'on', 'test'].includes(String(cfg.coreInjection)) ? String(cfg.coreInjection) : 'off'
  cfg.coreInjectionBudget = Math.min(Math.max(Number(cfg.coreInjectionBudget) || 10000, 1000), 20000)
  cfg.coreTierImportantTurns = Math.min(Math.max(Number(cfg.coreTierImportantTurns) || 5, 1), 100)
  cfg.coreTierImportantTokens = Math.min(Math.max(Number(cfg.coreTierImportantTokens) || 10000, 1), 200000)
  cfg.coreTierNormalTurns = Math.min(Math.max(Number(cfg.coreTierNormalTurns) || 12, 1), 200)
  cfg.coreTierNormalTokens = Math.min(Math.max(Number(cfg.coreTierNormalTokens) || 30000, 1), 500000)
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
const windowCache = new Map()

function eventCachePaths(cwd, sid) {
  if (!cwd || !sid) return null
  // 工作区独立目录，名字插件专用，不和别的插件共用 .cache。
  const dir = path.join(cwd, '.memory-palace-cache', sid)
  return { dir, events: path.join(dir, 'events.jsonl.gz'), meta: path.join(dir, 'meta.json') }
}

const CACHE_MAX_BYTES = 512 * 1024 * 1024
const CACHE_MAX_SESSIONS = 32

function pruneEventCache(currentDir) {
  try {
    const root = path.dirname(currentDir)
    if (!fs.existsSync(root)) return
    const items = []
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const dir = path.join(root, ent.name)
      if (dir === currentDir) continue
      let bytes = 0
      let mtimeMs = 0
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile()) continue
        const fp = path.join(dir, f.name)
        try { const s = fs.statSync(fp); bytes += s.size; mtimeMs = Math.max(mtimeMs, s.mtimeMs) } catch { /* ignore */ }
      }
      items.push({ dir, bytes, mtimeMs })
    }
    items.sort((a, b) => a.mtimeMs - b.mtimeMs)
    let total = items.reduce((n, x) => n + x.bytes, 0)
    let count = items.length + 1
    for (const x of items) {
      if (total <= CACHE_MAX_BYTES && count <= CACHE_MAX_SESSIONS) break
      try { fs.rmSync(x.dir, { recursive: true, force: true }) } catch { /* ignore */ }
      total -= x.bytes
      count -= 1
    }
  } catch { /* 清理失败不影响读取 */ }
}

async function loadEventsWithCache(cwd, sid, log, st) {
  const paths = eventCachePaths(cwd, sid)
  if (!paths) {
    const stream = await createEventStream(log)
    stream.push(fs.readFileSync(log))
    return stream.events
  }
  let meta = null
  try { meta = JSON.parse(fs.readFileSync(paths.meta, 'utf8')) } catch { meta = null }
  const cacheUsable = meta
    && meta.version === 1
    && meta.logPath === log
    && Number(meta.size) <= st.size
    && Number(meta.size) >= 0
    && fs.existsSync(paths.events)
  if (!cacheUsable) return rebuild()
  let events = []
  try {
    const text = gunzipSync(fs.readFileSync(paths.events)).toString('utf8')
    for (const line of text.split('\n')) {
      if (line.trim()) events.push(JSON.parse(line))
    }
  } catch {
    return rebuild()
  }
  const added = st.size - Number(meta.size)
  if (added > 0) {
    try {
      const buf = fs.readFileSync(log)
      const stream = await createEventStream(log)
      stream.push(buf.subarray(Number(meta.size)))
      const fresh = stream.events
      if (fresh.length) {
        fs.appendFileSync(paths.events, gzipSync(Buffer.from(fresh.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')))
        events = events.concat(fresh)
      }
      meta = { ...meta, size: st.size, mtimeMs: st.mtimeMs, eventCount: events.length, updatedAt: new Date().toISOString() }
      const tmp = `${paths.meta}.tmp-${process.pid}`
      fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8')
      fs.renameSync(tmp, paths.meta)
      pruneEventCache(paths.dir)
    } catch {
      return rebuild()
    }
  }
  return events

  async function rebuild() {
    const stream = await createEventStream(log)
    stream.push(fs.readFileSync(log))
    const events = stream.events
    try {
      fs.mkdirSync(paths.dir, { recursive: true })
      const tmpEvents = `${paths.events}.tmp-${process.pid}`
      fs.writeFileSync(tmpEvents, gzipSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')))
      fs.renameSync(tmpEvents, paths.events)
      const tmpMeta = `${paths.meta}.tmp-${process.pid}`
      fs.writeFileSync(tmpMeta, JSON.stringify({
        version: 1, logPath: log, size: st.size, mtimeMs: st.mtimeMs, eventCount: events.length, updatedAt: new Date().toISOString(),
      }, null, 2), 'utf8')
      fs.renameSync(tmpMeta, paths.meta)
      pruneEventCache(paths.dir)
    } catch { /* 缓存写失败不影响本次读取 */ }
    return events
  }
}

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
  const cwd = String(agent?.session?.header?.cwd ?? '')
  let events
  try {
    events = await loadEventsWithCache(cwd, sid, log, st)
  } catch {
    const stream = await createEventStream(log)
    stream.push(fs.readFileSync(log))
    events = stream.events
  }
  const turns = buildTurns(events, { includeReasoning })
  const contextWindow = detectContextWindow(events)
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
      const slug = normalizeCategory(String(args.category ?? ''))
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
      // 有真实 user 消息的轮次即便同时带插件 steer 也要保留；纯注入轮才剔除。
      const byTurn = new Map(turns
        .filter((t) => t.items.length > 0 && (!t.injected || t.items.some((i) => i.kind === 'user')))
        .map((t) => [t.turn, t]))
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
          const cat = normalizeCategory(String(seg?.category ?? ''))
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
        const res = await withSessionWriteLock(sidEarly, () => writeArchive({
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
        }))
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
      const resultText = `已归档 ${allPicked.length} 轮，共 ${results.length} 个类别：\n${lines.join('\n')}${reconcileNote}${summaryNote}${compactNote}${skippedNote}`
      recordPalaceArchive(sid, {
        turns: allPicked.length,
        categories: results.length,
        fromTurn: allPicked[0]?.turn,
        toTurn: allPicked[allPicked.length - 1]?.turn,
      })
      return resultText
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
const SEARCH_CACHE_MAX_BYTES = 64 * 1024 * 1024
const SEARCH_CACHE_MAX_FILES = 100
let searchCacheBytes = 0

function evictSearchCache() {
  while (searchCache.size > SEARCH_CACHE_MAX_FILES || searchCacheBytes > SEARCH_CACHE_MAX_BYTES) {
    const key = searchCache.keys().next().value
    if (key === undefined) break
    const old = searchCache.get(key)
    if (old) searchCacheBytes -= old.size || 0
    searchCache.delete(key)
  }
}

/** 最近事件环形缓冲：steer/归档/检索失败都记一行，页签可见（不用翻会话日志）。 */
const eventLog = []
/** 仅用于页签删除 rules 的服务端确认令牌；进程重启即更换。 */
const CORE_CONFIRM_TOKEN = randomUUID()
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
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    searchCache.delete(abs)
    searchCache.set(abs, hit)
    return hit
  }
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
  const previous = searchCache.get(abs)
  if (previous) searchCacheBytes -= previous.size || 0
  searchCache.set(abs, entry)
  searchCacheBytes += st.size
  evictSearchCache()
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

const CORE_BOARDS = ['identity', 'profile', 'rules', 'memories']
const CORE_TIERS = ['mind-seal', 'important', 'normal', 'minor']
const CORE_DEFAULT_TIER = {
  identity: 'important',
  profile: 'normal',
  rules: 'mind-seal',
  memories: 'normal',
}
const CORE_SCHEMA_VERSION = 1
const CORE_READ_MAX_TOKENS = 40000

/** memory-core 目录：只对已命名且启用的会话生效；未命名不创建目录。 */
function coreDirFor(cwd, cfg) {
  if (!cwd || !cfg || !cfg.name) return null
  const folder = cfg.coreFolder || cfg.folder || cfg.name
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(String(folder))) return null
  return path.join(cwd, 'memory-palace', folder, '_core')
}

function projectStateFile(cwd, cfg) {
  const root = coreDirFor(cwd, cfg)
  return root ? path.join(root, 'projects.json') : null
}

function readProjectState(cwd, cfg) {
  const file = projectStateFile(cwd, cfg)
  if (!file || !fs.existsSync(file)) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch { return {} }
}

function isProjectEnabled(cwd, cfg, label) {
  if (!label) return true
  const docs = listDocs(cwd, cfg.name, { includeArchived: false, limit: 1000 })
  return (docs.items || []).some((d) => d.projectLabel === label && d.archived !== true && d.enabled !== false)
}

function normalizeCoreProjectLabel(raw) {
  if (raw == null) return { ok: true, label: '' }
  const label = String(raw).trim().replace(/\s+/g, ' ')
  if (!label) return { ok: true, label: '' }
  const words = label.split(' ')
  if (words.length > 5) return { ok: false, error: 'projectLabel 最多 5 个英文单词。' }
  if (!words.every((w) => /^[A-Za-z0-9][A-Za-z0-9._+#-]*$/.test(w))) {
    return { ok: false, error: 'projectLabel 只接受英文单词（字母或数字开头）。' }
  }
  return { ok: true, label }
}

function projectFolderName(label) {
  const slug = String(label).toLowerCase().replace(/[^a-z0-9._+#-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project'
  const hash = createHash('sha1').update(String(label)).digest('hex').slice(0, 6)
  return `${slug}-${hash}`
}

function projectRoot(cwd, cfg, label) {
  const core = coreDirFor(cwd, cfg)
  if (!core || !label) return ''
  const state = readProjectState(cwd, cfg)
  let folder = state[label]?.folder
  if (!folder) {
    folder = projectFolderName(label)
    state[label] = { ...(state[label] || {}), folder, enabled: state[label]?.enabled === true, archived: state[label]?.archived === true }
    writeProjectState(cwd, cfg, state)
  }
  return path.join(core, 'projects', folder)
}

function projectBoardDir(cwd, cfg, label, board) {
  const root = projectRoot(cwd, cfg, label)
  return root ? path.join(root, board) : ''
}

function listProjectCoreDirs(cwd, cfg) {
  const core = coreDirFor(cwd, cfg)
  if (!core) return []
  const root = path.join(core, 'projects')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '.orphan').map((d) => ({
    folder: d.name,
    dir: path.join(root, d.name),
  }))
}

function findProjectLabelById(cwd, cfg, id) {
  const wanted = String(id || '')
  if (!wanted) return ''
  for (const p of listProjectCoreDirs(cwd, cfg)) {
    for (const board of CORE_BOARDS) {
      const file = path.join(p.dir, board, `${wanted}.md`)
      if (!fs.existsSync(file)) continue
      const entry = parseCoreEntry(file, board)
      if (entry?.projectLabel) return entry.projectLabel
    }
  }
  return ''
}

function writeProjectState(cwd, cfg, state) {
  const file = projectStateFile(cwd, cfg)
  if (!file) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return true
}

function setProjectEnabled(cwd, cfg, label, enabled) {
  const clean = String(label || '').trim().slice(0, 80)
  if (!clean) return { ok: false, error: '项目 label 不能为空。' }
  const state = readProjectState(cwd, cfg)
  state[clean] = {
    ...(state[clean] || {}),
    enabled: Boolean(enabled),
    archived: enabled ? false : state[clean]?.archived === true,
    updatedAt: new Date().toISOString(),
  }
  writeProjectState(cwd, cfg, state)
  return { ok: true, label: clean, enabled: Boolean(enabled) }
}

function listProjectLabels(cwd, cfg) {
  const labels = new Set(Object.keys(readProjectState(cwd, cfg)))
  for (const board of CORE_BOARDS) {
    for (const e of readCoreBoard(cwd, cfg, board).entries) {
      if (e.projectLabel) labels.add(e.projectLabel)
    }
  }
  for (const d of listDocs(cwd, cfg.name, { includeArchived: true, limit: 1000 }).items || []) {
    if (d.projectLabel) labels.add(d.projectLabel)
  }
  const state = readProjectState(cwd, cfg)
  return [...labels].sort().map((label) => ({
    label,
    enabled: isProjectEnabled(cwd, cfg, label),
    archived: state[label]?.archived === true,
  }))
}

function setProjectArchived(cwd, cfg, label, archived) {
  const clean = String(label || '').trim().slice(0, 80)
  if (!clean) return { ok: false, error: '项目 label 不能为空。' }
  const state = readProjectState(cwd, cfg)
  state[clean] = {
    ...(state[clean] || {}),
    enabled: archived ? false : state[clean]?.enabled === true,
    archived: Boolean(archived),
    updatedAt: new Date().toISOString(),
  }
  writeProjectState(cwd, cfg, state)
  return { ok: true, label: clean, archived: Boolean(archived) }
}

function syncProjectArchive(cwd, cfg, label, opts = {}) {
  const clean = String(label || '').trim()
  if (!clean) return
  const docs = listDocs(cwd, cfg.name, { includeArchived: false, limit: 1000 })
  const active = (docs.items || []).some((d) => d.projectLabel === clean && d.archived !== true)
  if (active) return
  setProjectArchived(cwd, cfg, clean, true)
  if (opts.orphan) orphanProjectCore(cwd, cfg, clean)
}

function orphanProjectCore(cwd, cfg, label) {
  const core = coreDirFor(cwd, cfg)
  if (!core) return
  const state = readProjectState(cwd, cfg)
  const folder = state[label]?.folder || projectFolderName(label)
  const src = path.join(core, 'projects', folder)
  if (!fs.existsSync(src)) return
  const orphanRoot = path.join(core, 'projects', '.orphan')
  fs.mkdirSync(orphanRoot, { recursive: true })
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  let dest = path.join(orphanRoot, `${folder}-${ts}`)
  let n = 1
  while (fs.existsSync(dest)) dest = path.join(orphanRoot, `${folder}-${ts}-${n++}`)
  fs.renameSync(src, dest)
  state[label] = {
    ...(state[label] || {}),
    folder,
    enabled: false,
    archived: true,
    orphaned: true,
    orphanPath: path.relative(core, dest).replace(/\\/g, '/'),
    updatedAt: new Date().toISOString(),
  }
  writeProjectState(cwd, cfg, state)
}

function updateDocWithProjectEffects(cwd, cfg, sid, id, input) {
  const before = (listDocs(cwd, cfg.name, { includeArchived: true, limit: 1000 }).items || []).find((d) => d.id === id)
  const r = updateDoc(cwd, cfg.name, sid, id, input || {})
  if (r.ok && before?.projectLabel && r.doc?.projectLabel && before.projectLabel !== r.doc.projectLabel) {
    migrateProjectCoreLabel(cwd, cfg, before.projectLabel, r.doc.projectLabel)
  }
  if (r.ok && r.doc?.projectLabel) {
    if (r.doc.enabled !== false && r.doc.archived !== true) restoreProjectOrphan(cwd, cfg, r.doc.projectLabel)
    else syncProjectArchive(cwd, cfg, r.doc.projectLabel)
  }
  return r
}

function restoreProjectOrphan(cwd, cfg, label) {
  const clean = String(label || '').trim()
  if (!clean) return
  const core = coreDirFor(cwd, cfg)
  if (!core) return
  const state = readProjectState(cwd, cfg)
  const info = state[clean]
  if (!info?.orphaned || !info.orphanPath) return
  const src = path.join(core, info.orphanPath)
  const folder = info.folder || projectFolderName(clean)
  const dest = path.join(core, 'projects', folder)
  if (!fs.existsSync(src) || fs.existsSync(dest)) return
  fs.renameSync(src, dest)
  state[clean] = {
    ...info,
    folder,
    enabled: true,
    archived: false,
    orphaned: false,
    orphanPath: '',
    updatedAt: new Date().toISOString(),
  }
  writeProjectState(cwd, cfg, state)
}

/** 项目档案改 label 时，把旧 label 的项目热记忆迁到新 label；旧 label 仍有活跃档案则不动。 */
function migrateProjectCoreLabel(cwd, cfg, oldLabel, newLabel) {
  const oldClean = String(oldLabel || '').trim()
  const newClean = String(newLabel || '').trim()
  if (!oldClean || !newClean || oldClean === newClean) return
  const core = coreDirFor(cwd, cfg)
  if (!core) return
  const docs = listDocs(cwd, cfg.name, { includeArchived: false, limit: 1000 })
  const oldStillActive = (docs.items || []).some((d) => d.projectLabel === oldClean && d.archived !== true && d.enabled !== false)
  if (oldStillActive) return
  const state = readProjectState(cwd, cfg)
  const oldFolder = state[oldClean]?.folder || projectFolderName(oldClean)
  const newFolder = state[newClean]?.folder || projectFolderName(newClean)
  const oldDir = path.join(core, 'projects', oldFolder)
  const newDir = path.join(core, 'projects', newFolder)
  if (!fs.existsSync(oldDir)) return
  fs.mkdirSync(path.join(core, 'projects'), { recursive: true })
  if (fs.existsSync(newDir)) {
    // 目标已有目录时只合并缺失文件，绝不覆盖已有条目。
    for (const board of CORE_BOARDS) {
      const from = path.join(oldDir, board)
      const to = path.join(newDir, board)
      if (!fs.existsSync(from)) continue
      fs.mkdirSync(to, { recursive: true })
      for (const name of fs.readdirSync(from)) {
        if (!name.endsWith('.md')) continue
        const target = path.join(to, name)
        if (!fs.existsSync(target)) fs.copyFileSync(path.join(from, name), target)
      }
    }
    for (const board of CORE_BOARDS) {
      const dir = path.join(oldDir, board)
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    }
  } else {
    fs.renameSync(oldDir, newDir)
  }
  // 改 frontmatter 的 projectLabel，保证注入/读取按新 label 找到。
  for (const board of CORE_BOARDS) {
    const dir = path.join(newDir, board)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const file = path.join(dir, name)
      const entry = parseCoreEntry(file, board)
      if (!entry) continue
      try {
        const meta = { ...entry, projectLabel: newClean }
        delete meta.content
        fs.writeFileSync(file, `---\n${JSON.stringify(meta)}\n---\n${entry.content}\n`, 'utf8')
      } catch { /* 单条损坏不阻塞迁移 */ }
    }
  }
  state[newClean] = {
    ...(state[newClean] || {}),
    folder: newFolder,
    enabled: true,
    archived: false,
    orphaned: false,
    orphanPath: '',
    updatedAt: new Date().toISOString(),
  }
  delete state[oldClean]
  writeProjectState(cwd, cfg, state)
}

function coreBoardDir(cwd, cfg, board) {
  const root = coreDirFor(cwd, cfg)
  return root ? path.join(root, board) : null
}

function coreStateFile(cwd, cfg, name) {
  const root = coreDirFor(cwd, cfg)
  return root ? path.join(root, name) : null
}

function readCoreState(cwd, cfg, name, fallback) {
  const file = coreStateFile(cwd, cfg, name)
  if (!file || !fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeCoreState(cwd, cfg, name, value) {
  const file = coreStateFile(cwd, cfg, name)
  if (!file) return false
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}

function readCorePending(cwd, cfg) {
  const v = readCoreState(cwd, cfg, '.inject-pending.json', { entries: [] })
  return Array.isArray(v?.entries) ? v.entries.filter((x) => x && typeof x.id === 'string' && CORE_BOARDS.includes(x.board)).slice(0, 20) : []
}

function writeCorePending(cwd, cfg, entries) {
  return writeCoreState(cwd, cfg, '.inject-pending.json', { entries: entries.slice(0, 20), updatedAt: new Date().toISOString() })
}

function markCorePending(cwd, cfg, id, board) {
  if (cfg.coreInjection === 'off') return { ok: false, error: 'coreInjection 处于 off；先开启注入。' }
  if (cfg.coreReadOnly) return { ok: false, error: '子会话只能读母归属热记忆。' }
  const safeBoard = CORE_BOARDS.includes(board) ? board : ''
  const safeId = String(id || '')
  if (!safeBoard || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(safeId)) return { ok: false, error: '无效 id/board' }
  let entry = readCoreBoard(cwd, cfg, safeBoard).entries.find((e) => e.id === safeId)
  if (!entry) {
    entry = readProjectEntries(cwd, cfg).entries.find((e) => e.id === safeId && e.board === safeBoard)
  }
  if (!entry) return { ok: false, error: '找不到该条目' }
  const pending = readCorePending(cwd, cfg).filter((p) => !(p.id === safeId && p.board === safeBoard))
  pending.push({ id: safeId, board: safeBoard })
  if (!writeCorePending(cwd, cfg, pending)) return { ok: false, error: '写入 pending 失败' }
  return { ok: true, pending }
}

function coreAllTokens(cwd, cfg) {
  let total = 0
  for (const board of CORE_BOARDS) {
    const r = readCoreEntries(cwd, cfg, board)
    if (r && r.ok) total += Number(r.tokens) || 0
  }
  return total
}

function coreInjectState(cwd, cfg, sid) {
  const current = Boolean(sid && lastInjectedTurn.has(sid))
  return {
    ok: true,
    pending: readCorePending(cwd, cfg),
    last: current ? readCoreState(cwd, cfg, '.inject-last.json', null) : null,
    lastManual: current ? readCoreState(cwd, cfg, '.inject-last-manual.json', null) : null,
    retrieval: retrievalState(sid),
    archive: archiveState(sid),
    writes: writeStatsState(sid),
    injection: cfg.coreInjection,
    budget: cfg.coreInjectionBudget,
  }
}

function parseCoreEntry(file, board) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    if (!raw.startsWith('---\n')) return null
    const end = raw.indexOf('\n---', 4)
    if (end < 0) return null
    const meta = JSON.parse(raw.slice(4, end))
    if (!meta || typeof meta.id !== 'string') return null
    if (meta.board !== board) return null
    const content = raw.slice(end + 4).replace(/^\n/, '').replace(/\s+$/, '')
    return {
      schemaVersion: Number.isInteger(meta.schemaVersion) ? meta.schemaVersion : 1,
      id: meta.id,
      board,
      scope: typeof meta.scope === 'string' ? meta.scope : 'own',
      familyId: typeof meta.familyId === 'string' ? meta.familyId : '',
      projectLabel: typeof meta.projectLabel === 'string' ? meta.projectLabel : '',
      tier: CORE_TIERS.includes(meta.tier) ? meta.tier : (CORE_DEFAULT_TIER[board] || 'normal'),
      created: String(meta.created ?? ''),
      updated: String(meta.updated ?? ''),
      tags: Array.isArray(meta.tags)
        ? meta.tags.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 16)).filter(Boolean).slice(0, 8)
        : [],
      source: meta.source === 'user' ? 'user' : 'model',
      rev: Number.isInteger(meta.rev) ? meta.rev : 1,
      content,
      file,
    }
  } catch {
    return null
  }
}

function readCoreBoard(cwd, cfg, board) {
  const dir = coreBoardDir(cwd, cfg, board)
  if (!dir || !fs.existsSync(dir)) return { entries: [], errors: [] }
  const entries = []
  const errors = []
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return { entries, errors: ['<readdir failed>'] }
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const entry = parseCoreEntry(path.join(dir, name), board)
    if (entry) entries.push(entry)
    else errors.push(name)
  }
  // 列表按创建顺序稳定排序；编辑条目不会因为 updated 变化而跳位。
  entries.sort((a, b) => String(b.created).localeCompare(String(a.created)) || String(b.updated).localeCompare(String(a.updated)))
  return { entries, errors }
}

function readProjectEntries(cwd, cfg, labelFilter = '') {
  const out = []
  const errors = []
  const wanted = String(labelFilter || '').trim()
  for (const p of listProjectCoreDirs(cwd, cfg)) {
    for (const board of CORE_BOARDS) {
      const dir = path.join(p.dir, board)
      if (!fs.existsSync(dir)) continue
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md')) continue
        const file = path.join(dir, name)
        const entry = parseCoreEntry(file, board)
        if (!entry) { errors.push(`${board}/${name}`); continue }
        if (wanted && entry.projectLabel !== wanted) continue
        out.push(entry)
      }
    }
  }
  out.sort((a, b) => String(b.created).localeCompare(String(a.created)) || String(b.updated).localeCompare(String(a.updated)))
  return { entries: out, errors }
}

function readCoreEntries(cwd, cfg, section, opts = {}) {
  if (!cfg?.name) return { ok: false, error: '本会话还没有记忆名；先给会话命名再使用 memory-core。' }
  if (!cfg.enabled || !cfg.sessionEnabled) return { ok: false, error: '记忆回廊未启用（全局或本会话开关关闭）。' }
  const boards = section === 'all' ? CORE_BOARDS : [section]
  if (boards.some((b) => !CORE_BOARDS.includes(b))) return { ok: false, error: `未知板块：${section}` }
  const maxEntries = Math.min(Math.max(Number(opts.maxEntries) || 200, 1), 200)
  const maxTokens = Math.min(Math.max(Number(opts.maxTokens) || CORE_READ_MAX_TOKENS, 500), CORE_READ_MAX_TOKENS)
  const all = []
  const errors = []
  for (const board of boards) {
    const r = readCoreBoard(cwd, cfg, board)
    for (const e of r.entries) all.push(e)
    for (const f of r.errors) errors.push(`${board}/${f}`)
  }
  const project = readProjectEntries(cwd, cfg)
  for (const e of project.entries) {
    if (!boards.includes(e.board)) continue
    all.push({ ...e, budgetExcluded: !isProjectEnabled(cwd, cfg, e.projectLabel) })
  }
  for (const f of project.errors) errors.push(`projects/${f}`)
  const out = []
  let used = 0
  let truncated = false
  for (const e of all) {
    if (out.length >= maxEntries) { truncated = true; break }
    if (e.budgetExcluded) {
      out.push(e)
      continue
    }
    const cost = estimateTokens(e.content) + 40
    if (used + cost > maxTokens) {
      truncated = true
      if (out.length === 0) {
        const cut = truncateCoreText(e.content, Math.max(0, maxTokens - 40))
        if (cut) {
          out.push({ ...e, content: cut, readTruncated: true })
          used += estimateTokens(cut) + 40
        }
      }
      continue
    }
    out.push(e)
    used += cost
  }
  return { ok: true, entries: out, errors, truncated, total: all.length, tokens: used }
}

function formatCoreEntry(e) {
  const tags = e.tags.length ? ` · tags=${e.tags.join(',')}` : ''
  return `--- ${e.board}/${e.id} · ${e.tier} · rev ${e.rev}${tags}\n${e.content.trim()}\n`
}

function coreReadText(cwd, cfg, section, opts = {}) {
  const r = readCoreEntries(cwd, cfg, section, opts)
  if (!r.ok) return `【记忆核心】${r.error}`
  const visible = r.entries.filter((e) => !e.budgetExcluded)
  if (visible.length === 0) {
    if (r.total > 0) return `【记忆核心 · ${section}】有 ${r.total} 条，但当前读取预算（${CORE_READ_MAX_TOKENS} tokens）不足，或项目已停用；可提高 limit、分段读取或先启用项目。`
    return `【记忆核心 · ${section}】为空。`
  }
  const body = visible.map(formatCoreEntry).join('\n')
  const note = (r.truncated
    ? `\n（已截断：当前显示 ${visible.length}/${r.total} 条，约 ${r.tokens} tokens；可用更大 limit 分段读）`
    : '') + (r.errors?.length ? `\n（有 ${r.errors.length} 个文件解析失败已跳过：${r.errors.slice(0, 5).join('、')}${r.errors.length > 5 ? '…' : ''}）` : '')
  return `【记忆核心 · ${section}】${visible.length} 条，约 ${r.tokens} tokens${note}\n\n${body}`
}

function coreTierOf(section, tier) {
  if (section === 'rules' && (!CORE_TIERS.includes(tier) || tier === 'normal' || tier === 'minor')) return 'mind-seal'
  if (CORE_TIERS.includes(tier)) return tier
  return CORE_DEFAULT_TIER[section] || 'normal'
}

function normalizeCoreTags(tags) {
  if (!Array.isArray(tags)) return { ok: true, tags: [] }
  const out = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const t = raw.replace(/^#+/, '').trim()
    if (!t) continue
    if (t.length > 16) return { ok: false, error: `tag「${t.slice(0, 24)}…」太长：每个 tag 最多 16 字。` }
    if (!out.includes(t)) out.push(t)
    if (out.length > 8) return { ok: false, error: 'tag 最多 8 个。' }
  }
  return { ok: true, tags: out }
}

function coreNow() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function isArchivedReadOnly(cwd, cfg) {
  const folder = String(cfg?.folder || '')
  if (!folder) return false
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(cwd, 'memory-palace', folder, 'meta.json'), 'utf8'))
    return meta?.archivedReadOnly === true
  } catch { return false }
}

function writeCoreEntry(cwd, cfg, input) {
  if (isArchivedReadOnly(cwd, cfg)) return { ok: false, error: '旧根已归档只读，不能写入热记忆。' }
  const requestedLabel = input.projectLabel === undefined && input.id
    ? findProjectLabelById(cwd, cfg, input.id)
    : (input.projectLabel ?? '')
  const labelResult = normalizeCoreProjectLabel(requestedLabel)
  if (!labelResult.ok) return { ok: false, error: labelResult.error }
  const root = labelResult.label ? projectRoot(cwd, cfg, labelResult.label) : coreDirFor(cwd, cfg)
  if (!root) return { ok: false, error: '本会话还没有记忆名；先给会话命名。' }
  if (!cfg.enabled || !cfg.sessionEnabled) return { ok: false, error: '记忆回廊未启用（全局或本会话开关关闭）。' }
  if (cfg.coreReadOnly) return { ok: false, error: '子会话只能读母归属热记忆，不能写入；请到母归属会话维护。' }
  const section = String(input.section ?? input.board ?? '')
  if (!CORE_BOARDS.includes(section)) return { ok: false, error: `未知板块：${section}` }
  const content = String(input.content ?? '').replace(/\s+$/, '')
  if (!content.trim()) return { ok: false, error: '内容不能为空。' }
  if (content.length > 100000) return { ok: false, error: '单条内容超过 100000 字符，请拆分。' }
  let id = String(input.id || '').trim()
  if (id && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(id)) return { ok: false, error: 'id 只能英文/数字/点/下划线/连字符，最长 81。' }
  if (!id) id = `${section}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const dir = path.join(root, section)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.md`)
  // 跨板块查重：同一 id 只允许存在于一个板块，避免删除时串板块。
  for (const board of CORE_BOARDS) {
    if (board === section) continue
    if (board === input.allowMoveFrom && input.source === 'user') continue
    if (fs.existsSync(path.join(root, board, `${id}.md`))) {
      return { ok: false, error: `id 已存在于 ${board} 板块，请换一个 id。` }
    }
  }
  const existing = fs.existsSync(file) ? parseCoreEntry(file, section) : null
  if (fs.existsSync(file) && !existing) return { ok: false, error: '同名文件存在但无法解析；请先修复或另取 id，避免覆盖。' }
  if (existing && input.rev !== undefined && input.rev !== null && Number(input.rev) !== existing.rev) {
    return { ok: false, code: 'conflict', error: `条目已被修改（当前 rev ${existing.rev}），请刷新后重试。`, rev: existing.rev }
  }
  // 内容查重：同板块已有完全相同的正文时拒绝，避免热记忆流水账和重复条目。
  const normalizedContent = content.replace(/\s+/g, ' ').trim()
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md') || name === `${id}.md`) continue
      const other = parseCoreEntry(path.join(dir, name), section)
      if (!other) continue
      if (String(other.content || '').replace(/\s+/g, ' ').trim() === normalizedContent) {
        return { ok: false, code: 'duplicate', duplicateId: other.id, error: `内容与已有条目 ${other.id} 重复；请更新已有条目，不要新建。` }
      }
    }
  } catch { /* 查重失败不阻塞写入 */ }
  if (section === 'rules' && input.source !== 'user') {
    const requested = input.tier !== undefined ? coreTierOf('rules', input.tier) : (existing?.tier || 'mind-seal')
    if (requested !== 'important') {
      return { ok: false, error: 'rules 铁律级需要用户在页签确认；模型只能直写/修改重要级 rules。' }
    }
    if (existing && existing.tier !== 'important') {
      return { ok: false, error: '已有铁律级不能由模型修改；请由用户确认或提候选。' }
    }
    input.tier = 'important'
  }
  let tags = existing?.tags || []
  if (Array.isArray(input.tags)) {
    const normalized = normalizeCoreTags(input.tags)
    if (!normalized.ok) return normalized
    tags = normalized.tags
  }
  const now = coreNow()
  const meta = {
    schemaVersion: CORE_SCHEMA_VERSION,
    id,
    board: section,
    scope: input.scope || existing?.scope || 'own',
    familyId: cfg.familyId || existing?.familyId || '',
    projectLabel: labelResult.label || existing?.projectLabel || '',
    tier: input.tier !== undefined ? coreTierOf(section, input.tier) : (existing?.tier || coreTierOf(section)),
    created: existing?.created || now,
    updated: now,
    tags,
    source: input.source === 'user' ? 'user' : (existing?.source || 'model'),
    rev: (existing?.rev || 0) + 1,
  }
  if (existing) {
    const backupDir = path.join(root, '.backup')
    fs.mkdirSync(backupDir, { recursive: true })
    fs.copyFileSync(file, path.join(backupDir, `${id}.bak-${Date.now()}-${randomUUID().slice(0, 6)}`))
  }
  const body = `---\n${JSON.stringify(meta)}\n---\n${content}\n`
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, body, 'utf8')
  fs.renameSync(tmp, file)
  return { ok: true, meta, file: path.relative(cwd, file) }
}

function removeCoreEntry(cwd, cfg, id, opts = {}) {
  if (isArchivedReadOnly(cwd, cfg)) return { ok: false, error: '旧根已归档只读，不能删除热记忆。' }
  const root = coreDirFor(cwd, cfg)
  if (!root) return { ok: false, error: '本会话还没有记忆名。' }
  if (!cfg.enabled || !cfg.sessionEnabled) return { ok: false, error: '记忆回廊未启用。' }
  if (cfg.coreReadOnly) return { ok: false, error: '子会话只能读母归属热记忆，不能删除；请到母归属会话维护。' }
  const safeId = String(id || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(safeId)) return { ok: false, error: '无效 id。' }
  const wanted = opts.board && CORE_BOARDS.includes(opts.board) ? [opts.board] : CORE_BOARDS
  const hits = []
  for (const board of wanted) {
    const file = path.join(root, board, `${safeId}.md`)
    if (fs.existsSync(file)) hits.push({ board, file })
  }
  if (hits.length === 0) {
    for (const p of listProjectCoreDirs(cwd, cfg)) {
      for (const board of wanted) {
        const file = path.join(p.dir, board, `${safeId}.md`)
        if (fs.existsSync(file)) hits.push({ board, file, project: true })
      }
    }
  }
  if (hits.length > 1) return { ok: false, error: '同一 id 在多个板块存在；请指定 board 后再删除。' }
  if (hits.length === 0) return { ok: false, error: '找不到要删除的条目。' }
  const { board, file } = hits[0]
  if (board === 'rules' && !opts.allowRules) return { ok: false, error: 'rules 的删除需要用户在页签里确认；模型不能直接删。' }
  const trash = path.join(root, '.trash')
  fs.mkdirSync(trash, { recursive: true })
  fs.renameSync(file, path.join(trash, `${safeId}.deleted-${Date.now()}.md`))
  const trashPruned = pruneTrash(trash)
  return { ok: true, board, id: safeId, trashPruned }
}

function moveCoreEntry(cwd, cfg, id, fromBoard, toBoard, opts = {}) {
  const root = coreDirFor(cwd, cfg)
  if (!root) return { ok: false, error: '本会话还没有记忆名。' }
  if (!cfg.enabled || !cfg.sessionEnabled) return { ok: false, error: '记忆回廊未启用。' }
  if (cfg.coreReadOnly) return { ok: false, error: '子会话只能读母归属热记忆，不能转移。' }
  const safeId = String(id || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(safeId)) return { ok: false, error: '无效 id。' }
  if (!CORE_BOARDS.includes(fromBoard) || !CORE_BOARDS.includes(toBoard)) return { ok: false, error: '未知板块。' }
  if (fromBoard === toBoard) return { ok: false, error: '源板块和目标板块相同。' }
  if (fromBoard === 'rules' && !opts.allowRules) return { ok: false, error: 'rules 的转移需要用户在页签里确认。' }
  const source = path.join(root, fromBoard, `${safeId}.md`)
  if (!fs.existsSync(source)) return { ok: false, error: '找不到源条目。' }
  const target = path.join(root, toBoard, `${safeId}.md`)
  if (fs.existsSync(target)) return { ok: false, error: '目标板块里已有同 id 条目，未覆盖。' }
  const entry = parseCoreEntry(source, fromBoard)
  if (!entry) return { ok: false, error: '源条目解析失败。' }
  const tier = fromBoard === 'rules' ? (CORE_DEFAULT_TIER[toBoard] || 'normal') : entry.tier
  const newId = `${toBoard}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const written = writeCoreEntry(cwd, cfg, {
    id: newId,
    section: toBoard,
    content: entry.content,
    tier,
    tags: entry.tags,
    source: 'user',
    allowMoveFrom: fromBoard,
  })
  if (!written.ok) return written
  const removed = removeCoreEntry(cwd, cfg, safeId, { board: fromBoard, allowRules: true })
  if (!removed.ok) return { ok: false, error: `目标已写入，但源条目清理失败：${removed.error}` }
  // 转移后旧 ID 不再存在；清掉旧的手动注入 pending，避免死引用。
  try {
    const pending = readCorePending(cwd, cfg).filter((p) => !(p.id === safeId && p.board === fromBoard))
    writeCorePending(cwd, cfg, pending)
  } catch { /* pending 清理失败不影响转移 */ }
  return { ok: true, id: newId, oldId: safeId, from: fromBoard, to: toBoard, meta: written.meta }
}

function truncateCoreText(text, maxTokens) {
  if (maxTokens <= 0) return ''
  const s = String(text ?? '')
  if (estimateTokens(s) <= maxTokens) return s
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (estimateTokens(s.slice(0, mid)) <= maxTokens) lo = mid
    else hi = mid - 1
  }
  return lo <= 0 ? '' : s.slice(0, lo).trimEnd() + '…'
}

const CORE_TIER_RULES = {
  'mind-seal': { turns: 1, tokens: 0 },
  important: { turns: 5, tokens: 10000 },
  normal: { turns: 12, tokens: 30000 },
  minor: { turns: 0, tokens: 0 },
}

function coreTierRules(cfg) {
  return {
    ...CORE_TIER_RULES,
    important: { turns: Number(cfg.coreTierImportantTurns) || 5, tokens: Number(cfg.coreTierImportantTokens) || 10000 },
    normal: { turns: Number(cfg.coreTierNormalTurns) || 12, tokens: Number(cfg.coreTierNormalTokens) || 30000 },
  }
}

function coreTierState(state) {
  const base = state && typeof state === 'object' ? state : {}
  const cur = base.coreTier && typeof base.coreTier === 'object' ? base.coreTier : {}
  return {
    turnsSince: { ...(cur.turnsSince || {}) },
    outputTokensSince: { ...(cur.outputTokensSince || {}) },
    minorPending: cur.minorPending === true,
  }
}

function bumpCoreTier(cwd, cfg, sid, { outputTokens = 0, turns = 1 } = {}) {
  const state = readState(cwd, cfg.rootDirName, sid)
  const tier = coreTierState(state)
  for (const name of ['mind-seal', 'important', 'normal', 'minor']) {
    tier.turnsSince[name] = (Number(tier.turnsSince[name]) || 0) + (Number(turns) || 0)
    tier.outputTokensSince[name] = (Number(tier.outputTokensSince[name]) || 0) + (Number(outputTokens) || 0)
  }
  state.coreTier = tier
  writeState(cwd, cfg.rootDirName, state, sid)
}

function activeCoreTiers(cwd, cfg, sid) {
  const tier = coreTierState(readState(cwd, cfg.rootDirName, sid))
  const active = new Set(['mind-seal'])
  const rules = coreTierRules(cfg)
  for (const name of ['important', 'normal']) {
    const rule = rules[name]
    if ((Number(tier.turnsSince[name]) || 0) >= rule.turns || (Number(tier.outputTokensSince[name]) || 0) >= rule.tokens) active.add(name)
  }
  if (tier.minorPending) active.add('minor')
  return { active, tier }
}

function resetCoreTiers(cwd, cfg, sid, active) {
  const state = readState(cwd, cfg.rootDirName, sid)
  const tier = coreTierState(state)
  for (const name of active) {
    if (name === 'mind-seal') continue
    tier.turnsSince[name] = 0
    tier.outputTokensSince[name] = 0
  }
  if (active.has('minor')) tier.minorPending = false
  state.coreTier = tier
  writeState(cwd, cfg.rootDirName, state, sid)
}

function coreCandidateList(cwd, cfg, sid) {
  const state = readState(cwd, cfg.rootDirName, sid)
  return Array.isArray(state?.coreCandidates) ? state.coreCandidates.slice(-20) : []
}

function coreCandidateAdd(cwd, cfg, sid, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return
  const state = readState(cwd, cfg.rootDirName, sid)
  const current = Array.isArray(state.coreCandidates) ? state.coreCandidates : []
  const seen = new Set(current.map((c) => String(c.text || '').toLowerCase().replace(/\s+/g, '')))
  for (const c of candidates) {
    const key = String(c.text || '').toLowerCase().replace(/\s+/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    current.push({
      id: `cand-${randomUUID()}`,
      text: String(c.text || '').slice(0, 800),
      proposedText: String(c.proposedText || c.text || '').slice(0, 800),
      section: CORE_BOARDS.includes(c.section) ? c.section : 'memories',
      tier: c.section === 'rules'
        ? (c.tier === 'important' ? 'important' : 'mind-seal')
        : (CORE_TIERS.includes(c.tier) ? c.tier : 'normal'),
      kind: String(c.kind || 'explicit'),
      confidence: Number(c.confidence) || 0.6,
      reason: String(c.reason || ''),
      at: new Date().toISOString(),
    })
  }
  state.coreCandidates = current.slice(-20)
  writeState(cwd, cfg.rootDirName, state, sid)
}

function autoCaptureHighConfidence(cwd, cfg, sid, text) {
  try {
    if (!cfg?.enabled || !cfg?.sessionEnabled || !cfg?.name) return
    if (cfg.coreReadOnly) return
    const raw = String(text || '').trim()
    if (raw.length < 6) return
    if (/(token|api[_-]?key|secret|password|密码|密钥|npm_[A-Za-z0-9])/i.test(raw)) return
    // 冒号前是解释/举例，命令在冒号后：大概率是引述，不自动捕获。
    const colonParts = raw.split(/[:：]/)
    if (colonParts.length > 1) {
      const explicit = /(记住|请记住|要记得|记下|别忘|从现在起|从今往后|以后都|今后)/
      const commandInPrefix = explicit.test(colonParts[0])
      const quoteMarker = /(比如|例如|像|这种|有些|可能|引述|引用|举例|角色自设|归类|规则)/.test(colonParts[0])
      if (!commandInPrefix && quoteMarker) return { wrote: 0, queued: 0, classify: [] }
    }
    const existing = []
    for (const board of CORE_BOARDS) {
      for (const e of readCoreBoard(cwd, cfg, board).entries) existing.push(String(e.content || ''))
    }
    const { candidates } = extractCandidates(raw, { existing, max: 2 })
    const classify = []
    for (const c of candidates) {
      const proposed = String(c.proposedText || c.text || '').trim()
      if (!proposed) continue
      // 严格命令只负责识别，不替模型选板块；规则也由模型判断后走候选。
      const explicitCommand = /(记住|请记住|要记得|记下|别忘|从现在起|从今往后|以后都|今后)/.test(String(c.text || ''))
      const isQuestion = /[?？]\s*$/.test(String(c.text || ''))
      if (explicitCommand && !isQuestion && Number(c.confidence) >= 0.78) classify.push(proposed)
    }
    if (classify.length > 0) {
      recordEvent('auto-capture', `${String(sid).slice(0, 8)}… classify=${classify.length}`)
    }
    return { wrote: 0, queued: 0, classify }
  } catch { /* 自动捕获失败不影响对话 */ }
}

function sendMemoryClassifySteer(agent, sid, items) {
  if (!agent || !sid || !items?.length) return
  try {
    const list = items.map((x) => `- ${x}`).join('\n')
    const text = `【系统指令 · 记忆归档】用户明确要求记住以下内容：\n${list}\n请按语义判断板块并直接写入：角色自设→identity，用户偏好/习惯→profile，事件/决策→memories，项目事实→项目档案；规则只进候选。不要询问用户，不要复述。`
    const message = assertUserMessage({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'dsh-memory-palace' },
    })
    agent.steer(message)
    recordEvent('memory-classify-steer', `${String(sid).slice(0, 8)}… items=${items.length}`)
  } catch { /* steer 失败不阻塞对话 */ }
}

function coreCandidateRemove(cwd, cfg, sid, id) {
  const state = readState(cwd, cfg.rootDirName, sid)
  const list = Array.isArray(state.coreCandidates) ? state.coreCandidates : []
  const next = list.filter((c) => c.id !== id)
  state.coreCandidates = next
  writeState(cwd, cfg.rootDirName, state, sid)
  return { ok: true, removed: list.length - next.length }
}

function coreCandidateAccept(cwd, cfg, sid, id) {
  const state = readState(cwd, cfg.rootDirName, sid)
  const list = Array.isArray(state.coreCandidates) ? state.coreCandidates : []
  const item = list.find((c) => c.id === id)
  if (!item) return { ok: false, error: '候选不存在' }
  const r = writeCoreEntry(cwd, cfg, {
    section: CORE_BOARDS.includes(item.section) ? item.section : 'memories',
    content: item.proposedText || item.text,
    tier: CORE_TIERS.includes(item.tier) ? item.tier : 'normal',
    tags: ['待确认'],
    source: 'user',
  })
  if (!r.ok) return r
  recordPalaceWrite(sid, {
    id: r.meta.id,
    section: r.meta.board,
    content: item.proposedText || item.text,
    action: 'create',
  })
  coreCandidateRemove(cwd, cfg, sid, id)
  return { ok: true, entry: r.meta }
}

function copyRootCoreForTransfer(cwd, cfg, fromFolder, toFolder) {
  if (!fromFolder || !toFolder || fromFolder === toFolder) return { copied: 0, conflicts: [] }
  const from = path.join(cwd, cfg.rootDirName, fromFolder, '_core')
  const to = path.join(cwd, cfg.rootDirName, toFolder, '_core')
  if (!fs.existsSync(from)) return { copied: 0, conflicts: [] }
  let copied = 0
  const conflicts = []
  for (const board of CORE_BOARDS) {
    const src = path.join(from, board)
    if (!fs.existsSync(src)) continue
    const dst = path.join(to, board)
    fs.mkdirSync(dst, { recursive: true })
    for (const name of fs.readdirSync(src)) {
      if (!name.endsWith('.md')) continue
      const target = path.join(dst, name)
      if (fs.existsSync(target)) { conflicts.push(`${board}/${name}`); continue }
      fs.copyFileSync(path.join(src, name), target)
      copied += 1
    }
  }
  return { copied, conflicts }
}

function projectDocsInjectionText(cwd, cfg) {
  try {
    if (!cfg.enabled || !cfg.sessionEnabled || !cfg.name) return ''
    const docs = (listDocs(cwd, cfg.name, { includeArchived: false, limit: 1000 }).items || [])
      .filter((d) => d.enabled !== false && d.archived !== true)
    if (!docs.length) return ''
    const lines = docs.slice(0, 6).map((d) => {
      const title = String(d.title || d.id).slice(0, 60)
      return `- ${title}${d.projectLabel ? `（${d.projectLabel}）` : ''}`
    })
    const more = docs.length > 6 ? `\n- 另有 ${docs.length - 6} 篇，用 memory_doc_search 查` : ''
    return `【项目档案 · 已启用】\n${lines.join('\n')}${more}\n需要时用 memory_doc_search / memory_doc_read；停用档案不会出现在这里。`
  } catch {
    return ''
  }
}

function coreInjectionText(cwd, cfg, opts = {}) {
  try {
    if (cfg.coreInjection === 'off') return ''
    if (!cfg.enabled || !cfg.sessionEnabled || !cfg.name) return ''
    const root = coreDirFor(cwd, cfg)
    if (!root || !fs.existsSync(root)) return ''
    const tierInfo = opts.sid ? activeCoreTiers(cwd, cfg, opts.sid) : { active: new Set(CORE_TIERS) }
    const activeTiers = tierInfo.active
    const injectedTiers = new Set()
    const budget = Math.min(Math.max(Number(cfg.coreInjectionBudget) || 10000, 1000), 20000)
    const boardCounts = {}
    for (const b of ['identity', 'profile', 'memories']) {
      boardCounts[b] = readCoreBoard(cwd, cfg, b).entries.filter((e) => activeTiers.has(e.tier)).length
      boardCounts[b] += readProjectEntries(cwd, cfg).entries.filter((e) => e.board === b && activeTiers.has(e.tier) && isProjectEnabled(cwd, cfg, e.projectLabel)).length
    }
    // 给“被省略”的提示预留一点空间，避免低优先级板块无声消失。
    const noticeReserve = (boardCounts.identity > 0 || boardCounts.profile > 0 || boardCounts.memories > 0) ? 120 : 0
    let remaining = Math.max(0, budget - noticeReserve)
    const blocks = []
    const included = []
    const pending = readCorePending(cwd, cfg)
    const pendingLines = []
    if (pending.length && remaining > 0) {
      for (const p of pending.slice(0, 5)) {
        const board = readCoreBoard(cwd, cfg, p.board)
        let e = board.entries.find((x) => x.id === p.id)
        if (!e) e = readProjectEntries(cwd, cfg).entries.find((x) => x.id === p.id && x.board === p.board)
        if (!e) continue
        if (!isProjectEnabled(cwd, cfg, e.projectLabel)) continue
        let text = String(e.content).trim()
        let cost = estimateTokens(text) + 24
        if (cost > remaining) {
          text = truncateCoreText(text, Math.max(0, remaining - 24))
          if (!text) break
          cost = estimateTokens(text) + 24
        }
        pendingLines.push(`[${e.board}/${e.id} · ${e.tier}] ${text}`)
        included.push(`${e.board}/${e.id}`)
        remaining -= cost
      }
      if (pendingLines.length) blocks.push(`【手动注入】\n${pendingLines.join('\n')}`)
    }
    const take = (board, cap, summarize, projectOnly = false) => {
      if (remaining <= 0) return
      const r = readCoreBoard(cwd, cfg, board)
      const projectEntries = readProjectEntries(cwd, cfg).entries.filter((e) => e.board === board && isProjectEnabled(cwd, cfg, e.projectLabel))
      const entries = [...r.entries, ...projectEntries]
      if (!entries.length) return
      const allowedTiers = board === 'rules' ? new Set([...activeTiers, 'important']) : activeTiers
      const lines = []
      let used = 0
      for (const e of entries) {
        if (projectOnly && !e.projectLabel) continue
        if (!allowedTiers.has(e.tier)) continue
        if (!isProjectEnabled(cwd, cfg, e.projectLabel)) continue
        const raw = summarize ? String(e.content).replace(/\s+/g, ' ').trim() : String(e.content).trim()
        let text = summarize ? raw.slice(0, 400) : raw
        if (summarize && raw.length > 400) text += '…'
        let cost = estimateTokens(text) + 24
        const avail = Math.min(cap - used, remaining)
        if (cost > avail) {
          text = truncateCoreText(text, Math.max(0, avail - 24))
          if (!text) break
          cost = estimateTokens(text) + 24
        }
        if (cost > remaining) break
        lines.push(`[${e.board}/${e.id} · ${e.tier}] ${text}`)
        included.push(`${e.board}/${e.id}`)
        injectedTiers.add(e.tier)
        used += cost
      }
      if (lines.length) {
        blocks.push(`【${board}】\n${lines.join('\n')}`)
        remaining -= used
      }
    }
    take('rules', Math.min(2000, budget), false)
    take('identity', Math.min(2500, Math.max(remaining, 0)), true)
    take('profile', Math.min(2500, Math.max(remaining, 0)), true)
    take('memories', Math.min(2500, Math.max(remaining, 0)), false)
    const notices = []
    for (const board of ['identity', 'profile', 'memories']) {
      if (boardCounts[board] > 0 && !blocks.some((b) => b.startsWith(`【${board}】`))) {
        notices.push(`【${board}】已省略：预算不足（共 ${boardCounts[board]} 条；可调大 coreInjectionBudget，或用 memory_core_read 读取）`)
      }
    }
    let familyNotice = ''
    if (opts.sid) {
      try {
        const fam = familyStatus(cwd, opts.sid)
        if (fam?.membership?.family?.rebuildPending) {
          familyNotice = '【记忆回廊 · 家族重建】旧根热记忆缺失。请先用 ask_user_question 询问用户是否重建；用户同意后调用 memory_family_decide(decision:"yes")，不要自行编造热记忆。'
        }
      } catch { /* ignore */ }
    }
    if (!blocks.length && !notices.length && !familyNotice) return ''
    const tag = cfg.coreInjection === 'test' ? ' [测试]' : ''
    const text = `【记忆核心 · 记忆回廊】${tag}以下是你自己的本地热记忆（只读投影，维护用 memory_core_* 工具）；这些是已生效的约束和记忆，按内容执行，当前用户明确指令优先：\n\n${[familyNotice, ...notices, ...blocks].filter(Boolean).join('\n\n')}`
    const finalText = estimateTokens(text) <= budget ? text : truncateCoreText(text, budget)
    if (opts.consume) {
      const record = {
        tokens: estimateTokens(finalText),
        entries: included,
        at: new Date().toISOString(),
      }
      writeCoreState(cwd, cfg, '.inject-last.json', record)
      if (pending.length) writeCoreState(cwd, cfg, '.inject-last-manual.json', record)
      if (pending.length) writeCorePending(cwd, cfg, [])
      if (opts.sid && injectedTiers.size) resetCoreTiers(cwd, cfg, opts.sid, injectedTiers)
    }
    return finalText
  } catch (err) {
    recordEvent('core-injection-error', String(err?.message ?? err))
    return ''
  }
}

function coreDebugInfo(cwd, cfg) {
  const root = coreDirFor(cwd, cfg)
  const counts = {}
  const errors = []
  for (const board of CORE_BOARDS) {
    const r = readCoreBoard(cwd, cfg, board)
    counts[board] = r.entries.length
    for (const f of r.errors) errors.push(`${board}/${f}`)
  }
  const text = coreInjectionText(cwd, cfg)
  return {
    coreInjection: cfg.coreInjection,
    coreInjectionBudget: cfg.coreInjectionBudget,
    named: Boolean(cfg.name),
    coreDir: root ? path.relative(cwd, root) : null,
    counts,
    errors,
    wouldInjectTokens: estimateTokens(text),
    wouldInjectPreview: text.slice(0, 4000),
  }
}

function registerCoreTools(ctx, read) {
  const defs = []
  defs.push(ctx.tools.register({
    name: 'memory_core_read',
    description: '读取当前会话的本地热记忆（identity/profile/rules/memories）。只读；section=all 可读全部。超出预算会截断。',
    parameters: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'identity / profile / rules / memories / all' },
        limit: { type: 'number', description: '最多条数，默认 200，上限 200' },
      },
      required: ['section'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const cwd = String(exec.agent?.session?.header?.cwd ?? '')
      const sid = sessionIdOf(exec.agent)
      const cfg = resolveConfig(read, cwd, sid)
      return coreReadText(cwd, cfg, String(args.section || 'all'), { maxEntries: args.limit })
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_core_write',
    description: '写入/更新当前会话的一条本地热记忆。section=identity/profile/rules/memories；写入前备份旧文件，返回 id 与 rev。tags 1–4 个、每个 ≤16 字（identity 身份/性格，profile 偏好/习惯，rules 安全/工作流，memories 美好/关系/项目）。identity/profile/memories 可直接写；rules 的 important 级可直接写/改，mind-seal 铁律级只能提候选并由用户确认。项目相关热记忆必须带 projectLabel，并按内容选 section（角色自设→identity、偏好→profile、硬约束→rules、事件/决策→memories），不要写进全局。',
    parameters: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'identity / profile / rules / memories' },
        content: { type: 'string', description: '条目正文（Markdown）' },
        id: { type: 'string', description: '可选：已有条目 id；省略则新建' },
        tier: { type: 'string', description: 'mind-seal / important / normal / minor' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签：1–4 个，每个 ≤16 字；如 身份/性格/偏好/雷区/项目/决策/踩坑' },
        projectLabel: { type: 'string', description: '项目热记忆的绑定 label，必须与项目档案 projectLabel 同名；可挂任意 section：角色自设→identity、偏好→profile、硬约束→rules、事件/决策→memories。项目相关热记忆必须填写。' },
        source: { type: 'string', description: 'model 或 user，默认 model' },
      },
      required: ['section', 'content'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const cwd = String(exec.agent?.session?.header?.cwd ?? '')
      const sid = sessionIdOf(exec.agent)
      const cfg = resolveConfig(read, cwd, sid)
      if (isSubagentSession(exec.agent)) return '子智能体不写主线热记忆；请把结果交回父会话。'
      const r = await withSessionWriteLock(sid, () => writeCoreEntry(cwd, cfg, { ...args, source: 'model' }))
      if (r.ok) {
        recordPalaceWrite(sid, {
          id: r.meta.id,
          section: r.meta.board,
          content: args.content,
          action: args.migration ? 'migration' : (r.meta.rev > 1 ? 'update' : 'create'),
        })
      }
      return r.ok ? JSON.stringify(r, null, 2) : `写入失败：${r.error}`
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_core_candidate',
    description: '提议一条 rules 候选，不直接写入；用户确认后才成为铁律。identity/profile/memories 请直接用 memory_core_write，不要走候选。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '清洗后的候选内容，一句话，不要原样复制口语' },
        section: { type: 'string', description: '固定 rules；候选只用于铁律，其他板块直接 memory_core_write' },
        tier: { type: 'string', description: 'mind-seal / important / normal / minor，默认 normal' },
        kind: { type: 'string', description: 'identity / preference / correction / fact' },
        reason: { type: 'string', description: '为什么值得记，一句话' },
      },
      required: ['content'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const cwd = String(exec.agent?.session?.header?.cwd ?? '')
      const sid = sessionIdOf(exec.agent)
      const cfg = resolveConfig(read, cwd, sid)
      if (isSubagentSession(exec.agent)) return '子智能体不提主线记忆候选；请把结果交回父会话。'
      if (!cwd || !cfg.name) return '本会话还没有记忆名；先给会话命名。'
      if (!cfg.enabled || !cfg.sessionEnabled) return '记忆回廊未启用。'
      const content = String(args.content || '').trim().slice(0, 800)
      if (!content) return '候选内容不能为空。'
      const section = String(args.section || 'rules')
      if (section !== 'rules') return '候选只用于 rules；identity/profile/memories 请直接用 memory_core_write。'
      if (!CORE_BOARDS.includes(section)) return `未知板块：${section}`
      const normalized = content.toLowerCase().replace(/\s+/g, '')
      for (const board of CORE_BOARDS) {
        for (const e of readCoreBoard(cwd, cfg, board).entries) {
          const old = String(e.content || '').toLowerCase().replace(/\s+/g, '')
          if (old.length >= 4 && (old.includes(normalized) || normalized.includes(old))) {
            return '已存在相似记忆，未重复排队。'
          }
        }
      }
      coreCandidateAdd(cwd, cfg, sid, [{
        text: content,
        proposedText: content,
        kind: String(args.kind || 'fact'),
        confidence: 0.8,
        reason: String(args.reason || '模型判断'),
        section,
        tier: CORE_TIERS.includes(args.tier) ? args.tier : 'normal',
      }])
      return JSON.stringify({ ok: true, queued: true, section, content }, null, 2)
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_core_remove',
    description: '软删除当前会话的一条本地热记忆（移到 .trash）。rules 板块的删除只能由用户在页签确认，模型调用会被拒绝。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '条目 id' },
        board: { type: 'string', description: '可选：identity/profile/rules/memories，用于同 id 消歧' },
      },
      required: ['id'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const cwd = String(exec.agent?.session?.header?.cwd ?? '')
      const sid = sessionIdOf(exec.agent)
      const cfg = resolveConfig(read, cwd, sid)
      if (isSubagentSession(exec.agent)) return '子智能体不能删除主线热记忆。'
      const r = await withSessionWriteLock(sid, () => removeCoreEntry(cwd, cfg, args.id, { board: args.board }))
      return r.ok ? JSON.stringify(r, null, 2) : `删除失败：${r.error}`
    },
  }))
  return defs
}

function familyJoinWithCore(cwd, cfg, sid, rootSessionId) {
  const own = cfg.folder ? path.join(cwd, 'memory-palace', cfg.folder, '_core') : ''
  let backup = ''
  try {
    if (own && fs.existsSync(own)) {
      const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
      backup = `${own}.bak-${ts}`
      fs.renameSync(own, backup)
    }
    const r = joinFamily(cwd, { rootSessionId, sessionId: sid, folder: cfg.folder, name: cfg.name })
    if (!r.ok && backup) {
      try { fs.renameSync(backup, own) } catch { /* 保留备份，不覆盖 */ }
    }
    return r
  } catch (err) {
    if (backup && own && fs.existsSync(backup) && !fs.existsSync(own)) {
      try { fs.renameSync(backup, own) } catch { /* ignore */ }
    }
    return { ok: false, error: String(err?.message ?? err) }
  }
}

function maybeElectFamily(agent, cfg, sid) {
  if (!sid || isSubagentSession(agent)) return
  const status = familyStatus(cwdOf(agent), sid)
  const membership = status?.membership
  if (!membership || membership.role !== 'child') return
  const family = membership.family
  const rootDir = family.rootFolder ? path.join(cwdOf(agent), 'memory-palace', family.rootFolder) : ''
  const rootConfig = rootDir ? path.join(rootDir, 'config.json') : ''
  const rootGone = !rootDir || !fs.existsSync(rootDir) || !rootConfig || !fs.existsSync(rootConfig)
  if (family.status === 'active' && !rootGone) return
  const r = electRoot(cwdOf(agent), {
    familyId: family.familyId,
    newRootSessionId: sid,
    newRootFolder: cfg.folder || cfg.name,
    newRootName: cfg.name,
  })
  if (!r.ok) {
    if (!r.busy) recordEvent('family-election-error', String(r.error || 'unknown'))
    return
  }
  if (!r.noop && r.oldRootFolder && r.oldRootFolder !== cfg.folder) {
    try {
      const oldCore = path.join(cwdOf(agent), 'memory-palace', r.oldRootFolder, '_core')
      const newCore = path.join(cwdOf(agent), 'memory-palace', cfg.folder, '_core')
      if (fs.existsSync(oldCore)) {
        fs.mkdirSync(newCore, { recursive: true })
        for (const board of CORE_BOARDS) {
          const from = path.join(oldCore, board)
          if (!fs.existsSync(from)) continue
          const to = path.join(newCore, board)
          fs.mkdirSync(to, { recursive: true })
          for (const name of fs.readdirSync(from)) {
            if (!name.endsWith('.md')) continue
            const target = path.join(to, name)
            if (!fs.existsSync(target)) fs.copyFileSync(path.join(from, name), target)
          }
        }
      }
    } catch (err) {
      recordEvent('family-election-copy-error', String(err?.message ?? err))
    }
  }
  const oldCorePath = r.oldRootFolder ? path.join(cwdOf(agent), 'memory-palace', r.oldRootFolder, '_core') : ''
  if (!oldCorePath || !fs.existsSync(oldCorePath)) {
    try { markFamilyRebuild(cwdOf(agent), r.family.familyId, 'old-root-core-missing') } catch { /* ignore */ }
    recordEvent('family-rebuild-pending', `${sid.slice(-8)} old core missing`)
  }
  recordEvent('family-election', `${sid.slice(-8)} new root`)
}

function cwdOf(agent) {
  return String(agent?.session?.header?.cwd ?? '')
}

function familyDetachWithCore(cwd, cfg, sid) {
  const r = detachFamily(cwd, sid)
  if (!r.ok || !cfg.folder) return r
  try {
    const parent = path.join(cwd, 'memory-palace', cfg.folder)
    if (!fs.existsSync(parent)) return r
    const own = path.join(parent, '_core')
    const backups = fs.readdirSync(parent)
      .filter((n) => n.startsWith('_core.bak-'))
      .sort()
    let preDetach = ''
    if (backups.length) {
      if (fs.existsSync(own)) {
        const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
        preDetach = `${own}.pre-detach-${ts}`
        fs.renameSync(own, preDetach)
      }
      fs.renameSync(path.join(parent, backups[backups.length - 1]), own)
    }
    fs.mkdirSync(own, { recursive: true })
    const rootFolder = r.family?.rootFolder || cfg.familyRootFolder || ''
    const mother = rootFolder ? path.join(cwd, 'memory-palace', rootFolder, '_core') : ''
    let copied = 0
    let identical = 0
    const conflicts = []
    if (mother && fs.existsSync(mother)) {
      for (const board of CORE_BOARDS) {
        const from = path.join(mother, board)
        if (!fs.existsSync(from)) continue
        const to = path.join(own, board)
        fs.mkdirSync(to, { recursive: true })
        for (const name of fs.readdirSync(from)) {
          if (!name.endsWith('.md')) continue
          const target = path.join(to, name)
          if (fs.existsSync(target)) {
            const a = fs.readFileSync(path.join(from, name), 'utf8').replace(/\s+/g, ' ').trim()
            const b = fs.readFileSync(target, 'utf8').replace(/\s+/g, ' ').trim()
            if (a === b) identical += 1
            else conflicts.push(`${board}/${name}`)
            continue
          }
          fs.copyFileSync(path.join(from, name), target)
          copied += 1
        }
      }
    }
    const parts = []
    if (preDetach) parts.push(`原 _core 已保留为 ${path.basename(preDetach)}`)
    if (conflicts.length) parts.push(`母热记忆有 ${conflicts.length} 条近似/冲突条目未覆盖；请模型判断是否合并：${conflicts.slice(0, 8).join('、')}${conflicts.length > 8 ? '…' : ''}`)
    else if (identical) parts.push(`母热记忆有 ${identical} 条完全相同，已跳过。`)
    return { ...r, copied, identical, conflicts, skipped: identical + conflicts.length, preDetach, warning: parts.length ? parts.join('；') : undefined }
  } catch (err) {
    return { ...r, warning: `脱离成功，但恢复/复制热记忆失败：${String(err?.message ?? err)}` }
  }
}

/** 分叉名：优先短后缀，撞了就延长；仍撞则随机；绝不覆盖。 */
function chooseForkName(parentFolder, sid, map, rootDir) {
  const used = new Set()
  for (const v of Object.values(map || {})) used.add(String(v).toLowerCase())
  try {
    for (const d of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (d.isDirectory()) used.add(d.name.toLowerCase())
    }
  } catch { /* 目录不存在时只靠 map */ }
  const shortSid = String(sid).replace(/^session-/, '').replace(/[^a-zA-Z0-9]/g, '')
  if (!shortSid) return null
  const candidates = []
  for (let len = 4; len <= Math.min(12, shortSid.length); len++) {
    candidates.push(`-fk-${shortSid.slice(0, len)}`)
  }
  for (let i = 0; i < 50; i++) {
    const len = 4 + (i % 3)
    candidates.push(`-fk-${randomBytes(3).toString('hex').slice(0, len)}`)
  }
  candidates.push(`-fk-${Date.now().toString(36).slice(-6)}`)
  for (const suffix of candidates) {
    const base = String(parentFolder).slice(0, Math.max(1, 32 - suffix.length))
    const name = `${base}${suffix}`
    if (name.length > 32 || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(name)) continue
    if (used.has(name.toLowerCase())) continue
    if (fs.existsSync(path.join(rootDir, name))) continue
    return name
  }
  return null
}

/** 页面打开时的兜底：session/event 没送到时，从会话日志头补做一次分叉识别。 */
async function ensureForkBySid(cwd, sid, read) {
  if (!cwd || !sid) return
  const rootDir = safeRootDirName(read('rootDirName'))
  const ns = nsFor(cwd, rootDir, sid)
  if (ns.map && ns.map[sid]) return
  const log = resolveSessionLog(sid)
  if (!log) return
  try {
    const st = fs.statSync(log)
    if (st.size > 5 * 1024 * 1024) return
    const raw = await decompressLog(log)
    const first = String(raw).split('\n').find((line) => line.trim())
    if (!first) return
    const header = JSON.parse(first)
    if (header.type !== 'session') return
    ensureForkSession({ header }, read)
  } catch { /* 兜底失败不阻塞页面 */ }
}

/** 分叉会话：原会话自动建家族，分叉自动加入，不复制记忆。 */
const forkEnsured = new Set()
function ensureForkSession(session, read) {
  const h = session?.header
  if (!h || !h.id || !h.cwd || !h.parentSession) return
  if (h.isSeeded !== true || Number(h.delegationDepth) !== 0) return
  const sid = String(h.id)
  if (forkEnsured.has(sid)) return
  const parentSid = String(h.parentSession)
  const cwd = String(h.cwd)
  const rootDir = safeRootDirName(read('rootDirName'))
  const ns = nsFor(cwd, rootDir, sid)
  if (ns.map && ns.map[sid]) { forkEnsured.add(sid); return }
  const parentNs = nsFor(cwd, rootDir, parentSid)
  const parentFolder = parentNs.map?.[parentSid]
  if (!parentFolder) return
  const newName = chooseForkName(parentFolder, sid, ns.map, path.join(cwd, rootDir))
  if (!newName) {
    recordEvent('fork-name-collision', `${sid.slice(0, 8)}… 无法生成唯一名字`)
    return
  }
  if (newName.length > 32 || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(newName)) return
  try {
    const parentDir = path.join(cwd, rootDir, parentFolder)
    let parentCfg = {}
    try { parentCfg = JSON.parse(fs.readFileSync(path.join(parentDir, 'config.json'), 'utf8')) } catch { /* optional */ }
    const targetDir = path.join(cwd, rootDir, newName)
    fs.mkdirSync(targetDir, { recursive: true })
    const cfgFile = path.join(targetDir, 'config.json')
    const cfgTmp = `${cfgFile}.tmp-${process.pid}-${Date.now()}`
    const nextCfg = { ...parentCfg, name: newName, enabled: parentCfg.enabled !== false }
    delete nextCfg.familyId
    delete nextCfg.role
    fs.writeFileSync(cfgTmp, JSON.stringify(nextCfg, null, 2), 'utf8')
    fs.renameSync(cfgTmp, cfgFile)
    const map = loadNsMap(cwd, rootDir)
    map[sid] = newName
    saveNsMap(cwd, rootDir, map)
    forkEnsured.add(sid)
    const fam = familyOfSession(loadFamilies(cwd).state, parentSid)
    if (!fam || fam.family.status !== 'active') {
      assignRoot(cwd, { sessionId: parentSid, folder: parentFolder, name: parentFolder })
    }
    const fam2 = familyOfSession(loadFamilies(cwd).state, parentSid)
    if (fam2 && fam2.family.status === 'active') {
      joinFamily(cwd, {
        rootSessionId: fam2.family.rootSessionId,
        sessionId: sid,
        folder: newName,
        name: newName,
      })
    }
    recordEvent('fork-linked', `${sid.slice(0, 8)}… → ${newName}`)
  } catch (err) {
    recordEvent('fork-link-failed', String(err?.message ?? err))
  }
}

function tagRelatedDocs(cwd, cfg, hits, max = 3) {
  const docs = listDocs(cwd, cfg.name, { includeArchived: false, limit: 1000 })
  const all = (docs.items || []).filter((d) => d.enabled !== false && d.archived !== true)
  const hitIds = new Set((hits || []).map((h) => h.id))
  const out = []
  const seen = new Set()
  for (const hit of hits || []) {
    const tags = new Set((hit.tags || []).map((t) => String(t).toLowerCase()))
    for (const cand of all) {
      if (hitIds.has(cand.id) || seen.has(cand.id)) continue
      const shared = (cand.tags || []).filter((t) => tags.has(String(t).toLowerCase())).length
      const sameProject = hit.projectLabel && cand.projectLabel === hit.projectLabel
      if (!sameProject && shared < 2) continue
      seen.add(cand.id)
      out.push({
        id: cand.id,
        title: cand.title,
        projectLabel: cand.projectLabel || '',
        tags: cand.tags || [],
        reason: sameProject ? 'same-project' : `shared-tags:${shared}`,
      })
      if (out.length >= max) return out
    }
  }
  return out
}

function registerDocTools(ctx, read) {
  const defs = []
  const ctxOf = (exec) => {
    const cwd = String(exec.agent?.session?.header?.cwd ?? '')
    const sid = sessionIdOf(exec.agent)
    const cfg = resolveConfig(read, cwd, sid)
    if (!cwd || !cfg.name) return { error: '本会话还没有记忆名；先给会话命名再使用项目档案。' }
    if (!cfg.enabled || !cfg.sessionEnabled) return { error: '记忆回廊未启用（全局或本会话开关关闭）。' }
    return { cwd, sid, cfg, name: cfg.name }
  }
  function docScopeNames(cwd, cfg, sid, scope = 'own') {
    const names = new Map([[cfg.name, false]])
    if (scope === 'family') {
      const st = familyStatus(cwd, sid)
      const fam = st?.membership?.family
      if (fam) {
        if (fam.rootFolder) names.set(fam.rootFolder, fam.rootFolder !== cfg.name)
        for (const m of fam.members || []) if (m.folder) names.set(m.folder, m.folder !== cfg.name)
      }
    } else if (scope === 'workspace') {
      const map = loadNsMap(cwd, cfg.rootDirName)
      for (const folder of Object.values(map)) {
        if (typeof folder === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(folder)) names.set(folder, folder !== cfg.name)
      }
    }
    return [...names].map(([name, readOnly]) => ({ name, readOnly }))
  }
  defs.push(ctx.tools.register({
    name: 'memory_doc_search',
    description: '搜索当前会话的项目档案（标题/描述/tags/正文关键词），返回有界片段；默认不含归档文档。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词' },
        scope: { type: 'string', description: 'own / family / workspace；默认 own。family/workspace 只读。' },
        includeArchived: { type: 'boolean', description: '是否包含已归档文档' },
        limit: { type: 'number', description: '最多返回条数，默认 20，上限 100' },
        tag: { type: 'string', description: '可选：只搜带该 tag 的文档' },
        projectLabel: { type: 'string', description: '可选：只搜属于该项目的文档' },
        includeDisabled: { type: 'boolean', description: '可选：把已停用档案也纳入搜索（默认不纳入；归档档案仍不返回）。' },
      },
      required: ['query'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const c = ctxOf(exec)
      if (c.error) return c.error
      const scope = ['own', 'family', 'workspace'].includes(args.scope) ? args.scope : 'own'
      if (isSubagentSession(exec.agent) && scope !== 'own') return '子智能体只能查 own 项目档案。'
      const opts = {
        includeArchived: false,
        limit: args.limit,
        tag: args.tag,
        projectLabel: args.projectLabel,
      }
      const includeDisabled = args.includeDisabled === true
      if (scope === 'own') {
        const r = searchDocs(c.cwd, c.name, String(args.query || ''), opts)
        const items = (r.items || []).filter((item) => includeDisabled || item.enabled !== false)
        const related = tagRelatedDocs(c.cwd, c.cfg, items, 3)
        return JSON.stringify({ ...r, total: items.length, items, related }, null, 2)
      }
      const max = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
      const items = []
      for (const target of docScopeNames(c.cwd, c.cfg, c.sid, scope)) {
        const r = searchDocs(c.cwd, target.name, String(args.query || ''), { ...opts, limit: max })
        for (const item of r.items || []) {
          if (!includeDisabled && item.enabled === false) continue
          items.push({ ...item, owner: target.name, readOnly: target.readOnly })
        }
      }
      return JSON.stringify({ ok: true, scope, total: items.length, items: items.slice(0, max) }, null, 2)
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_doc_read',
    description: '按 id 读取当前会话的一篇项目档案。默认最多返回 20000 字符；长文用 offset/maxChars 分段读，不要一次把整篇塞进上下文。先用 memory_doc_search 定位，再读需要的部分。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        scope: { type: 'string', description: 'own / family / workspace；默认 own。' },
        offset: { type: 'number', description: '正文起始字符偏移，默认 0' },
        maxChars: { type: 'number', description: '本次最多字符数，默认 20000，上限 50000' },
      },
      required: ['id'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const c = ctxOf(exec)
      if (c.error) return c.error
      const scope = ['own', 'family', 'workspace'].includes(args.scope) ? args.scope : 'own'
      if (isSubagentSession(exec.agent) && scope !== 'own') return '子智能体只能读 own 项目档案。'
      let r = null
      if (scope === 'own') {
        r = readDoc(c.cwd, c.name, String(args.id || ''))
      } else {
        for (const target of docScopeNames(c.cwd, c.cfg, c.sid, scope)) {
          const got = readDoc(c.cwd, target.name, String(args.id || ''))
          if (got.ok) { r = { ...got, owner: target.name, readOnly: target.readOnly }; break }
        }
        if (!r) r = { ok: false, error: '在指定 scope 内找不到该文档。' }
      }
      if (!r.ok || typeof r.body !== 'string') return JSON.stringify(r, null, 2)
      if (r.doc && r.doc.archived === true) {
        const { body, path: _p, ...rest } = r
        return JSON.stringify({ ...rest, ok: false, error: '项目档案已归档；模型默认不读取，需用户在项目档案里手动取消归档。' }, null, 2)
      }
      const total = r.body.length
      const offset = Math.min(Math.max(Number(args.offset) || 0, 0), total)
      const maxChars = Math.min(Math.max(Number(args.maxChars) || 20000, 1000), 50000)
      const body = r.body.slice(offset, offset + maxChars)
      return JSON.stringify({
        ...r,
        body,
        bodyTotalChars: total,
        bodyOffset: offset,
        bodyTruncated: offset + body.length < total,
        nextOffset: offset + body.length < total ? offset + body.length : null,
      }, null, 2)
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_doc_outline',
    description: '返回项目档案的章节目录（标题 + offset + 字符数），不返回正文；长文先看目录，再用 memory_doc_read 的 offset 读相关章节。',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const c = ctxOf(exec)
      if (c.error) return c.error
      return JSON.stringify(outlineDoc(c.cwd, c.name, String(args.id || '')), null, 2)
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_doc_create',
    description: '在当前会话创建一篇项目档案。标题必填；正文放 content；projectLabel 必须由你判断并填写（不属于具体项目写 general），不要留给用户。用户手动创建时才允许空白。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown 正文' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        projectLabel: { type: 'string', description: '必填：所属项目，最多 5 个英文单词；不属于具体项目写 general' },
      },
      required: ['title', 'projectLabel'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const c = ctxOf(exec)
      if (c.error) return c.error
      const input = { title: args.title, body: args.content ?? '', description: args.description, tags: args.tags, projectLabel: args.projectLabel }
      return JSON.stringify(createDoc(c.cwd, c.name, c.sid, input), null, 2)
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_doc_update',
    description: '更新当前会话的项目档案；必须带当前 rev。可改 title/content/description/tags/projectLabel/enabled。归档/取消归档只能由用户操作；模型维护项目档案时应负责维护 projectLabel。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        rev: { type: 'number' },
        title: { type: 'string' },
        content: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        projectLabel: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['id', 'rev'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const c = ctxOf(exec)
      if (c.error) return c.error
      const input = { rev: Number(args.rev) }
      if (args.title !== undefined) input.title = args.title
      if (args.content !== undefined) input.body = args.content
      if (args.description !== undefined) input.description = args.description
      if (args.tags !== undefined) input.tags = args.tags
      if (args.projectLabel !== undefined) input.projectLabel = args.projectLabel
      if (args.archived !== undefined) return '归档/取消归档只能由用户在项目档案页签操作。'
      if (args.enabled !== undefined) input.enabled = args.enabled
      const cfg = resolveConfig(read, c.cwd, c.sid)
      return JSON.stringify(updateDocWithProjectEffects(c.cwd, cfg, c.sid, String(args.id || ''), input), null, 2)
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_doc_remove',
    description: '软删除当前会话的一篇项目档案（移到 memory-docs 的 .trash）。',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const c = ctxOf(exec)
      if (c.error) return c.error
      return JSON.stringify(removeDoc(c.cwd, c.name, c.sid, String(args.id || '')), null, 2)
    },
  }))
  defs.push(ctx.tools.register({
    name: 'memory_family_decide',
    description: '记录用户对“旧根热记忆缺失”的重建决定。仅当家族 rebuildPending=true 时可用；yes=用户同意重建，no=保持为空。调用前必须先用 ask_user_question 询问用户。',
    parameters: {
      type: 'object',
      properties: { decision: { type: 'string', enum: ['yes', 'no'] } },
      required: ['decision'],
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      if (isSubagentSession(exec.agent)) return '子代理不能决定家族重建。'
      const c = ctxOf(exec)
      if (c.error) return c.error
      const st = familyStatus(c.cwd, c.sid)
      if (!st.ok || !st.membership) return '当前会话不属于任何家族。'
      if (!st.membership.family.rebuildPending) return '当前家族没有待重建标记。'
      const r = resolveFamilyRebuild(c.cwd, st.membership.family.familyId, String(args.decision || 'no'))
      return JSON.stringify(r, null, 2)
    },
  }))
  return defs
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
        namespace: { type: 'string', description: '可选：别的会话的记忆命名空间名；省略 = 按 scope 查。' },
        scope: { type: 'string', description: 'own / family / workspace；默认 own。all:true 等价 workspace。' },
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
      if (isSubagentSession(exec.agent) && (args.all || args.namespace || ['family', 'workspace'].includes(args.scope))) {
        return '子智能体只能检索 own 作用域，不能跨会话读归档。'
      }
      // 目标命名空间：默认按 scope；显式 namespace 时只查该目录。
      let targets
      if (args.namespace) {
        const picked = pickNsDir(cwd, cfg.rootDirName, sid, args.namespace)
        if (!picked.ok) return `找不到记忆命名空间「${String(args.namespace).trim()}」。`
        targets = [{ folder: picked.folder, dir: picked.dir }]
      } else {
        const scope = args.all ? 'workspace' : (['own', 'family', 'workspace'].includes(args.scope) ? args.scope : 'own')
        targets = resolveScopeTargets(cwd, cfg, sid, scope).targets
      }
      if (targets.length === 0) return '归档记忆为空（没有任何命名空间有归档）。'
      let rows = []
      let indexBadLines = 0
      for (const t of targets) {
        try {
          const list = readArchiveIndexCached(t.dir)
          indexBadLines += Number(list.badLines) || 0
          rows.push(...list.rows.map((r) => ({ ...r, _folder: t.folder, _dir: t.dir })))
        } catch (err) {
          recordEvent('search-error', `${t.folder}: ${String(err?.message ?? err)}`)
        }
      }
      if (rows.length === 0) {
        return args.all ? '归档记忆为空（索引都读不到）。' : '归档记忆为空（本会话还没有任何归档）。'
      }
      let hits = rows
      if (args.date) hits = hits.filter((r) => (r.archivedAt ?? '').startsWith(args.date))
      if (args.category) {
        const wanted = normalizeCategory(String(args.category))
        hits = hits.filter((r) => normalizeCategory(r.category) === wanted)
      }
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
      let tokens = (keyword.match(/"([^"]+)"|[^\s"]+/g) ?? [keyword]).map((t) => t.replace(/^"|"$/g, '').toLowerCase()).filter(Boolean)
      // 单字查询只会命中大量常用字，直接拒绝；混合查询里丢掉单字，保留有意义的词。
      tokens = tokens.filter((t) => t.length >= 2 || /^[a-z0-9_]{2,}$/.test(t))
      if (tokens.length === 0) {
        return '关键词太短：至少输入 2 个字符，或换一个更具体的词。'
      }
      // 每个原词带一组近义词；行内只需命中每组中的一个变体，降低“换词就搜不到”的概率。
      const tokenGroups = tokens.map((tk) => {
        const variants = [tk]
        for (const item of expandQuery(tk)) {
          if (item.term !== tk && item.weight >= 0.45 && variants.length < 6) variants.push(item.term)
        }
        return variants
      })
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
        const lineHitTurns = new Set()
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
          for (const group of tokenGroups) {
            let groupHit = false
            for (const tk of group) {
              const at = low.indexOf(tk)
              if (at < 0) continue
              groupHit = true
              if (firstAt < 0 || at < firstAt) firstAt = at
              let p = at
              while (p >= 0) { count += 1; p = low.indexOf(tk, p + tk.length) }
            }
            if (!groupHit) { ok = false; break }
          }
          if (!ok) continue
          const turn = lastTurn
          lineHitTurns.add(turn ?? '?')
          const from = Math.max(0, firstAt - 100)
          const snippet = line.slice(from, from + 220).replace(/\s+/g, ' ').trim()
          // 工具/JSON/命令行行的识别：这种行适合当证据，不适合当“这轮在聊什么”的代表
          const toolish = /^\s*(?:\{|\[|```|\$|>|\d+[:：]\s)|\bfile_path\b|"command"|\\n|Select-Object|ForEach-Object|Import-Module/.test(line)
          const hit = { file: r.file, cat: r.category, ns: r._folder, folder: r._folder, turn, lineNo: i + 1, snippet, count, inUser: inUserBlock, toolish, src: String(r.sessionId ?? '') }
          if (groupByTurn) {
            const key = `${r._folder}|${r.file}|${turn ?? '?'}`
            const cur = perTurn.get(key)
            if (!cur) perTurn.set(key, { ...hit, best: hit, total: count, userHits: hit.inUser ? count : 0 })
            else {
              cur.total += count
              if (hit.inUser) cur.userHits = (cur.userHits || 0) + count
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
        // 多词查询允许跨行命中同一轮：避免“大半夜 打不开”因两个词不在同一行而漏检。
        if (tokenGroups.length > 1) {
          const blocks = new Map()
          let blockTurn = null
          for (let i = 0; i < lines.length; i++) {
            if (byLine.has(i)) blockTurn = byLine.get(i)
            if (blockTurn === null || i < firstTurnLine) continue
            const arr = blocks.get(blockTurn) || []
            arr.push({ i, line: lines[i], low: lowerLines[i] })
            blocks.set(blockTurn, arr)
          }
          for (const [blockTurn, arr] of blocks) {
            if (lineHitTurns.has(blockTurn ?? '?')) continue
            const text = arr.map((x) => x.line).join('\n')
            const low = text.toLowerCase()
            let ok = true
            let firstAt = -1
            let count = 0
            for (const group of tokenGroups) {
              let groupHit = false
              for (const tk of group) {
                const at = low.indexOf(tk)
                if (at < 0) continue
                groupHit = true
                if (firstAt < 0 || at < firstAt) firstAt = at
                let p = at
                while (p >= 0) { count += 1; p = low.indexOf(tk, p + tk.length) }
              }
              if (!groupHit) { ok = false; break }
            }
            if (!ok) continue
            const from = Math.max(0, firstAt - 100)
            const hit = {
              file: r.file, cat: r.category, ns: r._folder, folder: r._folder, turn: blockTurn,
              lineNo: arr[0].i + 1, snippet: text.slice(from, from + 220).replace(/\s+/g, ' ').trim(),
              count, inUser: false, toolish: false, src: String(r.sessionId ?? ''),
            }
            if (groupByTurn) {
              const key = `${r._folder}|${r.file}|${blockTurn ?? '?'}`
              if (!perTurn.has(key)) perTurn.set(key, { ...hit, best: hit, total: count, userHits: 0 })
            } else {
              rawHits.push(hit)
              if (rawHits.length >= capRaw) break
            }
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
        const list = [...perTurn.values()]
          .sort((a, b) => (b.userHits || 0) - (a.userHits || 0)
            || (b.total || 0) - (a.total || 0)
            || (a.best?.turn || 0) - (b.best?.turn || 0))
          .slice(0, capTurns)
        if (list.length === 0) {
          return limitNote + `正文里没有找到「${keyword}」` + (readErrors ? `（另有 ${readErrors} 个文件读取失败）` : '') + (indexBadLines ? `（另有 ${indexBadLines} 行索引损坏已跳过）` : '') + '。' + summarySection()
        }
        text = `命中 ${list.length} 轮（按轮聚合；每轮只给一条代表命中，括号内是该轮总命中数）：\n\n`
          + list.map((h) => fmtHit(h.best, `（${h.total} 处）`)).join('\n\n')
      } else {
        if (rawHits.length === 0) {
          return limitNote + `正文里没有找到「${keyword}」` + (readErrors ? `（另有 ${readErrors} 个文件读取失败）` : '') + (indexBadLines ? `（另有 ${indexBadLines} 行索引损坏已跳过）` : '') + '。' + summarySection()
        }
        rawHits.sort((a, b) => (b.inUser ? 1 : 0) - (a.inUser ? 1 : 0) || (b.count || 0) - (a.count || 0) || (a.turn || 0) - (b.turn || 0))
        text = `命中 ${rawHits.length} 行（原始命中；要按轮聚合用 groupByTurn=true）：\n\n` + rawHits.map((h) => fmtHit(h, '')).join('\n\n')
      }
      text = limitNote + text
      if (args.includeSummary) text += summarySection()
      if (readErrors > 0) text += `\n\n（有 ${readErrors} 个归档文件读取失败，已跳过）`
      if (indexBadLines > 0) text += `\n\n（有 ${indexBadLines} 行索引损坏，已跳过；不影响本次结果，但建议检查 index.jsonl）`
      if (text.length > MAX_OUT) {
        text = text.slice(0, MAX_OUT) + `\n…（结果过长已截断；请缩小范围：加 category / date，或调小 limitTurns）`
        recordEvent('search-truncated', `keyword=${keyword} chars=${text.length}`)
      }
      try {
        const hits = groupByTurn ? [...perTurn.values()].slice(0, capTurns).map((x) => x.best) : rawHits
        const files = hits.map((h) => h?.file).filter(Boolean)
        const months = files.map((f) => (String(f).match(/(\d{4}-\d{2})/) || [])[1]).filter(Boolean)
        const categories = args.category ? [String(args.category)] : hits.map((h) => h?.category || h?.best?.category).filter(Boolean)
        recordPalaceQuery(sid, { months, categories, files, turns: hits.length, tokens: estimateTokens(text) })
      } catch { /* 统计失败不影响检索 */ }
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
        includeRetained: { type: 'boolean', description: '默认 false：只显示可归档区，保留区不读。需要看最近未归档轮次时显式设 true。' },
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
      const includeRetained = args.includeRetained === true
      let boundary = 0
      let kept = 0
      let keptBytes = 0
      let capBytes = 0
      let watermark = 0
      try {
        const win = await effectiveWindow(agent, cfg)
        capBytes = retentionCapBytes(cfg, win)
        const tailFrom = retainedFromCapped(turns, Number.MAX_SAFE_INTEGER, capBytes)
        const safeLast = last > 1 ? last - 1 : 0
        const rawBoundary = tailFrom > 0 ? turns[tailFrom - 1].turn : 0
        boundary = rawBoundary > 0 ? Math.min(rawBoundary, safeLast) : 0
        kept = tailFrom > 0 ? turns.length - tailFrom : turns.length
        for (let i = tailFrom; i < turns.length; i++) keptBytes += turnBytes(turns[i])
        const st = readState(cwd, cfg.rootDirName, sid)
        const ranges = Array.isArray(st?.[sid]?.archivedRanges) ? st[sid].archivedRanges : []
        watermark = ranges.length > 0
          ? ranges.reduce((m, r) => Math.max(m, Number(r?.[1]) || 0), 0)
          : (Number(st?.[sid]?.archivedThroughTurn) || 0)
      } catch { /* 边界失败按无边界处理 */ }
      const boundaryLine = `\n归档水位：turn ${watermark}；可归档边界：${boundary > 0 ? `turn ${boundary}` : '无（全部在保留区）'}；保留区：${kept} 轮 / ${(keptBytes / 1024).toFixed(1)} KB（上限 ${(capBytes / 1024).toFixed(1)} KB）。`
      if (!includeRetained && (boundary <= 0 || watermark >= boundary)) {
        return `当前没有可归档轮次：已归档到 turn ${watermark}，可归档边界为 ${boundary}；保留区从 turn ${watermark + 1} 开始。${boundaryLine}`
      }
      const rawHi = Number.isFinite(args.toTurn) ? Number(args.toTurn) : (includeRetained ? last : boundary)
      const hi = includeRetained ? rawHi : Math.min(rawHi, boundary)
      const lo = includeRetained
        ? (Number.isFinite(args.fromTurn) ? Number(args.fromTurn) : Math.max(1, hi - cap0 + 1))
        : (Number.isFinite(args.fromTurn) ? Math.max(Number(args.fromTurn), watermark + 1) : Math.max(watermark + 1, hi - cap0 + 1))
      const cap = cap0
      const clipped = !includeRetained && hi < rawHi
      const list = turns.filter((t) => t.turn >= lo && t.turn <= hi).slice(0, cap)
      if (list.length === 0) return `turn ${lo}–${hi} 之间没有可归档轮次（水位 ${watermark}，边界 ${boundary}）。${boundaryLine}`
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
      const note = clipped ? `\n（已忽略保留区 ${last - boundary} 轮；确需查看请显式传 includeRetained:true）` : ''
      return `turn ${lo}–${hi}（日志共 ${turns.length} 轮，最新 turn ${last}）：\n` + lines.join('\n') + more + boundaryLine + note
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
        scope: { type: 'string', description: '可选：own / family / workspace；默认 own。family/workspace 只读，列出各成员摘要。' },
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
      const scope = ['own', 'family', 'workspace'].includes(args.scope) ? args.scope : 'own'
      const appendText = String(args.append ?? '').trim()
      if (appendText && scope !== 'own') throw new Error('append 只能写自己的摘要，不能写 family/workspace。')
      if (scope !== 'own' && !args.namespace) {
        const targets = resolveScopeTargets(cwd, cfg, sid, scope).targets
        if (targets.length === 0) return '归档摘要为空（没有任何命名空间有归档）。'
        const month = String(args.month ?? '').trim()
        if (month && !/^\d{4}-\d{2}$/.test(month)) throw new Error('month 格式是 YYYY-MM，例如 2026-10。')
        const catFilter = String(args.category ?? '').trim()
        const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 36)
        const blocks = []
        for (const t of targets) {
          const months = fs.existsSync(t.dir)
            ? fs.readdirSync(t.dir).filter((n) => {
              if (!/^\d{4}-\d{2}$/.test(n)) return false
              try { return fs.statSync(path.join(t.dir, n)).isDirectory() } catch { return false }
            }).sort()
            : []
          if (months.length === 0) continue
          if (month) {
            const file = path.join(t.dir, month, '_summary.md')
            if (!fs.existsSync(file)) continue
            let text = fs.readFileSync(file, 'utf8')
            if (catFilter) {
              const parts = text.split(/\n(?=## )/)
              const head = parts.shift() ?? ''
              const keep = parts.filter((b) => b.includes(`[${catFilter}]`))
              if (keep.length === 0) continue
              text = [head, ...keep].join('\n')
            }
            blocks.push(`【${t.folder}】\n${text.trim()}`)
          } else {
            const recent = months.slice(-limit).reverse()
            const parts = recent.map((m) => {
              const file = path.join(t.dir, m, '_summary.md')
              if (!fs.existsSync(file)) return `${m}：无摘要`
              const text = fs.readFileSync(file, 'utf8').trim()
              return `${m}：\n${text.length > 500 ? '…' + text.slice(-500) : text}`
            })
            blocks.push(`【${t.folder}】\n${parts.join('\n\n')}`)
          }
        }
        if (blocks.length === 0) return `没有匹配的${month ? ` ${month} ` : ''}摘要。`
        let text = '> turn = 日志事件序号（含系统指令、插件注入、工具调用），不是“第几条消息”。\n\n'
          + `scope=${scope}，共 ${blocks.length} 个成员。\n\n` + blocks.join('\n\n— — —\n\n')
        if (text.length > 60000) text = text.slice(0, 60000) + '\n…（已截断）'
        return text
      }
      const picked = pickNsDir(cwd, cfg.rootDirName, sid, args.namespace)
      if (!picked.ok) throw new Error(`找不到记忆命名空间「${String(args.namespace).trim()}」。`)
      const nsDir = picked.dir
      const catFilter = String(args.category ?? '').trim()

      // 补写摘要：给「还没归档、但已经聊过」的近期内容落一段摘要，让摘要层永远覆盖到最近。
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
        member: { type: 'string', description: '可选：家族成员的命名空间名，等价于 namespace；用于读成员原文。' },
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
      const targetNs = String(args.member || args.namespace || '').trim()
      const picked = pickNsDir(cwd, cfg.rootDirName, sid, targetNs)
      if (!picked.ok) throw new Error(`找不到记忆命名空间「${targetNs}」。`)
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
      const resultText = links && off === 0 ? out + links : out
      try {
        const month = (String(relPath).match(/(\d{4}-\d{2})/) || [])[1]
        const cat = String(relPath).split('/').slice(-2, -1)[0] || ''
        const from = Number(args.fromTurn)
        const to = Number(args.toTurn)
        const turns = Number.isFinite(from) && Number.isFinite(to) ? Math.max(1, to - from + 1) : 1
        recordPalaceQuery(sid, { months: month ? [month] : [], categories: cat ? [cat] : [], files: [relPath], turns, tokens: estimateTokens(resultText) })
      } catch { /* 统计失败不影响读取 */ }
      return resultText
    },
  })
}

/** 工作区级配置工具：让会话模型能查/改本工作区的阈值，不需要界面。 */
function registerConfigTool(ctx, read) {
  return ctx.tools.register({
    name: 'palace_config',
    description:
      '查看或修改当前会话的记忆回廊配置（<会话>/config.json）；get 会同时带出只读的 workspaceDefaults。'
      + 'set 只写会话层，不影响全局和其他工作区。'
      + '可改项：enabled、triggerPressure、retainBytes、maxFileBytes、checkEveryTurns、minBatchTurns、selfNameSlug、includeReasoning、compactAfterArchive、injectNotice。',
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
        } else if (k === 'coreInjection') {
          const s = String(v)
          if (!['off', 'on', 'test'].includes(s)) throw new Error('coreInjection 必须是 off / on / test')
          clean[k] = s
        } else if (k === 'coreInjectionBudget') {
          const n = Number(v)
          if (!(n >= 1000 && n <= 20000)) throw new Error('coreInjectionBudget 必须在 1000–20000')
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
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
      fs.renameSync(tmp, file)
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
  for (const register of [registerArchiveTool, registerTurnsTool, registerSearchTool, registerSummaryTool, registerReadTool, registerConfigTool, registerCoreTools, registerDocTools]) {
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
  const guidance = '【记忆宫殿】长期记忆在工作区 memory-palace/<记忆名>/。旧对话：palace_summary→palace_search→palace_read；项目档案：memory_doc_search→memory_doc_read；热记忆：memory_core_*。用户提到“上次/之前/有一次/记得吗/想一下”等旧事线索时，先考虑 palace_search，不要凭印象编造。持久偏好/纠正/身份设定/项目事实可直接 memory_core_write 到 identity/profile/memories；rules 的 important 级可直接写/改，mind-seal 只能 memory_core_candidate，用户确认后才写；测试、临时进度、推测、重复内容不要写。非命令式内容由模型按语义判断是否写入对应板块，不询问用户；规则只提候选。板块判断：用户本人/偏好→profile；助手自我/性格→identity；硬约束/安全→rules；事件/关系/事故/决策→memories；项目/环境事实→项目档案；项目热记忆按内容选 section（角色自设→identity、偏好→profile、硬约束→rules、事件/决策→memories），必须带 projectLabel，不要写全局。工具会返回结构化结果/警告，只读需要的正文，不要整篇塞上下文；不要修改 memory-palace 下的文件。归档只在系统提示时执行。'
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
      // 本地热记忆：用 section 而不是可缓存的 context provider，项目档案状态变化后每轮重新求值。
      prompted.get('systemPrompt').section({
        name: 'memory-palace-core-live',
        order: 899,
        text: (assembleCtx) => {
          try {
            const agent = assembleCtx?.agent
            const cwd = String(agent?.session?.header?.cwd ?? '')
            const sid = sessionIdOf(agent)
            if (!cwd || !sid || isSubagentSession(agent)) return ''
            const cfg = resolveConfig(read, cwd, sid)
            if (!cfg.enabled || !cfg.sessionEnabled) return ''
            const text = coreInjectionText(cwd, cfg, { consume: true, sid })
            if (text) lastInjectedTurn.add(sid)
            return text
          } catch (err) {
            recordEvent('core-context-error', String(err?.message ?? err))
            return ''
          }
        },
      })
      prompted.get('systemPrompt').section({
        name: 'memory-palace-project-index',
        order: 898,
        text: (assembleCtx) => {
          try {
            const agent = assembleCtx?.agent
            const cwd = String(agent?.session?.header?.cwd ?? '')
            const sid = sessionIdOf(agent)
            if (!cwd || !sid || isSubagentSession(agent)) return ''
            const cfg = resolveConfig(read, cwd, sid)
            return projectDocsInjectionText(cwd, cfg)
          } catch {
            return ''
          }
        },
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
        confirmToken: CORE_CONFIRM_TOKEN,
        coreDebug: (cwd, cfg) => coreDebugInfo(cwd, cfg),
  coreInjectPreview: (cwd, cfg, sid) => coreInjectionText(cwd, cfg, { sid, consume: false }),
        coreList: (cwd, cfg, section) => {
          const r = readCoreEntries(cwd, cfg, section)
          return r && r.ok ? { ...r, allTokens: coreAllTokens(cwd, cfg) } : r
        },
        coreWrite: async (cwd, cfg, input, writeSid) => {
          const r = await withSessionWriteLock(writeSid, () => writeCoreEntry(cwd, cfg, input))
          if (r.ok) {
            recordPalaceWrite(writeSid, {
              id: r.meta.id,
              section: r.meta.board,
              content: input.content,
              action: input.migration ? 'migration' : (r.meta.rev > 1 ? 'update' : 'create'),
            })
          }
          return r
        },
        coreRemove: (cwd, cfg, id, board, allowRules, removeSid) => {
          const r = removeCoreEntry(cwd, cfg, id, { allowRules, board })
          if (r.ok) recordPalaceWrite(removeSid, { id, section: board || r.board, content: '', action: 'delete' })
          return r
        },
        coreMove: (cwd, cfg, id, from, to, allowRules, moveSid) => {
          const r = moveCoreEntry(cwd, cfg, id, from, to, { allowRules })
          if (r.ok) recordPalaceWrite(moveSid, { id, section: to, content: '', action: 'move' })
          return r
        },
        corePending: (cwd, cfg, id, board) => markCorePending(cwd, cfg, id, board),
        coreInjectState: (cwd, cfg, sid) => coreInjectState(cwd, cfg, sid),
        coreCandidates: (cwd, cfg, sid) => ({ ok: true, items: coreCandidateList(cwd, cfg, sid) }),
        projectsList: (cwd, cfg) => ({ ok: true, items: listProjectLabels(cwd, cfg) }),
        projectSet: (cwd, cfg, label, enabled) => setProjectEnabled(cwd, cfg, label, enabled),
        coreCandidateAccept: (cwd, cfg, sid, id) => coreCandidateAccept(cwd, cfg, sid, id),
        coreCandidateDismiss: (cwd, cfg, sid, id) => coreCandidateRemove(cwd, cfg, sid, id),
        ensureFork: (agent) => ensureForkSession(agent?.session, read),
        ensureForkBySid: (cwd, sid) => ensureForkBySid(cwd, sid, read),
        docsList: (cwd, cfg, opts) => listDocs(cwd, cfg.name, opts || {}),
        docsSearch: (cwd, cfg, query, opts) => searchDocs(cwd, cfg.name, query, opts || {}),
        docsRead: (cwd, cfg, id, opts = {}) => {
          const r = readDoc(cwd, cfg.name, id)
          if (!r.ok) return r
          const full = String(r.body || '')
          const total = full.length
          const maxChars = Math.min(Math.max(Number(opts.maxChars) || 20000, 1000), 50000)
          const offset = Math.min(Math.max(Number(opts.offset) || 0, 0), total)
          const body = full.slice(offset, offset + maxChars)
          const nextOffset = offset + body.length < total ? offset + body.length : null
          return { ...r, body, totalChars: total, offset, nextOffset }
        },
        docsCreate: async (cwd, cfg, sid, input) => withSessionWriteLock(sid, () => {
          const r = createDoc(cwd, cfg.name, sid, input || {})
          if (r.ok && r.doc?.projectLabel && r.doc.enabled !== false && r.doc.archived !== true) restoreProjectOrphan(cwd, cfg, r.doc.projectLabel)
          return r
        }),
        docsUpdate: async (cwd, cfg, sid, id, input) => withSessionWriteLock(sid, () => updateDocWithProjectEffects(cwd, cfg, sid, id, input)),
        docsRemove: async (cwd, cfg, sid, id) => withSessionWriteLock(sid, () => {
          const before = listDocs(cwd, cfg.name, { includeArchived: true, limit: 1000 })
          const doc = (before.items || []).find((d) => d.id === id)
          const r = removeDoc(cwd, cfg.name, sid, id)
          if (r.ok && doc?.projectLabel) syncProjectArchive(cwd, cfg, doc.projectLabel, { orphan: true })
          return r
        }),
        familyStatus: (cwd, sid) => {
          try { pruneMissingMembers(cwd, (id) => Boolean(resolveSessionLog(id))) } catch { /* 清理失败不阻塞状态读取 */ }
          return familyStatus(cwd, sid)
        },
        familyRoot: async (cwd, cfg, sid) => withSessionWriteLock(sid, () => withFamilyFileLock(cwd, sid, () => assignRoot(cwd, { sessionId: sid, folder: cfg.folder, name: cfg.name }))),
        familyJoin: async (cwd, cfg, sid, rootSessionId) => withSessionWriteLock(rootSessionId || sid, () => withFamilyFileLock(cwd, rootSessionId || sid, () => familyJoinWithCore(cwd, cfg, sid, rootSessionId))),
        familyDetach: async (cwd, cfg, sid) => withSessionWriteLock(cfg.familyId || sid, () => withFamilyFileLock(cwd, cfg.familyId || sid, () => familyDetachWithCore(cwd, cfg, sid))),
        familyAbdicate: async (cwd, cfg, sid) => withSessionWriteLock(cfg.familyId || sid, () => withFamilyFileLock(cwd, cfg.familyId || sid, () => abdicateRoot(cwd, sid))),
        familyDissolve: async (cwd, cfg, sid) => withSessionWriteLock(cfg.familyId || sid, () => withFamilyFileLock(cwd, cfg.familyId || sid, () => dissolveFamily(cwd, sid))),
        familyTransfer: async (cwd, cfg, sid, newRootSessionId, newRootName) => withSessionWriteLock(cfg.familyId || sid, () => withFamilyFileLock(cwd, cfg.familyId || sid, () => {
          if (cfg.familyRole !== 'root') return { ok: false, error: '只有当前母归属可以发起根转移' }
          const r = transferRoot(cwd, { familyId: cfg.familyId || sid, fromSessionId: sid, newRootSessionId, newRootName })
          if (r.ok && r.family && r.oldRootFolder && r.family.rootFolder) {
            const copy = copyRootCoreForTransfer(cwd, cfg, r.oldRootFolder, r.family.rootFolder)
            r.copied = copy.copied
            if (copy.conflicts.length) r.warning = `有 ${copy.conflicts.length} 条同 id 热记忆未覆盖：${copy.conflicts.slice(0, 5).join('、')}`
          }
          return r
        })),
        familyRebuild: async (cwd, cfg, sid, decision) => withSessionWriteLock(cfg.familyId || sid, () => withFamilyFileLock(cwd, cfg.familyId || sid, () => resolveFamilyRebuild(cwd, cfg.familyId || sid, decision))),
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
            + '不要解释、不要复述原文；完成后不要写正文、不要复述归档结果，直接结束本轮；详细结果由底部显示。'
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
        ensureForkSession(session, read)
        const sid = session?.header?.id ?? session?.id
        if (!sid || !event) return
        // 记录最后一条用户消息来源：插件自己 steer 出来的消息不能再触发下一轮 steer（FIX-2）。
        if (event.type === 'user/message') {
          const rawKind = event.data?.source?.kind
          const rawContent = event.data?.content ?? event.data?.message?.content
          const messageText = (typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent.map((part) => (typeof part === 'string' ? part : part?.text || '')).join(' ')
              : JSON.stringify(rawContent ?? '')).slice(0, 8000)
          // 宿主重放 steer / 系统提示时可能丢失 source，必须同时按文本头识别。
          const isPluginText = /^\s*(?:\[记忆回廊·系统注入\]|【系统指令 · 记忆|【记忆宫殿】|【项目档案 · 已启用】|【记忆核心 · 记忆回廊】)/.test(messageText)
          const kind = isPluginText ? 'dsh-memory-palace' : rawKind
          const isRealUser = !isPluginText && (!kind || kind === 'user' || kind === '')
          if (typeof kind === 'string' && kind) lastUserSourceBySid.set(String(sid), kind)
          if (isRealUser) {
            try {
              const cues = detectCueWords(messageText)
              lastUserCueBySid.delete(String(sid))
              if (cues.length) {
                recordEvent('recall-cue', `${String(sid).slice(0, 8)}… ${[...new Set(cues)].join('/')}`)
                lastUserCueBySid.set(String(sid), [...new Set(cues)])
              }
            } catch { /* ignore */ }
          }
          if (isRealUser) {
            pendingInjectTurn.add(String(sid))
            lastInjectedTurn.delete(String(sid))
            palaceQueryBySid.delete(String(sid))
            palaceArchiveBySid.delete(String(sid))
            palaceWriteBySid.delete(String(sid))
            try {
              const cwd = String(session?.header?.cwd ?? '')
              if (cwd) {
                const cfg = resolveConfig(read, cwd, sid)
                if (cfg.enabled && cfg.sessionEnabled && cfg.name) {
                  bumpCoreTier(cwd, cfg, sid, { turns: 1 })
                  if (isRealUser) {
            const cap = autoCaptureHighConfidence(cwd, cfg, sid, messageText)
            if (cap?.classify?.length) sendMemoryClassifySteer(agent, sid, cap.classify)
          }
                }
              }
            } catch { /* 候选抽取失败不影响对话 */ }
          }
          return
        }
        if (event.type === 'assistant/message') {
          try {
            const cwd = String(session?.header?.cwd ?? '')
            const text = JSON.stringify(event.data?.message?.content ?? '')
            if (cwd && text) {
              const cfg = resolveConfig(read, cwd, sid)
              if (cfg.enabled && cfg.sessionEnabled && cfg.name) {
                bumpCoreTier(cwd, cfg, sid, { turns: 0, outputTokens: estimateTokens(text) })
              }
            }
          } catch { /* 计数失败不影响对话 */ }
          return
        }
        if (event.type !== 'compaction/end') return
        pendingFullAfterCompaction.add(String(sid))
        try {
          const cwd = String(session?.header?.cwd ?? '')
          if (cwd) {
            const cfg = resolveConfig(read, cwd, sid)
            if (cfg.enabled && cfg.sessionEnabled && cfg.name) {
              const state = readState(cwd, cfg.rootDirName, sid)
              const tier = coreTierState(state)
              tier.minorPending = true
              state.coreTier = tier
              writeState(cwd, cfg.rootDirName, state, sid)
            }
          }
        } catch { /* ignore */ }
        recordEvent('compaction-detected', String(sid).slice(0, 8) + '…')
      } catch { /* ignore */ }
    })
  } catch (err) {
    safeLog(ctx, 'session/event subscribe failed: ' + (err?.message ?? String(err)))
  }

  // 每 checkEveryTurns 轮检查一次：估算占用率，达到阈值就 steer 一句，让模型去归档。
  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    try {
      ensureForkSession(agent?.session, read)
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
const lastUserCueBySid = new Map()
// 只有用户真正发消息后的第一次模型请求才消费手动注入 pending，避免被内部请求提前吃掉。
const pendingInjectTurn = new Set()
const lastInjectedTurn = new Set()
// 上次发 steer 的时间：短冷却窗兜底，防止工具步连续 turn-stopping 时连发多条指令。
const lastSteerSentAt = new Map()
const STEER_COOLDOWN_MS = 15000
// 本回合 palace_* 检索统计，供 turnTail 显示。
const palaceQueryBySid = new Map()
const palaceArchiveBySid = new Map()

function recordPalaceArchive(sid, info) {
  if (!sid) return
  palaceArchiveBySid.set(sid, {
    turns: Number(info.turns) || 0,
    categories: Number(info.categories) || 0,
    fromTurn: Number(info.fromTurn) || 0,
    toTurn: Number(info.toTurn) || 0,
    at: new Date().toISOString(),
  })
}

function archiveState(sid) {
  return sid ? (palaceArchiveBySid.get(sid) || null) : null
}

const palaceWriteBySid = new Map()

function recordPalaceWrite(sid, info) {
  if (!sid) return
  const content = String(info.content || '')
  const cur = palaceWriteBySid.get(sid) || { count: 0, tokens: 0, items: [] }
  cur.count += 1
  cur.tokens += estimateTokens(content)
  cur.items.push({
    id: String(info.id || ''),
    section: String(info.section || ''),
    action: ['create', 'update', 'migration', 'delete', 'move'].includes(info.action) ? info.action : 'create',
    preview: content.replace(/\s+/g, ' ').trim().slice(0, 60),
  })
  palaceWriteBySid.set(sid, cur)
}

function writeStatsState(sid) {
  const cur = sid ? palaceWriteBySid.get(sid) : null
  return cur ? { count: cur.count, tokens: cur.tokens, items: cur.items.slice(-10) } : null
}

const sessionWriteChains = new Map()

function withSessionWriteLock(sid, fn) {
  const key = String(sid || '')
  if (!key) return Promise.resolve().then(fn)
  const prev = sessionWriteChains.get(key) || Promise.resolve()
  const run = prev.then(fn, fn)
  sessionWriteChains.set(key, run.catch(() => {}))
  return run
}

function recordPalaceQuery(sid, info) {
  if (!sid) return
  const turns = Number(info.turns) || 0
  const tokens = Number(info.tokens) || 0
  if (turns <= 0 && tokens <= 0) return
  const cur = palaceQueryBySid.get(sid) || { months: new Set(), categories: new Set(), files: new Set(), turns: 0, tokens: 0 }
  for (const m of info.months || []) if (m) cur.months.add(String(m))
  for (const c of info.categories || []) if (c) cur.categories.add(String(c))
  for (const f of info.files || []) if (f) cur.files.add(String(f))
  cur.turns += turns
  cur.tokens += tokens
  palaceQueryBySid.set(sid, cur)
}

function retrievalState(sid) {
  const cur = sid ? palaceQueryBySid.get(sid) : null
  if (!cur) return null
  return {
    months: [...cur.months],
    categories: [...cur.categories],
    files: [...cur.files].slice(0, 5),
    turns: cur.turns,
    tokens: cur.tokens,
  }
}

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
    // 压缩后是硬步骤：不受 recallStrength / enableSteer 影响，必须调用摘要工具。
    if (pendingFullAfterCompaction.has(sid)) {
      pendingFullAfterCompaction.delete(sid)
      const notice = pickCompactionNotice(cfg)
      recordEvent('recall-after-compaction', `…${sid.slice(-6)} ${notice ? notice.months.join(' / ') : '无摘要'}`)
      if (!notice) return ''
      const calls = notice.months.map((m) => `palace_summary(month="${m}")`).join(' 和 ')
      return '【记忆回廊 · 压缩后硬步骤】必须先调用 ' + calls + ' 读取近期归档摘要，再继续回答；不得跳过。只读摘要，不读原文；用户明确要原文时再读。'
    }
    const strength = ['off', 'low', 'medium', 'high', 'forced'].includes(cfg.recallStrength) ? cfg.recallStrength : 'low'
    if (strength === 'off') return ''
    if (cfg.enableSteer === false) return ''
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
    lastUserCueBySid.delete(String(sid))
    recordEvent('recall-steer-skip', `turn ${turn}（本轮是对上一条 steer 的回应）`)
    return
  }
  // 本轮用户消息本身就是插件注入（不是真人输入）：绝不再触发新一轮检索，否则“指令搜指令”。
  if (lastUserSourceBySid.get(sid) === 'dsh-memory-palace') {
    lastUserCueBySid.delete(String(sid))
    recordEvent('recall-steer-skip', `turn ${turn}（本轮用户消息来自插件注入）`)
    return
  }
  const lastAt = Number(lastSteerSentAt.get(sid)) || 0
  if (Date.now() - lastAt < STEER_COOLDOWN_MS) {
    lastUserCueBySid.delete(String(sid))
    recordEvent('recall-steer-skip', `turn ${turn}（冷却中，距上次 steer ${Math.round((Date.now() - lastAt) / 1000)}s）`)
    return
  }
  // 模型本轮已经主动查过归档，就不要再发 steer 让下一轮重复查。
  if (retrievalState(sid)) {
    lastUserCueBySid.delete(String(sid))
    recordEvent('recall-steer-skip', `turn ${turn}（本轮已检索过，不重复催）`)
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
  if (strength !== 'forced') {
    const cues = lastUserCueBySid.get(sid) || []
    if (!cues.length) return
    lastUserCueBySid.delete(sid)
    if (strength === 'low') {
      steer(`【系统指令 · 记忆回忆】用户提到旧事线索（${cues.join('/')}）。先调用 palace_summary 读最近归档摘要；摘要不够再 palace_search，不要凭印象。`)
    } else if (strength === 'high') {
      steer(`【系统指令 · 记忆回忆】用户提到旧事线索（${cues.join('/')}）。先 palace_summary，再 palace_search 查原文；允许递归多轮，预算最多 ${depth} 轮、每轮 ${width} 个关键词（建议）。不要凭印象。`)
    } else {
      steer(`【系统指令 · 记忆回忆】用户提到旧事线索（${cues.join('/')}）。先 palace_summary，再用 palace_search 查原文；不要凭印象。`)
    }
    return
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
    try { maybeElectFamily(agent, cfg, sid0) } catch (err) { recordEvent('family-election-error', String(err?.message ?? err)) }
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
    // 高压力快路径：不在这里全量解压日志（实测 10–15 秒），直接提示模型用 palace_turns 取范围后归档。
    // 真正归档时 palace_turns/palace_archive 才解码一次，检测本身保持秒级。
    if (fast && fast.pressure >= threshold) {
      const st = readState(cwd, cfg.rootDirName, sid0)
      const archivedThrough = Number(st[sid0]?.archivedThroughTurn) || 0
      const archivedMax = (Array.isArray(st[sid0]?.archivedRanges) ? st[sid0].archivedRanges : [])
        .reduce((max, r) => Math.max(max, Number(r?.[1]) || 0), archivedThrough)
      st[sid0] = {
        ...(st[sid0] ?? {}),
        lastCheckTurn: turn,
        lastCheckAt: fmtTime(Date.now()),
        lastPressure: Number(fast.pressure.toFixed(3)),
        lastPressureSource: fast.source,
      }
      try { writeState(cwd, cfg.rootDirName, st, sid0) } catch { /* ignore */ }
      if (!gate.steer) { recordEvent('steer-off', `injectNotice=${cfg.injectNotice} enableSteer=${cfg.enableSteer}`); return }
      const lastSteer = Number(st[sid0]?.lastSteerTurn ?? -99999)
      if (turn - lastSteer < Math.max(10, every * 2)) return
      const text =
        `【系统指令 · 记忆回廊】会话上下文占用 ${(Math.min(fast.pressure, 9.99) * 100).toFixed(1)}%（窗口 ${cfg.contextWindowTokens} tokens），已超过阈值 ${(threshold * 100).toFixed(0)}%。`
        + `先调用 palace_turns(fromTurn=${archivedMax + 1}) 确认可归档轮次与保留边界，再用 palace_archive 的 segments=[{category, fromTurn, toTurn}, …] 归档；不要凭印象估 turn。`
        + `这是内部归档动作，完成后不要写正文、不要复述归档结果，直接结束本轮；详细结果由底部显示。`
      try {
        const message = assertUserMessage({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: `[记忆回廊·系统注入] ${text}` }],
          source: { kind: 'dsh-memory-palace' },
        })
        agent.steer(message)
        awaitingSteerReply.add(sid0)
        lastSteerSentAt.set(sid0, Date.now())
        st[sid0] = { ...(st[sid0] ?? {}), lastSteerTurn: turn, updatedAt: fmtTime(Date.now()) }
        writeState(cwd, cfg.rootDirName, st, sid0)
      } catch (err) {
        safeLog(ctx, 'steer skipped: ' + (err?.message ?? String(err)))
      }
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
      + `不要解释、不要复述原文、不要问我，直接调用。这是内部归档动作，完成后不要写正文、不要复述归档结果，直接结束本轮；详细结果由底部显示。`
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

/** 仅用于本地测试；不改变运行时行为。 */
export const __test = {
  coreDirFor,
  parseCoreEntry,
  readCoreEntries,
  writeCoreEntry,
  removeCoreEntry,
  moveCoreEntry,
  coreReadText,
  coreInjectionText,
  coreDebugInfo,
  markCorePending,
  coreInjectState,
  bumpCoreTier,
  activeCoreTiers,
  resetCoreTiers,
  chooseForkName,
  ensureForkSession,
  autoCaptureHighConfidence,
}
