import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'

const mod = await import('../lib/index.js')
const { loadEventsWithCache } = mod.__test

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'palace-cache-test-'))
}
function append(log, events) {
  fs.appendFileSync(log, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
}
function readManifest(cwd, sid) {
  return JSON.parse(fs.readFileSync(path.join(cwd, '.memory-palace-cache', sid, 'manifest.json'), 'utf8'))
}
function events(n, base = 0) {
  return Array.from({ length: n }, (_, i) => ({ type: 'turn/start', data: { turn: base + i + 1 }, n: base + i }))
}

const sid = 'session-test'
const cwd = tmp()
const log = path.join(cwd, 'session.jsonl')
const results = []
async function run(name, fn) {
  try { await fn(); results.push(['PASS', name]) }
  catch (err) { results.push(['FAIL', name, String(err?.message ?? err)]) }
}

await run('chunks are created and appended', async () => {
  append(log, events(1200))
  let ev = await loadEventsWithCache(cwd, sid, log, fs.statSync(log), 10)
  assert.equal(ev.length, 1200)
  assert.equal(readManifest(cwd, sid).chunks.length, 1)
  append(log, events(5, 1200))
  ev = await loadEventsWithCache(cwd, sid, log, fs.statSync(log), 10)
  assert.equal(ev.length, 1205)
  assert.equal(readManifest(cwd, sid).chunks.length, 2)
  assert.equal(ev.at(-1).n, 1204)
})

await run('corrupt chunk rebuilds from log', async () => {
  const dir = path.join(cwd, '.memory-palace-cache', sid, 'chunks')
  const first = fs.readdirSync(dir).sort()[0]
  fs.writeFileSync(path.join(dir, first), 'broken')
  const ev = await loadEventsWithCache(cwd, sid, log, fs.statSync(log), 10)
  assert.equal(ev.length, 1205)
  assert.equal(ev.at(-1).n, 1204)
})

await run('legacy gzip is discarded and rebuilt as chunks', async () => {
  const cwd2 = tmp()
  const log2 = path.join(cwd2, 'session.jsonl')
  append(log2, events(12))
  const dir = path.join(cwd2, '.memory-palace-cache', 'session-legacy')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'events.jsonl.gz'), gzipSync(Buffer.from(events(12).map((e) => JSON.stringify(e)).join('\n') + '\n')))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ version: 1, logPath: log2, size: fs.statSync(log2).size }))
  const ev = await loadEventsWithCache(cwd2, 'session-legacy', log2, fs.statSync(log2), 10)
  assert.equal(ev.length, 12)
  assert.equal(fs.existsSync(path.join(dir, 'events.jsonl.gz')), false)
  assert.equal(readManifest(cwd2, 'session-legacy').chunks.length, 1)
})

await run('large append is checked by prefix and caught up', async () => {
  const cwd3 = tmp()
  const log3 = path.join(cwd3, 'session.jsonl')
  const big = (n, base = 0) => Array.from({ length: n }, (_, i) => ({
    type: 'turn/start', data: { turn: base + i + 1 }, n: base + i, pad: 'x'.repeat(5000),
  }))
  append(log3, big(100))
  await loadEventsWithCache(cwd3, 'session-big', log3, fs.statSync(log3), 20)
  append(log3, big(500, 100))
  const ev = await loadEventsWithCache(cwd3, 'session-big', log3, fs.statSync(log3), 20)
  assert.equal(ev.length, 600)
  assert.equal(ev.at(-1).n, 599)
  assert.ok(readManifest(cwd3, 'session-big').chunks.length >= 2)
})

for (const [status, name, detail] of results) console.log(`${status} ${name}${detail ? ` :: ${detail}` : ''}`)
const failed = results.filter(([s]) => s === 'FAIL')
console.log(`SUMMARY ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
