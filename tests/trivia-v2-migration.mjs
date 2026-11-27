import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  listTrivia, updateTrivia, addTrivia, recallTrivia,
} from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-v2-'))
const cfg = { dir: root }
const dir = path.join(root, 'trivia')
fs.mkdirSync(dir, { recursive: true })
const index = path.join(dir, 'index.jsonl')
const legacy = {
  id: 'trivia-legacy-1',
  text: '小张对花生过敏',
  tags: ['小张', '过敏'],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  lastAccessAt: '',
  hits: 0,
  pendingReview: false,
  reviewDeadline: '',
  expiresAt: '2026-12-01T00:00:00.000Z',
  customField: 'must-survive',
}
fs.writeFileSync(index, JSON.stringify(legacy) + '\n', 'utf8')

try {
  const before = listTrivia(cfg)
  assert.equal(before.length, 1)
  assert.equal(before[0].customField, 'must-survive')
  assert.deepEqual(before[0].tags, ['小张', '过敏'])
  assert.equal(before[0].status, 'active')
  assert.equal(before[0].schema, 2)
  assert.equal(before[0].entities.length, 0)

  const updated = updateTrivia(cfg, legacy.id, { text: '小张对花生严重过敏', tags: ['小张', '过敏'] })
  assert.equal(updated.ok, true)
  assert.equal(updated.item.customField, 'must-survive')
  assert.equal(updated.item.text, '小张对花生严重过敏')
  assert.equal(fs.existsSync(path.join(dir, 'meta.json')), true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).schemaVersion, 2)

  const backups = fs.readdirSync(dir).filter((name) => name.startsWith('index.jsonl.bak-schema2-'))
  assert.equal(backups.length, 1, 'schema migration backup must be created once')

  const added = addTrivia(cfg, { text: '小张喜欢手冲咖啡', tags: ['小张', '咖啡'] })
  assert.equal(added.ok, true)
  const after = listTrivia(cfg)
  assert.equal(after.length, 2)
  assert.equal(after.find((x) => x.id === legacy.id).customField, 'must-survive')
  assert.equal(fs.readdirSync(dir).filter((name) => name.startsWith('index.jsonl.bak-schema2-')).length, 1)

  const hit = recallTrivia(cfg, '小张对花生', { limit: 3 })
  assert.ok(hit.some((x) => x.id === legacy.id))
  const coffee = recallTrivia(cfg, '小张喝咖啡', { limit: 3 })
  assert.ok(coffee.some((x) => x.id === added.item.id))
  assert.equal(recallTrivia(cfg, '今天天气怎么样', { limit: 3 }).length, 0)
  console.log('SUMMARY trivia-v2 8/8')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
