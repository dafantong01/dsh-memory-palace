/**
 * 关系图谱：tag 共现索引（不是知识图谱）。
 *
 * - 节点：热记忆条目 / 杂事条目 / 项目档案
 * - 边：共享 tag
 * - 每个 tag 最多 10 条关系；单会话最多 500 个 tag 进入图谱
 * - 按会话隔离，存 <命名空间>/_tag-graph/
 *
 * 查询不依赖 500 上限：条目/tag 查询由调用方扫描源数据；
 * 本模块负责构建、排序、零命中候选与图存储。
 */
import fs from 'node:fs'
import path from 'node:path'

export const MAX_LINKS_PER_TAG = 10
export const MAX_TAGS = 500
export const MAX_QUERY_ITEMS = 20
export const PREVIEW_CHARS = 30

const GRAPH_DIR = '_tag-graph'
const GRAPH_FILE = 'graph.json'
const STATE_FILE = 'state.json'
const ALIAS_FILE = 'alias-candidates.json'

export function graphDirFor(cfg) {
  return path.join(cfg.dir, GRAPH_DIR)
}

export function tagKey(tag) {
  return String(tag ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

const PREVIEW = (s) => String(s ?? '')
  .replace(/^[\s#*>\-]+/, '')
  .replace(/^【[^】]{0,60}】\s*/, '')
  .replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS)

/** 源集合指纹：条目增删或更新时间变化都会变，用于判断图是否过期。 */
export function fingerprintOf(sources) {
  const parts = (Array.isArray(sources) ? sources : [])
    .map((s) => `${s.type}:${s.id}:${s.updatedAt || s.createdAt || ''}`)
    .sort()
  let h = 2166136261
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return `${parts.length}:${(h >>> 0).toString(16)}`
}

/** 条目新鲜度权重：杂事按档位衰减；热记忆/档案按更新时间衰减但有 0.5 下限。 */
export function weightOf(source, now = Date.now()) {
  if (!source) return 0.5
  const t = Date.parse(source.updatedAt || source.createdAt || '')
  const days = Number.isFinite(t) ? (now - t) / (24 * 60 * 60 * 1000) : 999
  if (source.type !== 'trivia') {
    return Math.max(0.5, Math.min(1, 0.5 + 0.5 * Math.exp(-Math.max(0, days) / 90)))
  }
  if (days <= 7) return 1
  if (days <= 15) return 0.7
  if (days <= 30) return 0.4
  if (days <= 60) return 0.2
  return 0.1
}

function sourceNode(source, now) {
  return {
    type: String(source.type || ''),
    id: String(source.id || ''),
    scope: String(source.scope || 'self'),
    preview: PREVIEW(source.text || source.title || ''),
    weight: weightOf(source, now),
    lastSeen: String(source.updatedAt || source.createdAt || ''),
    tags: (source.tags || []).map((t) => String(t).trim()).filter(Boolean),
  }
}

function tagOverlap(a, b, excludeKey) {
  const sa = new Set((a.tags || []).map(tagKey).filter((k) => k && k !== excludeKey))
  const sb = new Set((b.tags || []).map(tagKey).filter((k) => k && k !== excludeKey))
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const k of sa) if (sb.has(k)) inter++
  return inter / (sa.size + sb.size - inter)
}

/** 内聚度：同 tag 下条目彼此还有多少共同 tag；越低越像泛词。 */
function cohesionOf(links, excludeKey) {
  if (links.length < 2) return 1
  let sum = 0
  let pairs = 0
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      sum += tagOverlap(links[i], links[j], excludeKey)
      pairs++
    }
  }
  return pairs ? sum / pairs : 0
}

/**
 * 从源条目构建图。
 * sources: [{ type:'core'|'trivia'|'doc', id, scope, title?, text?, tags[], createdAt?, updatedAt? }]
 */
