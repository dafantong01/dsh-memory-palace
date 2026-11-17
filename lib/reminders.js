/**
 * 项目档案提醒：数据、校验、触发判定。
 * 存储：<命名空间>/_docs/reminders.json
 *
 * 一条提醒：
 * { id, docId, enabled, action, freeText, trigger, createdAt, updatedAt,
 *   lastFiredAt, lastFiredTurn, lastFiredDay, lastFiredSid }
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const MAX_REMINDERS_PER_DOC = 10
export const MAX_FREE_TEXT = 80
export const ACTIONS = ['read-full', 'read-on-demand', 'check-update', 'need-update']
export const TRIGGER_TYPES = ['time', 'turns', 'pressure', 'event']
const DOC_COOLDOWN_MS = 30 * 1000

const nowIso = () => new Date().toISOString()

function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

const fileOf = (nsDir) => path.join(nsDir, '_docs', 'reminders.json')

// 按文件路径缓存：mtime/size/存在性不变就不重读、不重解析。
// 写入后主动更新，避免同毫秒写入的边界。
const fileCache = new Map()

function readReminderFile(file) {
  let exists = true
  let mtimeMs = 0
  let size = 0
  try {
    const st = fs.statSync(file)
    mtimeMs = st.mtimeMs
    size = st.size
  } catch {
    exists = false
  }
  const hit = fileCache.get(file)
  if (hit && hit.exists === exists && hit.mtimeMs === mtimeMs && hit.size === size) return hit.data
  let data = []
  if (exists) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
      data = Array.isArray(parsed?.reminders) ? parsed.reminders : []
    } catch {
      data = []
    }
  }
  if (fileCache.size > 50) fileCache.clear()
  fileCache.set(file, { exists, mtimeMs, size, data })
  return data
}

export function loadReminders(nsDir) {
  return readReminderFile(fileOf(nsDir))
}

export function saveReminders(nsDir, reminders) {
  const file = fileOf(nsDir)
  const dir = path.join(nsDir, '_docs')
  fs.mkdirSync(dir, { recursive: true })
  atomicWriteJson(file, { version: 1, reminders })
  try {
    const st = fs.statSync(file)
    fileCache.set(file, { exists: true, mtimeMs: st.mtimeMs, size: st.size, data: reminders })
  } catch { /* stat 失败就下次重读 */ }
  return reminders
}

/** 下一次到达该时间触发的本地时刻（用于一次性与重复推进）。 */
export function nextOccurrence(t, now = new Date()) {
  if (!t || t.type !== 'time') return null
  const [hh, mm] = String(t.at || '00:00').split(':').map(Number)
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)
  if (t.every === 'week') {
    const target = Number(t.weekday) || 1 // 1=周一 ... 7=周日
    const cur = isoWeekday(now)
    let delta = (target - cur + 7) % 7
    if (delta === 0 && base.getTime() <= now.getTime()) delta = 7
    base.setDate(base.getDate() + delta)
    return base
  }
  if (base.getTime() <= now.getTime()) base.setDate(base.getDate() + 1)
  return base
}

function triggerKey(t) {
  if (!t || typeof t !== 'object') return ''
  if (t.type === 'time') return `time:${t.every}:${t.weekday ?? ''}:${t.at}`
  if (t.type === 'turns') return `turns:${Number(t.everyN)}`
  if (t.type === 'pressure') return `pressure:${Number(t.threshold)}`
  if (t.type === 'event') return `event:${t.kind}`
  return ''
}

/** 合并分组用：不同触发点不合并（时间按 HH:MM 区分）。 */
export function triggerPointKey(t) {
  if (!t || typeof t !== 'object') return 'other'
  if (t.type === 'time') return `time:${t.at}`
  if (t.type === 'turns') return 'turns'
  if (t.type === 'pressure') return 'pressure'
  if (t.type === 'event') return `event:${t.kind}`
  return 'other'
}

