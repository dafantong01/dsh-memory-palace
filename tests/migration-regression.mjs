import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const plugin = await import('../lib/index.js')
const docs = await import('../lib/docs.js')
const { __test } = plugin

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'palace-migration-test-'))
}

function cfgFor(name = 'Test') {
  return {
    name,
    folder: name,
    rootDirName: 'memory-palace',
    enabled: true,
    sessionEnabled: true,
    coreInjection: 'on',
    familyId: '',
    familyRole: 'independent',
    coreReadOnly: false,
  }
}

function writeEntry(file, { id, board, content, projectLabel = '' }) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const meta = {
    schemaVersion: 1,
    id,
    board,
    scope: 'own',
    familyId: '',
    projectLabel,
    tier: 'normal',
    created: '2026-01-01 00:00:00',
    updated: '2026-01-01 00:00:00',
    tags: [],
    source: 'user',
    rev: 1,
  }
  fs.writeFileSync(file, `---\n${JSON.stringify(meta)}\n---\n${content}\n`, 'utf8')
}

function writeDoc(cwd, sessionName) {
  const dir = path.join(cwd, 'memory-palace', sessionName, '_docs')
  fs.mkdirSync(dir, { recursive: true })
  const doc = {
    id: 'doc-old',
    title: 'Old doc',
    description: 'legacy',
    tags: [],
    projectLabel: 'legacy-project',
    enabled: true,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    rev: 1,
    archived: false,
    ownerSessionId: 'session-old',
  }
  fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(doc) + '\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'doc-old.md'), `${JSON.stringify(doc)}\nlegacy body\n`, 'utf8')
}

function makeFixture(board) {
  const cwd = tmp()
  const core = path.join(cwd, 'memory-palace', 'Test', '_core')
  writeEntry(path.join(core, board, 'e1.md'), { id: 'e1', board, content: 'legacy board entry' })
  writeEntry(path.join(core, 'projects', 'p1', board, 'p1e.md'), { id: 'p1e', board, content: 'legacy project entry', projectLabel: 'p1' })
  writeDoc(cwd, 'Test')
  return cwd
}

function checkVersion(version, board) {
  test(`${version} fixture migrates ${board} -> user and keeps docs`, () => {
    const cwd = makeFixture(board)
    try {
      const cfg = cfgFor()
      const coreDir = __test.coreDirFor(cwd, cfg)
      assert.ok(coreDir)
      assert.equal(fs.existsSync(path.join(coreDir, 'profile')), false)
      assert.equal(fs.existsSync(path.join(coreDir, 'user', 'e1.md')), true)
      assert.equal(fs.existsSync(path.join(coreDir, 'projects', 'p1', 'profile')), false)
      assert.equal(fs.existsSync(path.join(coreDir, 'projects', 'p1', 'user', 'p1e.md')), true)

      const entries = __test.readCoreEntries(cwd, cfg, 'user')
      assert.equal(entries.ok, true)
      assert.equal(entries.total, 2)
      assert.ok(entries.entries.some((e) => e.content === 'legacy board entry'))
      assert.ok(entries.entries.some((e) => e.content === 'legacy project entry'))

      const list = docs.listDocs(cwd, 'Test', {})
      assert.equal(list.ok, true)
      assert.equal(list.items[0].familyShared, false)
      const read = docs.readDoc(cwd, 'Test', 'doc-old')
      assert.equal(read.ok, true)
      assert.equal(read.body.trim(), 'legacy body')
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
}

checkVersion('0.3.5', 'profile')
checkVersion('0.3.6', 'profile')
checkVersion('0.3.7', 'user')

for (const [status, name, error] of results) {
  console.log(status, name, ...(error ? [`:: ${error}`] : []))
}
const failed = results.filter(([status]) => status === 'FAIL').length
console.log(`\nSUMMARY ${results.length - failed}/${results.length}`)
if (failed) process.exitCode = 1
