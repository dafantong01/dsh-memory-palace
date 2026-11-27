import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ageTrivia, listTrivia } from '../lib/trivia.js'

const day = 24 * 60 * 60 * 1000
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-auto-review-'))
const cfg = { dir: root, triviaAutoReview: true }
const dir = path.join(root, 'trivia')
fs.mkdirSync(dir, { recursive: true })
const long = {
  id: 'trivia-long-auto',
  text: '最近还在读的长期杂事',
  tags: ['测试'],
  createdAt: new Date(Date.now() - 200 * day).toISOString(),
  updatedAt: new Date(Date.now() - 200 * day).toISOString(),
  lastAccessAt: new Date(Date.now() - 20 * day).toISOString(),
  hits: 8,
  pendingReview: false,
  reviewDeadline: '',
}
const stale = {
  ...long,
  id: 'trivia-long-stale',
  text: '很久没读的长期杂事',
  lastAccessAt: new Date(Date.now() - 100 * day).toISOString(),
}
fs.writeFileSync(path.join(dir, 'index.jsonl'), [long, stale].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')

try {
  const stats = ageTrivia(cfg)
  assert.equal(stats.autoKept, 1)
  assert.equal(stats.trashed, 1)
  assert.equal(stats.reviewed, 0)
  const items = listTrivia(cfg)
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'trivia-long-auto')
  assert.equal(items[0].pendingReview, false)
  assert.ok(items[0].extendedUntil)
  console.log('SUMMARY trivia-auto-review 7/7')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