export function normalizeTrigger(t) {
  if (!t || typeof t !== 'object') return { ok: false, error: 'trigger 必须是对象', code: 'invalid-trigger' }
  const type = String(t.type || '')
  if (!TRIGGER_TYPES.includes(type)) return { ok: false, error: `trigger.type 只接受 ${TRIGGER_TYPES.join(' / ')}`, code: 'invalid-trigger' }
  if (type === 'time') {
    const every = t.every === 'week' ? 'week' : 'day'
    const at = String(t.at || '').trim()
    if (!/^\d{2}:\d{2}$/.test(at)) return { ok: false, error: '时间触发需要 at=HH:MM', code: 'invalid-trigger' }
    const [hh, mm] = at.split(':').map(Number)
    if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) {
      return { ok: false, error: '时间触发需要合法时刻：HH 为 00–23，MM 为 00–59', code: 'invalid-trigger' }
    }
    const weekday = every === 'week' ? Number(t.weekday) : undefined
    if (every === 'week' && !(weekday >= 1 && weekday <= 7)) return { ok: false, error: '每周触发需要 weekday=1..7（周一到周日）', code: 'invalid-trigger' }
    return { ok: true, trigger: { type, every, at, ...(weekday ? { weekday } : {}) } }
  }
  if (type === 'turns') {
    const everyN = Number(t.everyN)
    if (!Number.isInteger(everyN) || everyN < 1 || everyN > 10000) return { ok: false, error: '轮次触发需要 everyN=1..10000 的整数', code: 'invalid-trigger' }
    return { ok: true, trigger: { type, everyN } }
  }
  if (type === 'pressure') {
    const threshold = Number(t.threshold)
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) return { ok: false, error: '压力触发需要 threshold=1..100 的整数', code: 'invalid-trigger' }
    return { ok: true, trigger: { type, threshold } }
  }
  const kind = String(t.kind || '')
  if (!['session-start', 'compaction'].includes(kind)) return { ok: false, error: 'event.kind 只接受 session-start / compaction', code: 'invalid-trigger' }
  return { ok: true, trigger: { type: 'event', kind } }
}

export function validateReminder(input, existing = []) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'input 必须是对象', code: 'invalid-input' }
  const docId = String(input.docId || '').trim()
  if (!docId) return { ok: false, error: '缺少 docId', code: 'invalid-input' }
  const t = normalizeTrigger(input.trigger)
  if (!t.ok) return t
  const action = String(input.action || '')
  if (!ACTIONS.includes(action)) return { ok: false, error: `action 只接受 ${ACTIONS.join(' / ')}`, code: 'invalid-action' }
  const freeText = String(input.freeText || '').replace(/\s+/g, ' ').trim()
  if (freeText.length > MAX_FREE_TEXT) return { ok: false, error: `自由文本不能超过 ${MAX_FREE_TEXT} 字`, code: 'free-text-too-long' }
  const repeat = typeof input.repeat === 'boolean' ? input.repeat : undefined
  const sameDoc = existing.filter((r) => r.docId === docId && (!input.id || r.id !== input.id))
  if (sameDoc.length >= MAX_REMINDERS_PER_DOC) return { ok: false, error: `单篇档案最多 ${MAX_REMINDERS_PER_DOC} 条提醒，请先删一条`, code: 'too-many' }
  const key = `${triggerKey(t.trigger)}|${action}`
  if (sameDoc.some((r) => `${triggerKey(r.trigger)}|${r.action}` === key)) {
    return { ok: false, error: '同一档案、同一触发点、同一动作的提醒已存在', code: 'duplicate' }
  }
  return { ok: true, docId, action, freeText, trigger: t.trigger, ...(repeat !== undefined ? { repeat } : {}) }
}

