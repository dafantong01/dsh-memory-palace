import assert from 'node:assert/strict'
import {
  renewalDays, expiryAt, lifetimeDays, isLongLived, classifyExpiry,
  reviewDeadline, reviewOverdue, daysBetween, BASE_DAYS,
} from '../lib/trivia-age.js'

const day = 24 * 60 * 60 * 1000
const base = Date.parse('2026-01-01T00:00:00Z')

assert.equal(renewalDays(0), 7)
assert.equal(renewalDays(1), 10)
assert.equal(renewalDays(3), 10)
assert.equal(renewalDays(1000), 10)
console.log('PASS renewal')

const item = { createdAt: new Date(base).toISOString(), hits: 0 }
assert.equal(expiryAt(item), base + BASE_DAYS * day)
const touched = { ...item, hits: 2, lastAccessAt: new Date(base + 55 * day).toISOString() }
assert.ok(expiryAt(touched) > base + BASE_DAYS * day)
assert.ok(expiryAt(touched) >= base + 55 * day + renewalDays(2) * day - 1000)
console.log('PASS expiry')

const long = { createdAt: new Date(base).toISOString(), hits: 8, lastAccessAt: new Date(base + 85 * day).toISOString() }
assert.ok(lifetimeDays(long) >= 90)
assert.equal(isLongLived(long, base + 61 * day), true)
const plain = { createdAt: new Date(base).toISOString(), hits: 0 }
assert.equal(isLongLived(plain, base + 61 * day), false)
console.log('PASS long-lived')

assert.equal(classifyExpiry(plain, base + 10 * day), 'keep')
assert.equal(classifyExpiry(plain, base + 61 * day), 'trash')
assert.equal(classifyExpiry(long, base + 200 * day), 'review')
console.log('PASS classify')

const deadline = reviewDeadline(base)
assert.equal(daysBetween(base, deadline), 14)
assert.equal(reviewOverdue({ reviewDeadline: new Date(deadline).toISOString() }, deadline - 1000), false)
assert.equal(reviewOverdue({ reviewDeadline: new Date(deadline).toISOString() }, deadline), true)
console.log('PASS review')

console.log('SUMMARY trivia-age 5/5')
