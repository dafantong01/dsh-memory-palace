/**
 * 杂事随记：年龄与新鲜度的纯函数。
 * 只做计算，不碰文件；便于单测与后台复用。
 *
 * 遗忘模型（见 V0.4 档案 1.9）：
 * - 基础寿命 60 天
 * - 每次访问续命 min(7 + 7*log2(1+hits), 10) 天
 * - 过期线 = max(createdAt + 60 天, lastAccessAt + 续命天数)
 * - 长寿条目（预计寿命 ≥90 天 / hits≥5 / 近 30 天读过）到期先进复审，不直接清
 */

export const BASE_DAYS = 60
export const RENEW_MAX_DAYS = 10
export const LONG_LIVED_DAYS = 90
export const REVIEW_GRACE_DAYS = 14
export const TRASH_DAYS = 30
export const MAX_TEXT_CHARS = 60
export const MAX_TAGS = 5
export const MAX_TAG_CHARS = 16
export const RECENT_READ_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000
const toMs = (v) => {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v) return Date.parse(v)
  return NaN
}

export function daysBetween(from, to) {
  const a = toMs(from)
  const b = toMs(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return (b - a) / DAY_MS
}

/** 每次访问能续多少天；递增但封顶。 */
export function renewalDays(hits) {
  const n = Math.max(0, Number(hits) || 0)
  return Math.min(7 + 7 * Math.log2(1 + n), RENEW_MAX_DAYS)
}

/** 过期线（毫秒时间戳）。 */
export function expiryAt(item) {
  const created = toMs(item?.createdAt)
  if (!Number.isFinite(created)) return NaN
  const base = created + BASE_DAYS * DAY_MS
  const last = toMs(item?.lastAccessAt)
  const extended = toMs(item?.extendedUntil)
  let expiry = base
  if (Number.isFinite(last)) expiry = Math.max(expiry, last + renewalDays(item?.hits) * DAY_MS)
  if (Number.isFinite(extended)) expiry = Math.max(expiry, extended)
  return expiry
}

/** 预计寿命（天）：从创建到过期线。 */
export function lifetimeDays(item) {
  const created = toMs(item?.createdAt)
  const expiry = expiryAt(item)
  if (!Number.isFinite(created) || !Number.isFinite(expiry)) return NaN
  return (expiry - created) / DAY_MS
}

/** 是否算“长寿”，到期需要先复审。 */
export function isLongLived(item, now = Date.now()) {
  const life = lifetimeDays(item)
  if (Number.isFinite(life) && life >= LONG_LIVED_DAYS) return true
  if ((Number(item?.hits) || 0) >= 5) return true
  const last = toMs(item?.lastAccessAt)
  if (Number.isFinite(last) && (Number(item?.hits) || 0) > 0) {
    return daysBetween(last, now) <= RECENT_READ_DAYS
  }
  return false
}

/**
 * 到期分流：
 * - keep：未过期
 * - review：已过期但长寿，进 pendingReview
 * - trash：已过期且普通
 */
export function classifyExpiry(item, now = Date.now()) {
  const expiry = expiryAt(item)
  if (!Number.isFinite(expiry)) return 'trash'
  if (now < expiry) return 'keep'
  return isLongLived(item, now) ? 'review' : 'trash'
}

/** 复审截止：进复审后 14 天。 */
export function reviewDeadline(now = Date.now()) {
  return now + REVIEW_GRACE_DAYS * DAY_MS
}

/** 复审超期未处理，转清理。 */
export function reviewOverdue(item, now = Date.now()) {
  const d = toMs(item?.reviewDeadline)
  return Number.isFinite(d) && now >= d
}
