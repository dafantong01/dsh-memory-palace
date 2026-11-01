import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const family = await import('../lib/family.js')
const docs = await import('../lib/docs.js')

const results = []
let current = ''
function test(name, fn) {
  current = name
  try {
    fn()
    results.push(['PASS', name])
  } catch (err) {
    results.push(['FAIL', name, String(err?.message ?? err)])
  }
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'palace-family-test-'))
}
function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}
function writeRootConfig(cwd, folder) {
  const dir = path.join(cwd, 'memory-palace', folder)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), '{}')
}
function readMeta(cwd, folder) {
  return JSON.parse(fs.readFileSync(path.join(cwd, 'memory-palace', folder, 'meta.json'), 'utf8'))
}
function readFamilies(cwd) {
  return JSON.parse(fs.readFileSync(path.join(cwd, 'memory-palace', 'families.json'), 'utf8'))
}
function setupFamily(cwd) {
  family.assignRoot(cwd, { sessionId: 'R', folder: 'Root', name: 'Root' })
  family.joinFamily(cwd, { rootSessionId: 'R', sessionId: 'C', folder: 'Child', name: 'Child' })
}

test('assign root writes meta', () => {
  const cwd = tmp()
  try {
    family.assignRoot(cwd, { sessionId: 'R', folder: 'Root', name: 'Root' })
    assert.equal(readMeta(cwd, 'Root').role, 'root')
    assert.equal(readMeta(cwd, 'Root').familyId, 'R')
  } finally { cleanup(cwd) }
})

test('root without config is orphaned, restored config is active', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    assert.equal(family.familyStatus(cwd, 'R').membership.family.status, 'orphaned')
    writeRootConfig(cwd, 'Root')
    assert.equal(family.familyStatus(cwd, 'R').membership.family.status, 'active')
  } finally { cleanup(cwd) }
})

test('empty unreadable family is cleaned to independent', () => {
  const cwd = tmp()
  try {
    family.assignRoot(cwd, { sessionId: 'R', folder: 'Root', name: 'Root' })
    assert.equal(family.familyStatus(cwd, 'R').membership, null)
    assert.equal(Object.keys(readFamilies(cwd).families).length, 0)
  } finally { cleanup(cwd) }
})

test('join child writes child meta', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    assert.equal(readMeta(cwd, 'Child').role, 'child')
    assert.equal(readMeta(cwd, 'Child').familyId, 'R')
  } finally { cleanup(cwd) }
})

test('detach child returns it to independent', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    family.detachFamily(cwd, 'C')
    assert.equal(readMeta(cwd, 'Child').role, 'independent')
    assert.equal(readMeta(cwd, 'Child').familyId, '')
  } finally { cleanup(cwd) }
})

test('abdicate + elect rekeys registry, meta and journal', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    writeRootConfig(cwd, 'Root')
    writeRootConfig(cwd, 'Child')
    family.abdicateRoot(cwd, 'R')
    const r = family.electRoot(cwd, { familyId: 'R', newRootSessionId: 'C', newRootFolder: 'Child', newRootName: 'Child' })
    assert.equal(r.ok, true)
    assert.equal(family.familyStatus(cwd, 'C').membership.role, 'root')
    assert.equal(readMeta(cwd, 'Child').role, 'root')
    assert.equal(readMeta(cwd, 'Root').role, 'independent')
    assert.equal(readMeta(cwd, 'Root').archivedReadOnly, true)
    assert.equal(readFamilies(cwd).families.C.rootSessionId, 'C')
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'memory-palace', '.family-journal.json'), 'utf8')).action, 'elect-ok')
  } finally { cleanup(cwd) }
})

test('election rolls back when meta write fails', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    writeRootConfig(cwd, 'Root')
    writeRootConfig(cwd, 'Child')
    family.abdicateRoot(cwd, 'R')
    const metaPath = path.join(cwd, 'memory-palace', 'Child', 'meta.json')
    fs.rmSync(metaPath, { force: true })
    fs.mkdirSync(metaPath)
    const r = family.electRoot(cwd, { familyId: 'R', newRootSessionId: 'C', newRootFolder: 'Child', newRootName: 'Child' })
    assert.equal(r.ok, false)
    assert.equal(readFamilies(cwd).families.R.rootSessionId, 'R')
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'memory-palace', '.family-journal.json'), 'utf8')).action, 'elect-rollback')
  } finally { cleanup(cwd) }
})

test('dissolve removes family and marks all members independent', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    family.dissolveFamily(cwd, 'R')
    assert.equal(Object.keys(readFamilies(cwd).families).length, 0)
    assert.equal(readMeta(cwd, 'Root').role, 'independent')
    assert.equal(readMeta(cwd, 'Child').role, 'independent')
    assert.equal(readMeta(cwd, 'Child').sessionId, 'C')
  } finally { cleanup(cwd) }
})

test('journal recovery completes a migrating election', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    writeRootConfig(cwd, 'Root')
    writeRootConfig(cwd, 'Child')
    family.abdicateRoot(cwd, 'R')
    const before = readFamilies(cwd)
    const old = before.families.R
    const moved = { ...old, familyId: 'C', rootSessionId: 'C', rootFolder: 'Child', displayName: 'Child', members: [], status: 'migrating', formerRootSessionId: 'R', formerRootFolder: 'Root' }
    fs.writeFileSync(path.join(cwd, 'memory-palace', 'families.json'), JSON.stringify({ version: 1, families: { C: moved } }))
    fs.writeFileSync(path.join(cwd, 'memory-palace', '.family-journal.json'), JSON.stringify({
      at: new Date().toISOString(), action: 'elect', familyId: 'R', newRootSessionId: 'C',
      oldRootSessionId: 'R', oldRootFolder: 'Root', newRootFolder: 'Child', familiesBefore: before, metas: [],
    }))
    const status = family.familyStatus(cwd, 'C')
    assert.equal(status.membership.family.status, 'active')
    assert.equal(status.membership.family.rootSessionId, 'C')
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'memory-palace', '.family-journal.json'), 'utf8')).action, 'elect-recovered')
  } finally { cleanup(cwd) }
})

