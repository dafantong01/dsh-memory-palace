import assert from 'node:assert/strict'
import { validateSummaryKeywords } from '../lib/summary-keywords.js'

const src = '用户要求压缩后只给提示，不注入摘要全文。关键词要取原词，比如追溯、回退一个月。'

// 没有关键词行 → 不校验
assert.equal(validateSummaryKeywords('普通摘要，没有关键词行。', src).ok, true)
console.log('PASS no-line')

// 关键词：无
assert.deepEqual(validateSummaryKeywords('摘要。\n关键词：无', src), { ok: true, none: true, keywords: [], errors: [] })
console.log('PASS none')

// 合法原词
let r = validateSummaryKeywords('摘要。\n关键词（仅供检索）：追溯、回退一个月', src)
assert.equal(r.ok, true)
assert.deepEqual(r.keywords, ['追溯', '回退一个月'])
console.log('PASS valid')

// 不在原文 → 报错
r = validateSummaryKeywords('摘要。\n关键词：追溯、机制', src)
assert.equal(r.ok, false)
assert.match(r.errors.join('|'), /机制.*没有出现/)
console.log('PASS missing')

// 超过 8 个
r = validateSummaryKeywords('摘要。\n关键词：a、b、c、d、e、f、g、h、i', 'a b c d e f g h i')
assert.match(r.errors.join('|'), /超过 8 个/)
console.log('PASS max-count')

// 单个超过 16 字
const longWord = '很长的关键词'.repeat(4)
r = validateSummaryKeywords(`摘要。\n关键词：${longWord}`, longWord)
assert.match(r.errors.join('|'), /超过 16 字/)
console.log('PASS max-len')

console.log('SUMMARY summary-keywords 6/6')
