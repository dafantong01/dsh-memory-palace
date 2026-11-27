import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pageTrivia, listTrivia } from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-page-'))
const cfg = { dir: root }
const dir = path.join(root, 'trivia')
fs.mkdirSync(dir, { recursive: true })
const now = Date.now()
const rows = []
for (let i = 0; i < 120; i++) {
  rows.push({
    id: `trivia-page-${i}`,
    text: `第 ${i} 条：项目A 的备注 ${i % 3 === 0 ? '备份' : '会议'}`,
    tags: i % 2 ? ['项目A', '备份'] : ['项目A', '会议'],
    createdAt: new Date(now - i * 1000).toISOString(),
    updatedAt: new Date(now - i * 1000).toISOString(),
    lastAccessAt: '', hits: 0, pendingReview: i === 0, reviewDeadline: '',
    expiresAt: '2027-06-01T00:00:00.000Z', schema: 2,
  })
}
fs.writeFileSync(path.join(dir, 'index.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')

try {
  const p1 = pageTrivia(cfg, { limit: 50, offset: 0 })
  assert.equal(p1.total, 120)
  assert.equal(p1.items.length, 50)
  assert.equal(p1.items[0].pendingReview, true)
  const p2 = pageTrivia(cfg, { limit: 50, offset: 50 })
  assert.equal(p2.items.length, 50)
  const q = pageTrivia(cfg, { limit: 50, offset: 0, q: '备份' })
  assert.equal(q.total, 80)
  assert.ok(q.items.every((x) => x.text.includes('备份') || x.tags.includes('备份')))
  const fresh = pageTrivia(cfg, { limit: 50, offset: 0, filter: 'review' })
  assert.equal(fresh.total, 1)
  assert.ok(Array.isArray(pageTrivia(cfg, {}).tags))
  assert.equal(listTrivia(cfg).length, 120)
  console.log('SUMMARY trivia-page 8/8')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
