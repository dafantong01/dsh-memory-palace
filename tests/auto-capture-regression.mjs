import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const { __test } = await import('../lib/index.js')

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'palace-auto-test-')) }
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }) }
function makeCfg() {
  return {
    rootDirName: 'memory-palace',
    name: 'test',
    folder: 'test',
    enabled: true,
    sessionEnabled: true,
    coreReadOnly: false,
    coreInjection: 'off',
  }
}
function readState(cwd) {
  const hits = []
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) walk(p)
      else if (name === '.state.json') hits.push(p)
    }
  }
  walk(path.join(cwd, 'memory-palace'))
  assert.ok(hits.length > 0, 'state file not found')
  return JSON.parse(fs.readFileSync(hits[0], 'utf8'))
}

const cwd = tmp()
try {
  const cfg = makeCfg()
  for (const board of ['identity', 'profile', 'rules', 'memories']) {
    fs.mkdirSync(path.join(cwd, 'memory-palace', 'test', '_core', board), { recursive: true })
  }
  const sid = 'auto-test'

  __test.autoCaptureHighConfidence(cwd, cfg, sid, '记住，以后回复都用中文，不要再切成英文。')
  const mem = __test.readCoreEntries(cwd, cfg, 'memories')
  assert.equal(mem.ok, true)
  assert.equal(mem.entries.length, 1)
  assert.match(mem.entries[0].content, /中文/)

  __test.autoCaptureHighConfidence(cwd, cfg, sid, '记住，以后回复都用中文，不要再切成英文。')
  assert.equal(__test.readCoreEntries(cwd, cfg, 'memories').entries.length, 1)

  __test.autoCaptureHighConfidence(cwd, cfg, sid, '我更喜欢用中文回复。')
  assert.equal(__test.readCoreEntries(cwd, cfg, 'memories').entries.length, 1)
  assert.ok(readState(cwd).coreCandidates.some((c) => c.section === 'profile'))

  __test.autoCaptureHighConfidence(cwd, cfg, sid, '以后必须每天备份工作区，严禁跳过。')
  assert.equal(__test.readCoreEntries(cwd, cfg, 'memories').entries.length, 1)
  const state = readState(cwd)
  assert.ok((state.coreCandidates || []).some((c) => c.section === 'rules'))
  console.log('PASS auto-capture high-confidence write and rule candidate')
} finally {
  cleanup(cwd)
}