export function buildGraph(sources, { now = Date.now() } = {}) {
  const groups = new Map() // key -> { names: Map(display -> count), links: [], ids: Set }
  for (const src of Array.isArray(sources) ? sources : []) {
    const node = sourceNode(src, now)
    if (!node.id || !node.type || !node.tags.length) continue
    for (const tag of node.tags) {
      const key = tagKey(tag)
      if (!key) continue
      if (!groups.has(key)) groups.set(key, { names: new Map(), links: [], ids: new Set() })
      const g = groups.get(key)
      g.names.set(tag, (g.names.get(tag) || 0) + 1)
      const nodeKey = `${node.type}:${node.id}`
      if (!g.ids.has(nodeKey)) {
        g.ids.add(nodeKey)
        g.links.push(node)
      }
    }
  }
  const tags = []
  for (const [key, g] of groups) {
    const display = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || key
    const links = g.links
      .sort((a, b) => (b.weight - a.weight) || (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0))
      .slice(0, MAX_LINKS_PER_TAG)
    const strength = links.reduce((sum, l) => sum + l.weight, 0)
    const cohesion = cohesionOf(links, key)
    const generic = links.length >= 8 && cohesion < 0.1
    const lastSeen = links.reduce((latest, l) => {
      const t = Date.parse(l.lastSeen || '') || 0
      return t > latest ? t : latest
    }, 0)
    const recencyDays = lastSeen ? Math.max(0, (now - lastSeen) / (24 * 60 * 60 * 1000)) : 999
    const tagRecency = 0.5 + 0.5 * Math.exp(-recencyDays / 30)
    const rank = (1 - Math.exp(-strength / 4)) * tagRecency * (generic ? 0.4 : 1)
    const effectiveRank = rank
    tags.push({
      key, name: display, rank: Number(rank.toFixed(3)),
      effectiveRank: Number(effectiveRank.toFixed(3)),
      cohesion: Number(cohesion.toFixed(3)), generic,
      count: links.length,
      lastSeen: lastSeen ? new Date(lastSeen).toISOString() : '',
      links,
    })
  }
  tags.sort((a, b) => b.effectiveRank - a.effectiveRank)
  return {
    version: 1,
    builtAt: new Date(now).toISOString(),
    fingerprint: fingerprintOf(sources),
    tags: tags.slice(0, MAX_TAGS),
  }
}

function linkInScope(link, scope) {
  if (scope === 'core') return link.type === 'core'
  if (scope === 'trivia') return link.type === 'trivia'
  if (scope === 'docs') return link.type === 'doc'
  return true
}

/**
 * 查询图：按 tag 或关键词。
 * 返回匹配 tag、条目（15 字预览）、下一层 tag；depth=2 时才扩第二跳。
 */
export function queryGraph(graph, { tag, keyword, scope = 'all', depth = 1, limit = MAX_QUERY_ITEMS } = {}) {
  const tags = Array.isArray(graph?.tags) ? graph.tags : []
  const key = tagKey(tag)
  const kw = tagKey(keyword)
  let matched = []
  if (key) matched = tags.filter((t) => t.key === key)
  else if (kw) {
    matched = tags.filter((t) => t.key.includes(kw) || t.links.some((l) => l.preview.toLowerCase().includes(kw)))
  }
  matched.sort((a, b) => b.effectiveRank - a.effectiveRank)
  const topTags = matched.slice(0, 5)
  const items = []
  const seen = new Set()
  const related = new Map()
  for (const t of topTags) {
    for (const link of t.links) {
      if (!linkInScope(link, scope)) continue
      const id = `${link.type}:${link.id}`
      if (seen.has(id)) continue
      seen.add(id)
      items.push({ ...link, viaTag: t.name, viaRank: t.rank, viaEffRank: t.effectiveRank, hop: 1 })
      for (const other of link.tags || []) {
        const k = tagKey(other)
        if (!k || k === t.key) continue
        related.set(other, (related.get(other) || 0) + 1)
      }
    }
  }
  if (depth >= 2) {
    const second = [...related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    for (const [name] of second) {
      const t = tags.find((x) => x.key === tagKey(name))
      if (!t || topTags.includes(t)) continue
      for (const link of t.links) {
        if (!linkInScope(link, scope)) continue
        const id = `${link.type}:${link.id}`
        if (seen.has(id) || items.length >= limit) continue
        seen.add(id)
        items.push({ ...link, viaTag: t.name, viaRank: t.rank, viaEffRank: t.effectiveRank, hop: 2 })
      }
    }
  }
  const relatedTags = [...related.entries()]
    .map(([name, count]) => {
      const t = tags.find((x) => x.key === tagKey(name))
      return t
        ? { name: t.name, rank: t.rank, effectiveRank: t.effectiveRank, cohesion: t.cohesion, generic: t.generic, count, lastSeen: t.lastSeen }
        : { name, rank: 0, effectiveRank: 0, cohesion: 0, generic: false, count, lastSeen: '' }
    })
    .sort((a, b) => b.effectiveRank - a.effectiveRank || b.count - a.count)
    .slice(0, 20)
  return {
    ok: true,
    tags: topTags.map((t) => ({
      name: t.name, rank: t.rank, effectiveRank: t.effectiveRank,
      cohesion: t.cohesion, generic: t.generic, count: t.count, lastSeen: t.lastSeen,
    })),
    items: items.slice(0, Math.max(1, Math.min(MAX_QUERY_ITEMS, Number(limit) || MAX_QUERY_ITEMS))),
    relatedTags,
  }
}

// ---------------------------------------------------------------- 别名影子

function normTagString(s) {
  return String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '')
}

