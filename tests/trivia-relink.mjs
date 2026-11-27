import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addTrivia, listTrivia, supersedeTrivia, removeTrivia, recallTrivia } from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-relink-'))
const cfg = { dir: root, triviaInterest: 5 }
try {
  const a = addTrivia(cfg, { text: '旧事实', tags: ['链路'] }, { source: 'user' })
  const b = supersedeTrivia(cfg, a.item.id, { text: '中间事实', tags: ['链路'] }, { source: 'model' })
  const c = supersedeTrivia(cfg, b.item.id, { text: '最新事实', tags: ['链路'] }, { source: 'model' })
  assert.equal(c.ok, true)

  const rm = removeTrivia(cfg, b.item.id)
  assert.equal(rm.ok, true)
  const items = listTrivia(cfg)
  const oldA = items.find((x) => x.id === a.item.id)
  const newC = items.find((x) => x.id === c.item.id)
  assert.equal(oldA.status, 'superseded')
  assert.equal(oldA.supersededBy, c.item.id)
  assert.equal(newC.supersedes, a.item.id)
  assert.ok(!items.some((x) => x.id === b.item.id))

  const recalled = recallTrivia(cfg, '事实', { limit: 5 })
  assert.ok(recalled.some((x) => x.id === c.item.id))
  assert.ok(!recalled.some((x) => x.id === a.item.id))
  console.log('SUMMARY trivia-relink 8/8')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
