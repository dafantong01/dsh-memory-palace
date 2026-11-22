import assert from 'node:assert/strict'
import { validateReminder, dueReminders, mergeByDoc, applyFire, MAX_REMINDERS_PER_DOC, resetPressureLatch, nextOccurrence } from '../lib/reminders.js'

const base = { docId: 'doc-a', action: 'read-full', trigger: { type: 'turns', everyN: 10 } }
assert.equal(validateReminder(base, []).ok, true)

// 非法触发/动作/文本
assert.equal(validateReminder({ ...base, trigger: { type: 'bad' } }, []).ok, false)
assert.equal(validateReminder({ ...base, action: 'bad' }, []).ok, false)
assert.equal(validateReminder({ ...base, freeText: 'x'.repeat(81) }, []).ok, false)
// 时刻范围与整数校验
assert.equal(validateReminder({ ...base, trigger: { type: 'time', every: 'day', at: '25:99' } }, []).ok, false)
assert.equal(validateReminder({ ...base, trigger: { type: 'time', every: 'day', at: '07:60' } }, []).ok, false)
assert.equal(validateReminder({ ...base, trigger: { type: 'time', every: 'day', at: '23:59' } }, []).ok, true)
assert.equal(validateReminder({ ...base, trigger: { type: 'turns', everyN: 1.9 } }, []).ok, false)
assert.equal(validateReminder({ ...base, trigger: { type: 'pressure', threshold: 65.5 } }, []).ok, false)

// 单文档上限与重复
const full = Array.from({ length: MAX_REMINDERS_PER_DOC }, (_, i) => ({
  ...base, id: `r${i}`, trigger: { type: 'turns', everyN: i + 1 },
}))
assert.equal(validateReminder(base, full).ok, false)
assert.equal(validateReminder(base, [{ ...base, id: 'x' }]).ok, false)
console.log('PASS validate')

// 到期判定
const r = (id, trigger, extra = {}) => ({ id, docId: 'doc-a', enabled: true, action: 'read-full', trigger, ...extra })
let due = dueReminders(
  [r('t1', { type: 'turns', everyN: 5 }, { lastFiredTurn: 3 })],
  { turn: 8 },
)
assert.deepEqual(due.map((x) => x.id), ['t1'])
assert.deepEqual(dueReminders([r('t2', { type: 'turns', everyN: 5 }, { lastFiredTurn: 5 })], { turn: 8 }), [])

// 跨会话：旧会话的 turn 游标不影响新会话，新会话从 0 起算
assert.deepEqual(
  dueReminders([r('t3', { type: 'turns', everyN: 20 }, { lastFiredTurn: 300, lastFiredTurnSid: 'old' })], { turn: 5, sid: 'new' }),
  [],
)
assert.deepEqual(
  dueReminders([r('t3', { type: 'turns', everyN: 20 }, { lastFiredTurn: 300, lastFiredTurnSid: 'old' })], { turn: 25, sid: 'new' }).map((x) => x.id),
  ['t3'],
)
assert.deepEqual(
  dueReminders([r('t4', { type: 'turns', everyN: 20 }, { lastFiredTurn: 300, lastFiredTurnSid: 's1' })], { turn: 305, sid: 's1' }),
  [],
)
// 归属会话过滤：别人的提醒不在本会话触发
assert.deepEqual(dueReminders([r('o1', { type: 'turns', everyN: 1 }, { ownerSid: 'other' })], { turn: 99, sid: 'me' }), [])
assert.deepEqual(dueReminders([r('o2', { type: 'turns', everyN: 1 }, { ownerSid: 'me' })], { turn: 99, sid: 'me' }).map((x) => x.id), ['o2'])

due = dueReminders(
  [r('p1', { type: 'pressure', threshold: 65 })],
  { pressure: 70 },
)
assert.deepEqual(due.map((x) => x.id), ['p1'])
assert.deepEqual(dueReminders([r('p2', { type: 'pressure', threshold: 65 })], { pressure: 60 }), [])
// 锁存：越过阈值只触发一次；回落到阈值以下重新武装
assert.deepEqual(dueReminders([r('p3', { type: 'pressure', threshold: 65 }, { pressureAbove: true })], { pressure: 70 }), [])
assert.equal(resetPressureLatch([r('p4', { type: 'pressure', threshold: 65 }, { pressureAbove: true })], 60).changed, true)
assert.equal(resetPressureLatch([r('p5', { type: 'pressure', threshold: 65 }, { pressureAbove: true })], 70).changed, false)
assert.equal(resetPressureLatch([r('p6', { type: 'pressure', threshold: 65 }, { pressureAbove: false })], 60).changed, false)

due = dueReminders([r('e1', { type: 'event', kind: 'compaction' })], { compaction: true })
assert.deepEqual(due.map((x) => x.id), ['e1'])
due = dueReminders([r('e2', { type: 'event', kind: 'session-start' })], { sessionStart: true, sid: 's1' })
assert.deepEqual(due.map((x) => x.id), ['e2'])
assert.deepEqual(dueReminders([r('e3', { type: 'event', kind: 'session-start' }, { lastFiredSid: 's1' })], { sessionStart: true, sid: 's1' }), [])

due = dueReminders([r('d1', { type: 'time', every: 'day', at: '09:00' })], { day: '2026-11-18', hhmm: '09:30' })
assert.deepEqual(due.map((x) => x.id), ['d1'])
assert.deepEqual(dueReminders([r('d2', { type: 'time', every: 'day', at: '09:00' }, { lastFiredDay: '2026-11-18' })], { day: '2026-11-18', hhmm: '10:00' }), [])
assert.deepEqual(dueReminders([r('x', { type: 'turns', everyN: 1 }, { enabled: false })], { turn: 99 }), [])
console.log('PASS due')