/** 纯判定：给定时间/轮次/压力/事件，返回到期的提醒。 */
export function dueReminders(reminders, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now())
  const day = ctx.day || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const hhmm = ctx.hhmm || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const turn = Number(ctx.turn) || 0
  const pressure = Number(ctx.pressure) || 0
  const compaction = Boolean(ctx.compaction)
  const sessionStart = Boolean(ctx.sessionStart)
  const sid = String(ctx.sid || '')
  const out = []
  for (const r of reminders) {
    if (!r || r.enabled === false) continue
    // 归属会话过滤：别人的提醒不在本会话触发（旧数据没 ownerSid 的放行）。
    if (r.ownerSid && String(r.ownerSid) !== sid) continue
    const t = r.trigger || {}
    let due = false
    if (t.type === 'time') {
      if (r.nextAt) {
        due = now.getTime() >= Date.parse(r.nextAt)
      } else if (t.every === 'day') due = hhmm >= t.at && r.lastFiredDay !== day
      else if (t.every === 'week') {
        const iso = isoWeekday(now)
        due = iso === Number(t.weekday) && hhmm >= t.at && r.lastFiredDay !== day
      }
    } else if (t.type === 'turns') {
      const sameSid = String(r.lastFiredTurnSid || '') === String(ctx.sid || '')
      const base = sameSid ? (Number(r.lastFiredTurn) || Number(r.anchorTurn) || 0) : (Number(r.anchorTurn) || 0)
      due = turn > 0 && turn - base >= Number(t.everyN)
    } else if (t.type === 'pressure') {
      // 越过阈值只触发一次；回到阈值以下才重新武装（压缩后回落也会重置）。
      due = pressure >= Number(t.threshold) && !r.pressureAbove
    } else if (t.type === 'event') {
      if (t.kind === 'compaction') due = compaction
      else if (t.kind === 'session-start') due = sessionStart && r.lastFiredSid !== String(ctx.sid || '')
    }
    if (due) out.push(r)
  }
  return out
}

export function isoWeekday(date) {
  const d = date.getDay()
  return d === 0 ? 7 : d
}

/** 按档案 + 触发点合并：不同时间点各出一条；同组的自由文本全部保留。 */
export function mergeByDoc(due, lastDocFire = {}, now = Date.now()) {
  const order = ['read-full', 'need-update', 'check-update', 'read-on-demand']
  const groups = new Map()
  for (const r of due) {
    if (!r.docId) continue
    const point = triggerPointKey(r.trigger)
    const key = `${r.docId}|${point}`
    if (!groups.has(key)) groups.set(key, { docId: r.docId, point, list: [] })
    groups.get(key).list.push(r)
  }
  const out = []
  for (const [key, g] of groups) {
    const last = Number(lastDocFire[key]) || 0
    if (now - last < DOC_COOLDOWN_MS) continue
    const actions = [...new Set(g.list.map((r) => r.action))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    const texts = [...new Set(g.list.map((r) => r.freeText).filter(Boolean))]
    out.push({ docId: g.docId, point: g.point, actions, freeText: texts.join('；'), freeTexts: texts, reminders: g.list })
  }
  return out
}

export function newReminderId() {
  return `rem-${randomUUID().slice(0, 12)}`
}

export function applyFire(reminders, fired, ctx = {}) {
  const now = nowIso()
  const day = ctx.day || ''
  const turn = Number(ctx.turn) || 0
  const sid = String(ctx.sid || '')
  const at = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now())
  const ids = new Set(fired.flatMap((f) => f.reminders.map((r) => r.id)))
  return reminders.map((r) => {
    if (!ids.has(r.id)) return r
    const next = {
      ...r,
      lastFiredAt: now,
      lastFiredDay: day || r.lastFiredDay,
      lastFiredTurn: turn || r.lastFiredTurn,
      lastFiredTurnSid: sid || r.lastFiredTurnSid,
      lastFiredSid: sid || r.lastFiredSid,
      ...(r.trigger?.type === 'pressure' ? { pressureAbove: true } : {}),
    }
    // repeat 缺省视为重复（兼容旧数据）；显式 false = 一次性，触发后停用。
    if (r.repeat === false) return { ...next, enabled: false }
    if (r.trigger?.type === 'time') {
      const nxt = nextOccurrence(r.trigger, at)
      if (nxt) next.nextAt = nxt.toISOString()
    }
    return next
  })
}

/** 压力回落到阈值以下时重新武装；返回新数组与是否有变化。 */
export function resetPressureLatch(reminders, pressure) {
  let changed = false
  const out = reminders.map((r) => {
    if (r.trigger?.type !== 'pressure' || r.pressureAbove !== true) return r
    if (Number(pressure) >= Number(r.trigger.threshold)) return r
    changed = true
    return { ...r, pressureAbove: false }
  })
  return { reminders: out, changed }
}
