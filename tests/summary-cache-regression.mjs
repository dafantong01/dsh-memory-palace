import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { __test as core } from '../lib/index.js'
import * as family from '../lib/family.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'palace-summary-cache-'))
const base = path.join(root, 'memory-palace')
fs.mkdirSync(base, { recursive: true })
fs.writeFileSync(path.join(base, '.namespaces.json'), JSON.stringify({ root: 'Root', child: 'Child' }), 'utf8')

function makeNamespace(folder, label) {
  const dir = path.join(base, folder)
  fs.mkdirSync(path.join(dir, '2026-10'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    name: folder,
    enabled: true,
    summaryFallback: 'own-then-family',
  }), 'utf8')
  fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify({
    file: `2026-10/${label}/x.md`,
    category: label,
    fromTurn: 1,
    toTurn: 2,
    archivedAt: '2026-10-01',
  }) + '\n', 'utf8')
  fs.writeFileSync(path.join(dir, '2026-10', '_summary.md'),
    `## 归档 2026-10-01 · [${label}] turn 1–2\n${label} 专用词。\n`, 'utf8')
  return dir
}

const rootDir = makeNamespace('Root', 'rootonly')
const childDir = makeNamespace('Child', 'childonly')

try {
  const hit = core.scanSummaryKeyword([{ folder: 'Child', dir: childDir }], 'childonly', 8)
  assert.equal(hit.hits.length, 1)
  assert.equal(hit.hits[0].month, '2026-10')
  assert.equal(hit.hits[0].category, 'childonly')

  const miss = core.scanSummaryKeyword([{ folder: 'Child', dir: childDir }], 'rootonly', 8)
  assert.equal(miss.hits.length, 0)
  assert.equal(core.candidateSummaryText([{ folder: 'Child', dir: childDir }], 3).length, 1)

  const extra = []
  for (const [i, name] of ['Extra1', 'Extra2'].entries()) {
    const dir = path.join(base, name)
    fs.mkdirSync(path.join(dir, '2026-10'), { recursive: true })
    fs.writeFileSync(path.join(dir, '2026-10', '_summary.md'),
      `## 归档 2026-10-0${i + 1} · [${name.toLowerCase()}] turn 1–2\n${name} 摘要。\n`, 'utf8')
    extra.push({ folder: name, dir })
  }
  const page0 = core.candidateSummaryPage([{ folder: 'Child', dir: childDir }], [
    { folder: 'Root', dir: rootDir }, ...extra,
  ], 0, 3)
  assert.equal(page0.blocks.length, 3)
  assert.equal(page0.nextOffset, 3)
  const page1 = core.candidateSummaryPage([{ folder: 'Child', dir: childDir }], [
    { folder: 'Root', dir: rootDir }, ...extra,
  ], 3, 3)
  assert.equal(page1.blocks.length, 1)
  assert.equal(page1.nextOffset, null)

  const many = []
  for (let i = 0; i < 13; i++) {
    const dir = path.join(base, `Many${i}`)
    fs.mkdirSync(path.join(dir, '2026-10'), { recursive: true })
    fs.writeFileSync(path.join(dir, '2026-10', '_summary.md'),
      `## 归档 2026-10-01 · [many] turn 1–2\nMany${i} 摘要。\n`, 'utf8')
    many.push({ folder: `Many${i}`, dir })
  }
  const capped = core.candidateSummaryPage([], many, 0, 3, 12)
  assert.equal(capped.total, 13)
  assert.equal(capped.floor, 13)
  assert.equal(capped.cap, 13)
  assert.equal(capped.nextOffset, 3)
  const beyondCap = core.candidateSummaryPage([], many, 13, 3, 12)
  assert.equal(beyondCap.blocks.length, 0)
  assert.equal(beyondCap.cap, 13)
  const uncapped = core.candidateSummaryPage([], many, 0, 3)
  assert.equal(uncapped.cap, 13)

  const secDir = path.join(base, 'SectionTest')
  fs.mkdirSync(path.join(secDir, '2026-11'), { recursive: true })
  fs.writeFileSync(path.join(secDir, '2026-11', '_summary.md'),
    '## 归档 2026-11-01 · [alpha] turn 1–2\n缓存问题第一段。\n\n## 归档 2026-11-02 · [beta] turn 3–4\n缓存问题第二段。\n', 'utf8')
  const sectionPage = core.candidateSectionPage([{ folder: 'SectionTest', dir: secDir }], [], '缓存问题', 1, 6)
  assert.equal(sectionPage.blocks.length, 1)
  assert.match(sectionPage.blocks[0], /## 归档/)
  assert.match(sectionPage.blocks[0], /turn 3–4/)
  const sectionMiss = core.candidateSectionPage([{ folder: 'SectionTest', dir: secDir }], [], '完全不存在zzz', 1, 6)
  assert.equal(sectionMiss.total, 0)

  const orderOwn = path.join(base, 'OrderOwn')
  const orderFamA = path.join(base, 'OrderFamA')
  const orderFamB = path.join(base, 'OrderFamB')
  for (const [dir, label, months] of [
    [orderOwn, 'own', ['2026-01', '2026-02', '2026-03', '2026-04']],
    [orderFamA, 'famA', ['2026-03', '2026-04']],
    [orderFamB, 'famB', ['2026-03', '2026-04']],
  ]) {
    for (const month of months) {
      fs.mkdirSync(path.join(dir, month), { recursive: true })
      fs.writeFileSync(path.join(dir, month, '_summary.md'),
        `## 归档 ${month}-01 · [${label}] turn 1–2\n${label} ${month} 摘要。\n`, 'utf8')
    }
  }
  const orderPage0 = core.candidateSummaryPage([{ folder: 'OrderOwn', dir: orderOwn }], [
    { folder: 'OrderFamA', dir: orderFamA }, { folder: 'OrderFamB', dir: orderFamB },
  ], 0, 3, 12)
  assert.match(orderPage0.blocks[0], /OrderOwn · 2026-04/)
  assert.match(orderPage0.blocks[1], /OrderOwn · 2026-03/)
  assert.match(orderPage0.blocks[2], /OrderOwn · 2026-02/)
  const orderPage1 = core.candidateSummaryPage([{ folder: 'OrderOwn', dir: orderOwn }], [
    { folder: 'OrderFamA', dir: orderFamA }, { folder: 'OrderFamB', dir: orderFamB },
  ], 3, 3, 12)
  assert.match(orderPage1.blocks[0], /OrderFamA · 2026-04/)
  assert.match(orderPage1.blocks[1], /OrderFamB · 2026-04/)
  assert.match(orderPage1.blocks[2], /OrderOwn · 2026-01/)

  let def = null
  const ctx = { tools: { register: (d) => { def = d; return d } } }
  core.registerSummaryTool(ctx, (k) => k === 'rootDirName' ? 'memory-palace' : undefined)
  assert.ok(def)
  const agent = { session: { header: { id: 'child', cwd: root } } }

  const own = await def.execute({ keyword: 'childonly' }, { agent })
  assert.match(own, /2026-10/)
  assert.match(own, /childonly/)

  const full = await def.execute({ keyword: 'nothing-here', fallback: 'full-search' }, { agent })
  assert.match(full, /palace_search/)

  const ask = await def.execute({ keyword: 'nothing-here', fallback: 'ask-user' }, { agent })
  assert.match(ask, /询问用户/)

  const rootAssign = family.assignRoot(root, { sessionId: 'root', folder: 'Root', name: 'Root' })
  const childJoin = family.joinFamily(root, { rootSessionId: 'root', sessionId: 'child', folder: 'Child', name: 'Child' })
  assert.equal(rootAssign.ok, true)
  assert.equal(childJoin.ok, true)
  const familyHit = await def.execute({ keyword: 'rootonly' }, { agent })
  assert.match(familyHit, /rootonly/)

  const familyCandidate = await def.execute({ keyword: 'nothing-here' }, { agent })
  assert.match(familyCandidate, /【Root/)
  assert.match(familyCandidate, /【Child/)
  const repeated = await def.execute({ keyword: 'nothing-here' }, { agent })
  assert.match(repeated, /已经翻过/)
  assert.match(repeated, /上次到第 2 个月/)

  const askAfterFamily = await def.execute({ keyword: 'ask-after-family-test', fallback: 'own-then-family-ask' }, { agent })
  assert.match(askAfterFamily, /ask_user_question/)
  assert.match(askAfterFamily, /全量原文搜索/)

  const ownOnly = await def.execute({ keyword: 'rootonly', fallback: 'own-only' }, { agent })
  assert.match(ownOnly, /childonly/)
  assert.doesNotMatch(ownOnly, /【Root/)
  assert.doesNotMatch(ownOnly, /rootonly 专用词/)

  family.dissolveFamily(root, 'root')
  const noFamily = await def.execute({ keyword: 'nothing-here-no-family' }, { agent: { session: { header: { id: 'child', cwd: root } } } })
  assert.match(noFamily, /候选摘要/)

  family.assignRoot(root, { sessionId: 'root', folder: 'Root', name: 'Root' })
  const soloFamily = await def.execute({ keyword: 'nothing-here-solo-family' }, { agent: { session: { header: { id: 'root', cwd: root } } } })
  assert.match(soloFamily, /候选摘要/)

  const turns = [1, 2, 3, 4, 5, 6].map((turn) => ({ turn, injected: false, items: [] }))
  const plan = core.planManualArchive(turns, {
    compactAfterArchive: true,
    archiveTailTurns: 2,
    retainFraction: 0.12,
    retainBytes: 100000,
  }, {}, 'sid', 1000000)
  assert.equal(plan.fullArchive, true)
  assert.deepEqual(plan.eligible.map((t) => t.turn), [1, 2, 3, 4])
  assert.equal(plan.cutoff, 4)

  const oldPlan = core.planManualArchive(turns, {
    compactAfterArchive: false,
    archiveTailTurns: 2,
    retainFraction: 0.12,
    retainBytes: 100000,
  }, {}, 'sid', 1000000)
  assert.equal(oldPlan.fullArchive, false)

  assert.equal(core.archiveBoundaryFor({
    args: { manual: true },
    cfg: { compactAfterArchive: true, archiveTailTurns: 2 },
    logLastTurn: 100,
    safeLast: 99,
    rawBoundary: 80,
  }), 98)
  assert.equal(core.archiveBoundaryFor({
    args: { manual: false },
    cfg: { compactAfterArchive: true, archiveTailTurns: 2 },
    logLastTurn: 100,
    safeLast: 99,
    rawBoundary: 80,
  }), 80)
  assert.equal(core.archiveBoundaryFor({
    args: { manual: true },
    cfg: { compactAfterArchive: false, archiveTailTurns: 2 },
    logLastTurn: 100,
    safeLast: 99,
    rawBoundary: 80,
  }), 80)

  const paths = {
    dir: path.join(root, 'cache'),
    chunks: path.join(root, 'cache', 'chunks'),
    manifest: path.join(root, 'cache', 'manifest.json'),
    events: path.join(root, 'cache', 'events.jsonl.gz'),
    meta: path.join(root, 'cache', 'meta.json'),
  }
  fs.mkdirSync(paths.chunks, { recursive: true })
  for (const name of ['chunk-000001.jsonl.gz', 'chunk-000002.jsonl.gz', 'chunk-000003.jsonl.gz']) {
    fs.writeFileSync(path.join(paths.chunks, name), 'old', 'utf8')
  }
  const manifest = core.writeChunks(paths, [{ type: 'x' }], { logPath: 'log', logSize: 1, mtimeMs: 1 })
  assert.equal(manifest.chunks.length, 1)
  const leftChunks = fs.readdirSync(paths.chunks)
  assert.equal(leftChunks.length, 1)
  assert.match(leftChunks[0], /^chunk-000001-[0-9a-f]{8}\.jsonl\.gz$/)

  console.log('SUMMARY summary-cache 9/9')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
