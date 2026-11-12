import assert from 'node:assert/strict'
import { classifyArchiveLine, isFenceLine, lineKindAllowed } from '../lib/search-blocks.js'

// 结构行分类
assert.equal(classifyArchiveLine('### 用户（user） · 2026-01-01'), 'user')
assert.equal(classifyArchiveLine('### 助手思考（assistant reasoning） · 2026-01-01'), 'assistant-reasoning')
assert.equal(classifyArchiveLine('### 助手（assistant） · 2026-01-01'), 'assistant')
assert.equal(classifyArchiveLine('### 附件（attachment） · 2026-01-01'), 'assistant')
assert.equal(classifyArchiveLine('### 助手调用工具（tool call：pwsh）'), 'tool')
assert.equal(classifyArchiveLine('### 工具返回（tool result：pwsh）'), 'tool')
assert.equal(classifyArchiveLine('### 系统（system）'), 'system')
assert.equal(classifyArchiveLine('### 普通小节'), null)
assert.equal(classifyArchiveLine('正文里提到 ### 用户（user）'), null)
console.log('PASS classifyArchiveLine')

// 过滤组合
assert.equal(lineKindAllowed('user', { speaker: 'user' }), true)
assert.equal(lineKindAllowed('assistant', { speaker: 'user' }), false)
assert.equal(lineKindAllowed('assistant-reasoning', { speaker: 'user' }), false)
assert.equal(lineKindAllowed('assistant', { speaker: 'assistant' }), true)
assert.equal(lineKindAllowed('assistant-reasoning', { speaker: 'assistant' }), true)
assert.equal(lineKindAllowed('assistant-reasoning', { speaker: 'assistant', includeReasoning: false }), false)
assert.equal(lineKindAllowed('assistant', { speaker: 'assistant', includeReasoning: false }), true)
assert.equal(lineKindAllowed('tool', { speaker: 'assistant' }), false)
assert.equal(lineKindAllowed('user', {}), true)
assert.equal(lineKindAllowed('assistant-reasoning', { includeReasoning: false }), false)
console.log('PASS lineKindAllowed')

// 模拟逐行扫描：围栏内的结构行不能改归属；## TURN 重置
const lines = [
  '### 助手调用工具（tool call：palace_read）',
  '```',
  '### 用户（user） · 旧档里的引用',
  '旧用户文本',
  '```',
  '### 助手（assistant）',
  '真正的新助手文本',
  '## TURN 99',
  '### 用户（user）',
  '新用户文本',
]
const kinds = []
let kind = 'other'
let fence = false
for (const line of lines) {
  if (line.startsWith('## TURN ')) { kind = 'other'; fence = false; kinds.push(kind); continue }
  if (isFenceLine(line)) { fence = !fence; kinds.push(kind); continue }
  if (!fence) {
    const next = classifyArchiveLine(line)
    if (next) { kind = next; kinds.push(kind); continue }
  }
  kinds.push(kind)
}
assert.deepEqual(kinds, [
  'tool', 'tool', 'tool', 'tool', 'tool',
  'assistant', 'assistant',
  'other', 'user', 'user',
])
// 围栏里的“### 用户”没有被当成 user
assert.equal(kinds[2], 'tool')
console.log('PASS fence / turn reset')

console.log('SUMMARY search-blocks 3/3')
