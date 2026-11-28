import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addTrivia, normalizeTriviaTags, looksLikeCoreMemory } from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-write-gate-'))
const cfg = { dir: root, triviaInterest: 5 }

try {
  assert.equal(normalizeTriviaTags(['the']).ok, false)
  assert.equal(normalizeTriviaTags(['and']).ok, false)
  assert.equal(normalizeTriviaTags(['SQLite']).ok, true)
  assert.equal(normalizeTriviaTags(['C929']).ok, true)

  const low = addTrivia(cfg, { text: '晚安', tags: ['晚安'] }, { source: 'model' })
  assert.equal(low.ok, true)

  const fact = addTrivia(cfg, { text: '小张对花生过敏', tags: ['小张', '花生'] }, { source: 'model' })
  assert.equal(fact.ok, true)
  assert.equal(fact.item.source, 'model')
  assert.ok(fact.item.salience >= 2)

  const duplicate = addTrivia(cfg, { text: '小张对花生过敏', tags: ['小张', '花生'] }, { source: 'model' })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, 'duplicate')
  assert.equal(duplicate.duplicateId, fact.item.id)
  const after = fs.readFileSync(path.join(root, 'trivia', 'index.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(after.filter((x) => x.id === fact.item.id).length, 1)
  assert.equal(after.find((x) => x.id === fact.item.id).repeatCount, 1)

  const user = addTrivia(cfg, { text: '晚安', tags: ['晚安'] }, { source: 'user' })
  assert.equal(user.ok, true)
  assert.equal(user.item.source, 'user')

  assert.equal(looksLikeCoreMemory('记住以后都先给方案'), true)
  assert.equal(looksLikeCoreMemory('记得每次压缩后回看形象图'), true)
  assert.equal(looksLikeCoreMemory('你不能提一次词就加一个词'), false)
  assert.equal(looksLikeCoreMemory('记住这条规则：不删会话'), true)
  const core = addTrivia(cfg, { text: '记住以后都先给方案', tags: ['协作'] }, { source: 'model' })
  assert.equal(core.ok, false)
  assert.equal(core.code, 'use-core')

  const highText = '开心满意放心期待惊喜激动兴奋安心温暖，配置从两点改到四点，接口报错'
  const high = addTrivia(cfg, { text: highText, tags: ['高显著'] }, { source: 'model' })
  assert.equal(high.ok, false)
  assert.equal(high.code, 'high-salience')
  const confirmed = addTrivia(cfg, { text: highText, tags: ['高显著'] }, { source: 'model', confirmHigh: true })
  assert.equal(confirmed.ok, true)
  const structuralHigh = addTrivia(cfg, { text: highText, tags: ['高结构'] }, { source: 'plugin', structural: true })
  assert.equal(structuralHigh.ok, false)
  assert.equal(structuralHigh.code, 'high-salience')
  console.log('SUMMARY trivia-write-gate 21/21')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
