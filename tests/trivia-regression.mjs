import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  addTrivia, listTrivia, readTrivia, updateTrivia, recordAccess,
  removeTrivia, ageTrivia, pendingReviewItems, validateTriviaText, normalizeTriviaTags, keepTrivia,
  invalidateTriviaCache,
} from '../lib/trivia.js'
import { expiryAt } from '../lib/trivia-age.js'

const day = 24 * 60 * 60 * 1000
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-trivia-'))
const cfg = { dir: path.join(root, 'ns'), triviaAutoReview: false }
const indexFile = () => path.join(cfg.dir, 'trivia', 'index.jsonl')
const trashDir = () => path.join(cfg.dir, 'trivia', '.triviatrash')
const writeIndex = (items) => {
  fs.mkdirSync(path.dirname(indexFile()), { recursive: true })
  fs.writeFileSync(indexFile(), items.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
  invalidateTriviaCache(cfg)
}

try {
  assert.equal(validateTriviaText('x'.repeat(51)).ok, false)
  assert.equal(validateTriviaText('  小张说 C929 的山葵酱好吃  ').ok, true)
  assert.equal(normalizeTriviaTags(['苹果', '苹果', '香蕉']).tags.length, 2)
  assert.equal(normalizeTriviaTags(['苹果']).ok, true)
  assert.equal(normalizeTriviaTags(['小张']).ok, true)
  assert.equal(normalizeTriviaTags(['骨折']).ok, true)
  assert.equal(normalizeTriviaTags(['康复']).ok, true)
  assert.equal(normalizeTriviaTags(['好吃']).ok, false)
  assert.equal(normalizeTriviaTags(['今天']).ok, false)
  assert.equal(normalizeTriviaTags(['偏好,环境']).ok, false)
  assert.equal(normalizeTriviaTags(['你好']).ok, false)
  assert.equal(normalizeTriviaTags(['好吗']).ok, false)
  assert.equal(normalizeTriviaTags(['知道了']).ok, false)
  assert.equal(normalizeTriviaTags(['好吃的']).ok, false)
  assert.equal(normalizeTriviaTags(['踢球了']).ok, true)
  assert.equal(normalizeTriviaTags(['骨折了']).ok, true)
  assert.equal(normalizeTriviaTags(['东西']).ok, false)
  assert.equal(addTrivia(cfg, { text: '无 tag 条目', tags: [] }).ok, false)
  assert.equal(normalizeTriviaTags(['alpha', 'beta', 'gamma', 'delta', 'epsilon']).ok, true)
  assert.equal(normalizeTriviaTags(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']).ok, false)
  assert.equal(normalizeTriviaTags(['x'.repeat(17)]).ok, false)
  console.log('PASS validate')

  const a = addTrivia(cfg, { text: '小张说 C929 的山葵酱好吃', tags: ['小张', 'C929'] })
  assert.equal(a.ok, true)
  assert.equal(readTrivia(cfg, a.item.id).text, '小张说 C929 的山葵酱好吃')
  assert.equal(listTrivia(cfg).length, 1)
  const upd = updateTrivia(cfg, a.item.id, { text: '小张说 C929 飞机餐好吃' })
  assert.equal(upd.ok, true)
  assert.equal(upd.item.createdAt, a.item.createdAt)
  console.log('PASS add/read/update')

  const before = readTrivia(cfg, a.item.id)
  recordAccess(cfg, a.item.id)
  const after = readTrivia(cfg, a.item.id)
  assert.equal(after.hits, before.hits + 1)
  assert.ok(after.lastAccessAt)
  assert.ok(Date.parse(after.expiresAt) >= Date.parse(before.expiresAt))
  assert.equal(after.updatedAt, before.updatedAt)
  console.log('PASS access')

  // 普通过期 -> trash
  const old = { id: 'trivia-old', text: '旧杂事', tags: [], createdAt: new Date(Date.now() - 61 * day).toISOString(), updatedAt: new Date(Date.now() - 61 * day).toISOString(), hits: 0, lastAccessAt: '', pendingReview: false, reviewDeadline: '' }
  // 长寿过期 -> review
  const long = { id: 'trivia-long', text: '常被看的杂事', tags: [], createdAt: new Date(Date.now() - 200 * day).toISOString(), updatedAt: new Date(Date.now() - 200 * day).toISOString(), hits: 8, lastAccessAt: new Date(Date.now() - 100 * day).toISOString(), pendingReview: false, reviewDeadline: '' }
  writeIndex([old, long])
  const st = ageTrivia(cfg)
  assert.equal(st.trashed, 1)
  assert.equal(st.reviewed, 1)
  assert.equal(listTrivia(cfg).find((x) => x.id === 'trivia-long')?.pendingReview, true)
  assert.ok(fs.existsSync(trashDir()) && fs.readdirSync(trashDir()).length >= 1)
  console.log('PASS age/review')

  // 复审超时 -> trash
  const pending = readTrivia(cfg, 'trivia-long')
  writeIndex([{ ...pending, reviewDeadline: new Date(Date.now() - day).toISOString() }])
  const st2 = ageTrivia(cfg)
  assert.equal(st2.trashed, 1)
  assert.equal(pendingReviewItems(cfg).length, 0)
  console.log('PASS review-timeout')

  const b = addTrivia(cfg, { text: '手动删掉的杂事', tags: ['联调'] })
  assert.equal(removeTrivia(cfg, b.item.id).ok, true)
  assert.equal(readTrivia(cfg, b.item.id), null)
  console.log('PASS remove')

  const c = addTrivia(cfg, { text: '复审保留的杂事', tags: ['联调'] })
  writeIndex([{ ...readTrivia(cfg, c.item.id), pendingReview: true, reviewDeadline: new Date(Date.now() - 1000).toISOString() }])
  const kept = keepTrivia(cfg, c.item.id)
  assert.equal(kept.ok, true)
  assert.equal(kept.item.pendingReview, false)
  assert.ok(kept.item.extendedUntil)
  assert.ok(expiryAt(kept.item) > Date.now() + 50 * day)
  console.log('PASS keep')

  const d = addTrivia(cfg, { text: '快过期但被更新', tags: ['联调'] })
  writeIndex([{ ...readTrivia(cfg, d.item.id), createdAt: new Date(Date.now() - 59 * day).toISOString(), updatedAt: new Date(Date.now() - 59 * day).toISOString(), lastAccessAt: '', hits: 0 }])
  const renewed = updateTrivia(cfg, d.item.id, { text: '更新后续命' })
  assert.equal(renewed.ok, true)
  assert.ok(expiryAt(renewed.item) > Date.now() + 5 * day)
  console.log('PASS update-renew')

  console.log('SUMMARY trivia 5/5')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
