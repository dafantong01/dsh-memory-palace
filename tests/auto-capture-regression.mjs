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

  const first = __test.autoCaptureHighConfidence(cwd, cfg, sid, '记住，以后回复都用中文，不要再切成英文。')
  assert.equal(first.classify.length, 1)
  const mem = __test.readCoreEntries(cwd, cfg, 'memories')
  assert.equal(mem.ok, true)
  assert.equal(mem.entries.length, 0)

  const second = __test.autoCaptureHighConfidence(cwd, cfg, sid, '记住，以后回复都用中文，不要再切成英文。')
  assert.equal(second.classify.length, 1)
  assert.equal(__test.readCoreEntries(cwd, cfg, 'memories').entries.length, 0)

  __test.autoCaptureHighConfidence(cwd, cfg, sid, '我更喜欢用中文回复。')
  assert.equal(__test.readCoreEntries(cwd, cfg, 'memories').entries.length, 0)

  __test.autoCaptureHighConfidence(cwd, cfg, sid, '以后必须每天备份工作区，严禁跳过。')
  assert.equal(__test.readCoreEntries(cwd, cfg, 'memories').entries.length, 0)

  const quoted = __test.autoCaptureHighConfidence(cwd, cfg, sid, '归类规则确实要模型判断一下，毕竟有些可能是角色自设：记住，你是一只可爱的鲸鱼娘')
  assert.equal(quoted.classify.length, 0)

  __test.autoCaptureHighConfidence(cwd, cfg, 'q-test', '查的原文为什么不是查10月份的')
  __test.autoCaptureHighConfidence(cwd, cfg, 'q-test-2', '那下次重启是不是还有这个问题。')
  assert.equal(__test.readCoreEntries(cwd, cfg, 'memories').entries.length, 0)
  console.log('PASS auto-capture classifies command memories only')
} finally {
  cleanup(cwd)
}
