/**
 * 压缩后“近月摘要”选月：只按 turn 335 的约定走。
 *
 * - 当前月有摘要 → 读当前月；摘要不足 500 token 且上一个月有摘要 → 再加读上一个月
 * - 当前月没有摘要 → 最多退到上一个月；再没有就停
 * - 不按“最近存在摘要的月份”无限往前找
 *
 * 纯函数，has/text/tokensOf 由调用方注入，便于测试。
 */

export function previousMonth(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''))
  if (!m) return ''
  let y = Number(m[1])
  let mo = Number(m[2]) - 1
  if (mo === 0) { y -= 1; mo = 12 }
  return `${y}-${String(mo).padStart(2, '0')}`
}

export function pickSummaryMonths({ month, has, text, tokensOf, minTokens = 500 }) {
  if (!month || typeof has !== 'function') return []
  const prev = previousMonth(month)
  if (has(month)) {
    const out = [month]
    const tokens = typeof tokensOf === 'function' ? tokensOf(text(month) || '') : 0
    if (tokens < minTokens && prev && has(prev)) out.push(prev)
    return out
  }
  if (prev && has(prev)) return [prev]
  return []
}
