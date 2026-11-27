import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addTrivia, listTrivia, supersedeTrivia, recordAccess, removeTrivia, recallTrivia, ageTrivia, invalidateTriviaCache } from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-supersede-'))
const cfg = { dir: path.join(root, 'ns'), triviaInterest: 5 }

try {
  const first = addTrivia(cfg, { text: '小张对花生过敏', tags: ['小张', '花生'], entities: ['小张'] }, { source: 'user' })
  assert.equal(first.ok, true)
  assert.deepEqual(first.item.entities, ['小张'])

  const second = supersedeTrivia(cfg, first.item.id, {
    text: '小张已经脱敏',
    tags: ['小张', '脱敏'],
    entities: ['小张'],
  }, { source: 'model' })
  assert.equal(second.ok, true)
  assert.notEqual(second.item.id, first.item.id)
  assert.equal(second.item.supersedes, first.item.id)
  assert.equal(second.item.status, 'active')
  assert.ok(second.item.relatedIds.includes(first.item.id))
  assert.equal(second.superseded.status, 'superseded')
  assert.equal(second.superseded.supersededBy, second.item.id)
  assert.ok(second.superseded.validTo)
  assert.deepEqual(second.item.tags, ['小张', '花生', '脱敏'])

  const hitsBefore = second.superseded.hits
  recordAccess(cfg, [first.item.id])
  const oldAfter = listTrivia(cfg).find((x) => x.id === first.item.id)
  assert.equal(oldAfter.hits, hitsBefore)

  const recalled = recallTrivia(cfg, '小张', { limit: 5 })
  assert.ok(recalled.some((x) => x.id === second.item.id))
  assert.ok(!recalled.some((x) => x.id === first.item.id))

  const again = supersedeTrivia(cfg, first.item.id, { text: '又改一次', tags: ['小张'] })
  assert.equal(again.ok, false)
  assert.equal(again.code, 'already-superseded')

  // 旧条已过时后按自己的寿命回收，新条不受影响。
  const indexPath = path.join(cfg.dir, 'trivia', 'index.jsonl')
  const rows = fs.readFileSync(indexPath, 'utf8').trim().split('\n').map(JSON.parse)
  const oldRow = rows.find((x) => x.id === first.item.id)
  oldRow.status = 'superseded'
  oldRow.createdAt = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString()
  oldRow.updatedAt = oldRow.createdAt
  oldRow.lastAccessAt = ''
  oldRow.hits = 0
  fs.writeFileSync(indexPath, rows.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
  invalidateTriviaCache(cfg)
  const aged = ageTrivia(cfg, Date.now())
  assert.ok(aged.trashed >= 1)
  assert.equal(listTrivia(cfg).find((x) => x.id === first.item.id), undefined)
  assert.equal(listTrivia(cfg).find((x) => x.id === second.item.id)?.status, 'active')
  assert.ok(recallTrivia(cfg, '小张', { limit: 5 }).some((x) => x.id === second.item.id))

  const named = addTrivia(cfg, { text: '网名叫面对疾风吧', tags: ['网名'], entities: ['面对疾风吧'] }, { source: 'user' })
  assert.equal(named.ok, true)
  assert.deepEqual(named.item.entities, ['面对疾风吧'])
  console.log('SUMMARY trivia-supersede 18/18')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