function editDistance(a, b) {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/** 只收集疑似别名，不合并；供影子观察。 */
export function collectAliasCandidates(tags) {
  const list = Array.isArray(tags) ? tags.filter((t) => !t.generic && t.count >= 2) : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const aIds = new Set((a.links || []).map((l) => `${l.type}:${l.id}`))
      const bIds = new Set((b.links || []).map((l) => `${l.type}:${l.id}`))
      let inter = 0
      for (const id of aIds) if (bIds.has(id)) inter++
      const union = aIds.size + bIds.size - inter
      const jaccard = union ? inter / union : 0
      const na = normTagString(a.name)
      const nb = normTagString(b.name)
      const maxLen = Math.max(na.length, nb.length)
      const sim = maxLen ? 1 - editDistance(na, nb) / maxLen : 0
      if ((inter >= 2 && jaccard >= 0.5) || (maxLen <= 12 && sim >= 0.8 && Math.abs(na.length - nb.length) <= 1)) {
        out.push({
          a: a.name, b: b.name,
          evidence: inter >= 2 && jaccard >= 0.5 ? 'overlap' : 'string',
          intersection: inter, jaccard: Number(jaccard.toFixed(3)), similarity: Number(sim.toFixed(3)),
        })
      }
    }
  }
  return out
}

export function loadAliasCandidates(cfg) {
  try {
    const file = path.join(graphDirFor(cfg), ALIAS_FILE)
    if (!fs.existsSync(file)) return {}
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

export function mergeAliasCandidates(cfg, candidates) {
  const dir = graphDirFor(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const prev = loadAliasCandidates(cfg)
  const now = new Date().toISOString()
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const key = [tagKey(c.a), tagKey(c.b)].sort().join('|')
    const old = prev[key]
    prev[key] = {
      a: c.a, b: c.b, evidence: c.evidence,
      intersection: c.intersection, jaccard: c.jaccard, similarity: c.similarity,
      count: (Number(old?.count) || 0) + 1,
      firstAt: old?.firstAt || now,
      lastAt: now,
    }
  }
  const keys = Object.keys(prev)
  for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete prev[k]
  const file = path.join(dir, ALIAS_FILE)
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(prev, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return prev
}

// ---------------------------------------------------------------- 存储

export function loadGraph(cfg) {
  try {
    const file = path.join(graphDirFor(cfg), GRAPH_FILE)
    if (!fs.existsSync(file)) return null
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && Array.isArray(data.tags) ? data : null
  } catch {
    return null
  }
}

export function saveGraph(cfg, graph) {
  const dir = graphDirFor(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `${GRAPH_FILE}.tmp-${process.pid}`)
  fs.writeFileSync(tmp, JSON.stringify(graph, null, 2), 'utf8')
  fs.renameSync(tmp, path.join(dir, GRAPH_FILE))
  return graph
}

export function loadState(cfg) {
  try {
    const file = path.join(graphDirFor(cfg), STATE_FILE)
    if (!fs.existsSync(file)) return { day: '', dirty: true }
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { day: String(data?.day || ''), dirty: data?.dirty !== false }
  } catch {
    return { day: '', dirty: true }
  }
}

export function saveState(cfg, state) {
  const dir = graphDirFor(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `${STATE_FILE}.tmp-${process.pid}`)
  fs.writeFileSync(tmp, JSON.stringify({ day: String(state?.day || ''), dirty: state?.dirty === true }, null, 2), 'utf8')
  fs.renameSync(tmp, path.join(dir, STATE_FILE))
}
