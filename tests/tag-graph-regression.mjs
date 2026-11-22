import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildGraph, queryGraph, weightOf, saveGraph, loadGraph, saveState, loadState,
  fingerprintOf, collectAliasCandidates, MAX_LINKS_PER_TAG, MAX_TAGS,
} from '../lib/tag-graph.js'

const day = 24 * 60 * 60 * 1000
const now = Date.parse('2026-11-22T00:00:00Z')
const iso = (ms) => new Date(ms).toISOString()

const coreA = { type: 'core', id: 'a', scope: 'self', title: '小张坐 C929', tags: ['C929', '小张'], updatedAt: iso(now - day) }
const triviaB = { type: 'trivia', id: 'b', scope: 'self', text: '小明说和小张踢球', tags: ['小明', '小张', '踢球'], updatedAt: iso(now - 2 * day) }
const docC = { type: 'doc', id: 'c', scope: 'self', title: 'C929 体验', tags: ['C929'], updatedAt: iso(now - day) }
const oldTrivia = { type: 'trivia', id: 'd', scope: 'self', text: '很久以前的琐事', tags: ['C929'], updatedAt: iso(now - 40 * day) }

const g = buildGraph([coreA, triviaB, docC, oldTrivia], { now })
const c929 = g.tags.find((t) => t.key === 'c929')
assert.ok(c929)
assert.equal(c929.count, 3) // d 被 10 条上限保留，但 C929 只有 4 条，全在
assert.ok(c929.rank > 2)
assert.equal(weightOf(oldTrivia, now) < weightOf(triviaB, now), true)
assert.equal(g.fingerprint, fingerprintOf([coreA, triviaB, docC, oldTrivia]))
assert.notEqual(g.fingerprint, buildGraph([coreA, triviaB, docC], { now }).fingerprint)
assert.ok(c929.lastSeen)
console.log('PASS build')

const flat = Array.from({ length: 6 }, (_, i) => ({ type: 'trivia', id: `flat-${i}`, tags: ['泛', `专属${i}`] }))
const flatTag = buildGraph(flat, { now }).tags.find((t) => t.key === '泛')
assert.equal(flatTag.generic, true)
assert.ok(flatTag.effectiveRank < flatTag.rank)
assert.equal(typeof flatTag.cohesion, 'number')
console.log('PASS generic-demotion')

const aliasSources = [
  { type: 'trivia', id: 'a1', tags: ['小张', '张哥'] },
  { type: 'trivia', id: 'a2', tags: ['小张', '张哥'] },
  { type: 'trivia', id: 'b1', tags: ['C929'] },
  { type: 'trivia', id: 'b2', tags: ['C929'] },
  { type: 'trivia', id: 'c1', tags: ['c-929'] },
  { type: 'trivia', id: 'c2', tags: ['c-929'] },
]
const aliasGraph = buildGraph(aliasSources, { now })
const aliasCands = collectAliasCandidates(aliasGraph.tags)
assert.ok(aliasCands.some((c) => c.evidence === 'overlap'))
assert.ok(aliasCands.some((c) => c.evidence === 'string'))
console.log('PASS alias-candidates')

const pref = buildGraph([{ type: 'core', id: 'p1', text: '【事故教训·BOM】正文内容在这里', tags: ['BOM测试'] }], { now })
assert.equal(pref.tags[0].links[0].preview.startsWith('正文'), true)
console.log('PASS preview-clean')

const q = queryGraph(g, { tag: 'C929', scope: 'core' })
assert.equal(q.items.length, 1)
assert.equal(q.items[0].id, 'a')
assert.ok(q.relatedTags.some((t) => t.name === '小张'))
assert.ok(q.relatedTags.every((t) => typeof t.rank === 'number'))
assert.equal(q.items[0].viaRank, c929.rank)
const q2 = queryGraph(g, { keyword: 'c929' })
assert.ok(q2.items.length >= 3)
console.log('PASS query/scope')

const deep = queryGraph(g, { tag: '小张', depth: 2 })
assert.ok(deep.items.some((x) => x.hop === 1))
assert.ok(deep.items.some((x) => x.hop === 2))
const shallow = queryGraph(g, { tag: '小张', depth: 1 })
assert.ok(shallow.items.every((x) => x.hop === 1))
console.log('PASS depth')

const many = Array.from({ length: 15 }, (_, i) => ({ type: 'trivia', id: `t${i}`, tags: ['热点'], updatedAt: iso(now - i * day) }))
const capLinks = buildGraph(many, { now }).tags.find((t) => t.key === '热点')
assert.equal(capLinks.count, MAX_LINKS_PER_TAG)
const manyTags = Array.from({ length: 600 }, (_, i) => ({ type: 'core', id: `c${i}`, tags: [`tag-${i}`] }))
assert.equal(buildGraph(manyTags, { now }).tags.length, MAX_TAGS)
console.log('PASS caps')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-tag-'))
try {
  const cfg = { dir: path.join(root, 'ns') }
  assert.equal(loadGraph(cfg), null)
  saveGraph(cfg, g)
  assert.equal(loadGraph(cfg).tags.length, g.tags.length)
  saveState(cfg, { day: '2026-11-22', dirty: false })
  assert.deepEqual(loadState(cfg), { day: '2026-11-22', dirty: false })
  assert.equal(fs.readFileSync(path.join(cfg.dir, '_tag-graph', 'graph.json'), 'utf8').includes('"c929"'), true)
  console.log('PASS storage')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('SUMMARY tag-graph 5/5')