// 合并：同档案一次，动作排序，冷却
const merged = mergeByDoc([
  r('m1', { type: 'turns', everyN: 1 }, { action: 'read-on-demand' }),
  r('m2', { type: 'turns', everyN: 1 }, { action: 'need-update' }),
], {}, 1000000)
assert.equal(merged.length, 1)
assert.deepEqual(merged[0].actions, ['need-update', 'read-on-demand'])
const cooled = mergeByDoc([r('m3', { type: 'turns', everyN: 1 })], { 'doc-a|turns': 1000 }, 1000 + 5000)
assert.equal(cooled.length, 0)
// 不同时间点不合并；同一点的多条自由文本全部保留
const twoTimes = mergeByDoc([
  r('t7a', { type: 'time', every: 'day', at: '07:00' }, { action: 'read-full', freeText: '写 A' }),
  r('t7b', { type: 'time', every: 'day', at: '08:00' }, { action: 'read-on-demand', freeText: '写 B' }),
], {}, 2e9)
assert.equal(twoTimes.length, 2)
assert.deepEqual(twoTimes.map((x) => x.point).sort(), ['time:07:00', 'time:08:00'])
assert.ok(twoTimes.every((x) => x.freeText === '写 A' || x.freeText === '写 B'))
const samePoint = mergeByDoc([
  r('s1', { type: 'turns', everyN: 10 }, { action: 'read-full', freeText: '写 C' }),
  r('s2', { type: 'turns', everyN: 10 }, { action: 'need-update', freeText: '写 D' }),
], {}, 2e9)
assert.equal(samePoint.length, 1)
assert.match(samePoint[0].freeText, /写 C/)
assert.match(samePoint[0].freeText, /写 D/)
console.log('PASS merge')

// 触发后写回状态
const fired = mergeByDoc([r('f1', { type: 'turns', everyN: 1 })], {}, 2e9)
const updated = applyFire([r('f1', { type: 'turns', everyN: 1 })], fired, { turn: 12, sid: 's1', day: '2026-11-18' })
assert.equal(updated[0].lastFiredTurn, 12)
assert.equal(updated[0].lastFiredSid, 's1')
console.log('PASS applyFire')

// 一次性 / 重复
const anchor = new Date(2026, 10, 17, 22, 5, 0)
const daily = nextOccurrence({ type: 'time', every: 'day', at: '07:00' }, anchor)
assert.equal(daily.getDate(), 18)
const weekly = nextOccurrence({ type: 'time', every: 'week', weekday: 5, at: '11:00' }, anchor)
assert.equal(weekly.getDay(), 5)
assert.ok(weekly.getTime() > anchor.getTime())

const onceTurn = { id: 'ot', docId: 'd', enabled: true, repeat: false, anchorTurn: 10, action: 'read-full', trigger: { type: 'turns', everyN: 5 } }
assert.deepEqual(dueReminders([onceTurn], { turn: 15, sid: 's' }).map((x) => x.id), ['ot'])
const onceFired = mergeByDoc([onceTurn], {}, 2e9)
const onceAfter = applyFire([onceTurn], onceFired, { turn: 15, sid: 's' })
assert.equal(onceAfter[0].enabled, false)

const onceTime = { id: 'otime', docId: 'd', enabled: true, repeat: false, nextAt: daily.toISOString(), action: 'read-full', trigger: { type: 'time', every: 'day', at: '07:00' } }
assert.deepEqual(dueReminders([onceTime], { now: new Date(2026, 10, 18, 7, 1, 0), sid: 's' }).map((x) => x.id), ['otime'])
assert.deepEqual(dueReminders([onceTime], { now: new Date(2026, 10, 18, 6, 0, 0), sid: 's' }), [])
const onceTimeAfter = applyFire([onceTime], mergeByDoc([onceTime], {}, 2e9), { now: new Date(2026, 10, 18, 7, 1, 0), sid: 's' })
assert.equal(onceTimeAfter[0].enabled, false)

const repTime = { ...onceTime, id: 'rtime', repeat: true }
const repAfter = applyFire([repTime], mergeByDoc([repTime], {}, 2e9), { now: new Date(2026, 10, 18, 7, 1, 0), sid: 's' })
assert.equal(repAfter[0].enabled, true)
assert.ok(Date.parse(repAfter[0].nextAt) > new Date(2026, 10, 18, 7, 1, 0).getTime())
console.log('PASS repeat')

// 存储缓存：写入后立即可见；外部改写能失效
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadReminders, saveReminders } from '../lib/reminders.js'
const nsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-rem-'))
try {
  saveReminders(nsDir, [r('c1', { type: 'turns', everyN: 2 })])
  assert.deepEqual(loadReminders(nsDir).map((x) => x.id), ['c1'])
  saveReminders(nsDir, [r('c2', { type: 'turns', everyN: 3 })])
  assert.deepEqual(loadReminders(nsDir).map((x) => x.id), ['c2'])
  const file = path.join(nsDir, '_docs', 'reminders.json')
  fs.writeFileSync(file, JSON.stringify({ version: 1, reminders: [r('c3', { type: 'turns', everyN: 4 })] }), 'utf8')
  assert.deepEqual(loadReminders(nsDir).map((x) => x.id), ['c3'])
  console.log('PASS cache')
} finally {
  fs.rmSync(nsDir, { recursive: true, force: true })
}

console.log('SUMMARY reminders 4/4')