test('journal recovery rolls back an uncommitted election', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    writeRootConfig(cwd, 'Root')
    writeRootConfig(cwd, 'Child')
    const before = readFamilies(cwd)
    fs.writeFileSync(path.join(cwd, 'memory-palace', '.family-journal.json'), JSON.stringify({
      at: new Date().toISOString(), action: 'elect', newRootSessionId: 'C',
      oldRootSessionId: 'R', oldRootFolder: 'Root', newRootFolder: 'Child', familiesBefore: before, metas: [],
    }))
    const status = family.familyStatus(cwd, 'R')
    assert.equal(status.membership.role, 'root')
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'memory-palace', '.family-journal.json'), 'utf8')).action, 'elect-rollback-recovered')
  } finally { cleanup(cwd) }
})

test('family file lock is exclusive and released', () => {
  const cwd = tmp()
  try {
    const inner = family.withFamilyFileLock(cwd, 'family-test', () => family.withFamilyFileLock(cwd, 'family-test', () => 'inner'))
    assert.equal(inner.busy, true)
    const after = family.withFamilyFileLock(cwd, 'family-test', () => 'ok')
    assert.equal(after, 'ok')
  } finally { cleanup(cwd) }
})

test('rebuild pending can be resolved yes/no', () => {
  const cwd = tmp()
  try {
    setupFamily(cwd)
    writeRootConfig(cwd, 'Child')
    family.abdicateRoot(cwd, 'R')
    family.electRoot(cwd, { familyId: 'R', newRootSessionId: 'C', newRootFolder: 'Child', newRootName: 'Child' })
    family.markFamilyRebuild(cwd, 'C', 'old-root-core-missing')
    assert.equal(family.familyStatus(cwd, 'C').membership.family.rebuildPending, true)
    family.resolveFamilyRebuild(cwd, 'C', 'yes')
    assert.equal(family.familyStatus(cwd, 'C').membership.family.rebuildPending, false)
  } finally { cleanup(cwd) }
})

test('invalid family operation writes families.invalid.json', () => {
  const cwd = tmp()
  try {
    family.detachFamily(cwd, 'missing')
    const list = JSON.parse(fs.readFileSync(path.join(cwd, 'memory-palace', 'families.invalid.json'), 'utf8'))
    assert.equal(Array.isArray(list), true)
    assert.equal(list.at(-1).action, 'detach')
  } finally { cleanup(cwd) }
})

test('explicit root transfer rekeys family and locks old root', () => {
  const cwd = tmp()
  try {
    family.assignRoot(cwd, { sessionId: 'R', folder: 'Root', name: 'Root' })
    writeRootConfig(cwd, 'Root')
    family.joinFamily(cwd, { rootSessionId: 'R', sessionId: 'C', folder: 'Child', name: 'Child' })
    const bad = family.transferRoot(cwd, { familyId: 'R', fromSessionId: 'C', newRootSessionId: 'R', newRootName: 'Root' })
    assert.equal(bad.ok, false)
    const r = family.transferRoot(cwd, { familyId: 'R', fromSessionId: 'R', newRootSessionId: 'C', newRootName: 'Child' })
    assert.equal(r.ok, true)
    const state = readFamilies(cwd)
    assert.equal(Boolean(state.families.C), true)
    assert.equal(state.families.C.rootSessionId, 'C')
    const oldMeta = readMeta(cwd, 'Root')
    assert.equal(oldMeta.role, 'independent')
    assert.equal(oldMeta.formerRoot, true)
    assert.equal(oldMeta.archivedReadOnly, true)
    assert.equal(readMeta(cwd, 'Child').role, 'root')
  } finally { cleanup(cwd) }
})

test('docs enabled persists and unarchived docs cannot be deleted', () => {
  const cwd = tmp()
  try {
    const created = docs.createDoc(cwd, 'xiaojiahuo', 'session-test', { title: '测试', body: 'x' })
    const disabled = docs.updateDoc(cwd, 'xiaojiahuo', 'session-test', created.id, { rev: created.doc.rev, enabled: false })
    assert.equal(disabled.doc.enabled, false)
    assert.equal(docs.readDoc(cwd, 'xiaojiahuo', created.id).doc.enabled, false)
    const rejected = docs.removeDoc(cwd, 'xiaojiahuo', 'session-test', created.id)
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'must-archive-before-delete')
    const archived = docs.updateDoc(cwd, 'xiaojiahuo', 'session-test', created.id, { rev: disabled.doc.rev, archived: true })
    assert.equal(archived.ok, true)
    assert.equal(docs.removeDoc(cwd, 'xiaojiahuo', 'session-test', created.id).ok, true)
  } finally { cleanup(cwd) }
})

const failed = results.filter(([status]) => status === 'FAIL')
for (const [status, name, detail] of results) {
  console.log(`${status} ${name}${detail ? ` :: ${detail}` : ''}`)
}
console.log(`SUMMARY ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
