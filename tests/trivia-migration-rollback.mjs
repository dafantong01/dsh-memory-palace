import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listTrivia, addTrivia, supersedeTrivia, invalidateTriviaCache } from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-migrate-rollback-'))
const cfg = { dir: root }
const dir = path.join(root, 'trivia')
fs.mkdirSync(dir, { recursive: true })
const index = path.join(dir, 'index.jsonl')
const legacy = {
  id: 'trivia-legacy-rollback',
  text: '旧版本里的一条事实',
  tags: ['兼容'],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  hits: 2,
  lastAccessAt: '2026-11-10T00:00:00.000Z',
  pendingReview: false,
  reviewDeadline: '',
  customField: 'keep-me',
}
fs.writeFileSync(index, JSON.stringify(legacy) + '\n', 'utf8')

try {
  const before = listTrivia(cfg)
  assert.equal(before.length, 1)
  assert.equal(before[0].customField, 'keep-me')

  const added = addTrivia(cfg, { text: '新事实', tags: ['兼容'] })
  assert.equal(added.ok, true)
  const backups = fs.readdirSync(dir).filter((n) => n.startsWith('index.jsonl.bak-schema2-'))
  assert.equal(backups.length, 1)
  const backupPath = path.join(dir, backups[0])

  const newItem = supersedeTrivia(cfg, legacy.id, { text: '新版本里的事实', tags: ['兼容'] })
  assert.equal(newItem.ok, true)
  assert.equal(listTrivia(cfg).find((x) => x.id === legacy.id).status, 'superseded')

  fs.copyFileSync(backupPath, index)
  invalidateTriviaCache(cfg)
  const rolled = listTrivia(cfg)
  assert.equal(rolled.length, 1)
  assert.equal(rolled[0].id, legacy.id)
  assert.equal(rolled[0].customField, 'keep-me')
  assert.equal(rolled[0].status, 'active')
  console.log('SUMMARY trivia-migration-rollback 8/8')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
