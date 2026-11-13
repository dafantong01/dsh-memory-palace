import assert from 'node:assert/strict'
import { previousMonth, pickSummaryMonths } from '../lib/summary-months.js'

assert.equal(previousMonth('2026-11'), '2026-10')
assert.equal(previousMonth('2026-01'), '2025-12')
assert.equal(previousMonth('bad'), '')
console.log('PASS previousMonth')

const make = (have) => ({
  has: (m) => Boolean(have[m]),
  text: (m) => have[m] || '',
  tokensOf: (t) => t.length,
})

// 当前月有、够长 → 只读当前月
assert.deepEqual(
  pickSummaryMonths({ month: '2026-11', ...make({ '2026-11': 'x'.repeat(600), '2026-10': 'y' }) }),
  ['2026-11']
)

// 当前月有但太短 → 加读上一个月
assert.deepEqual(
  pickSummaryMonths({ month: '2026-11', ...make({ '2026-11': 'x', '2026-10': 'y' }) }),
  ['2026-11', '2026-10']
)

// 当前月没有 → 最多退一个月
assert.deepEqual(
  pickSummaryMonths({ month: '2026-11', ...make({ '2026-10': 'y' }) }),
  ['2026-10']
)

// 当前月和上一个月都没有 → 停，不继续往前
assert.deepEqual(
  pickSummaryMonths({ month: '2026-11', ...make({ '2026-09': 'z' }) }),
  []
)

// 非法月份 → 空
assert.deepEqual(
  pickSummaryMonths({ month: 'bad', ...make({ '2026-10': 'y' }) }),
  []
)
console.log('PASS pickSummaryMonths')

console.log('SUMMARY summary-months 2/2')
