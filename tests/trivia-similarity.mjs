import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findSimilarTrivia } from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-similarity-'))
const cfg = { dir: root }
const dir = path.join(root, 'trivia')
fs.mkdirSync(dir, { recursive: true })
const make = (id, text, tags) => ({
  id, text, tags,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  lastAccessAt: '', hits: 0, pendingReview: false, reviewDeadline: '',
  expiresAt: '2027-06-01T00:00:00.000Z', schema: 2,
})

try {
  fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(make('canon', '月月可爱', ['月月', '可爱'])) + '\n', 'utf8')
  for (const text of ['月月很可爱', '月月太可爱了', '咋这么可爱呢月月', '乖巧可爱凌砚月', '可可爱爱的超级小月月']) {
    const hit = findSimilarTrivia(cfg, text, ['月月', '可爱'])
    assert.ok(hit, `${text} 应判重`)
    assert.equal(hit.item.id, 'canon')
  }
  assert.equal(findSimilarTrivia(cfg, '月月不可爱', ['月月', '可爱']), null)
  assert.equal(findSimilarTrivia(cfg, '月月今天很累', ['月月', '可爱']), null)

  fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(make('food', '我今天吃了大白饭', ['白饭', '吃饭'])) + '\n', 'utf8')
  const food = findSimilarTrivia(cfg, '我今天猛猛干白饭', ['白饭', '吃饭'])
  assert.ok(food)
  assert.equal(food.item.id, 'food')
  assert.equal(findSimilarTrivia(cfg, '今天吃了白米饭', ['白饭', '吃饭']), null)

  fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(make('project-a', 'A 交代我下午把工程档案交过去', ['工程档案'])) + '\n', 'utf8')
  assert.equal(findSimilarTrivia(cfg, 'B 交代我下午把金融档案交过去', ['金融档案']), null)
  assert.equal(findSimilarTrivia(cfg, '下午把档案交过去', ['档案']), null)

  fs.writeFileSync(path.join(dir, 'index.jsonl'), JSON.stringify(make('generic-a', 'A 交代我下午把工程档案交过去', ['档案'])) + '\n', 'utf8')
  assert.equal(findSimilarTrivia(cfg, 'B 交代我下午把金融档案交过去', ['档案']), null)
  console.log('SUMMARY trivia-similarity 13/13')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
