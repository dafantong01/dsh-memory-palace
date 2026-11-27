import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addTrivia, listTrivia, normalizeTriviaTags } from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-tag-merge-'))
const cfg = { dir: root, triviaInterest: 5 }
try {
  assert.equal(normalizeTriviaTags(['完']).ok, false)
  assert.equal(normalizeTriviaTags(['看完']).ok, true)
  const a = addTrivia(cfg, { text: '今天打架了', tags: ['打架'] }, { source: 'user' })
  assert.equal(a.ok, true)
  const b = addTrivia(cfg, { text: '今天又打群架了', tags: ['打群架'] }, { source: 'user' })
  assert.equal(b.ok, true)
  assert.deepEqual(b.item.tags, ['打群架'])

  const c = addTrivia(cfg, { text: '明天乘飞机', tags: ['乘飞机'] }, { source: 'user' })
  assert.equal(c.ok, true)
  assert.deepEqual(c.item.tags, ['乘飞机'])

  addTrivia(cfg, { text: 'fly high', tags: ['fly'] }, { source: 'user' })
  const e = addTrivia(cfg, { text: 'flying high', tags: ['flying'] }, { source: 'user' })
  assert.equal(e.ok, true)
  assert.deepEqual(e.item.tags, ['fly'])

  const tags = listTrivia(cfg).map((x) => x.tags[0])
  assert.ok(tags.includes('打架'))
  assert.ok(tags.includes('打群架'))
  assert.ok(tags.includes('乘飞机'))
  assert.ok(tags.includes('fly'))
  console.log('SUMMARY trivia-tag-merge 10/10')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
