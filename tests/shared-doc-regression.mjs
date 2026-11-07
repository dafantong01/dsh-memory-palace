import assert from 'node:assert/strict'

const API = String(process.env.DSH_API_URL || '').replace(/\/$/, '')
const OWNER = String(process.env.OWNER_SESSION_ID || '')
const MEMBER = String(process.env.MEMBER_SESSION_ID || '')
if (!API || !OWNER || !MEMBER) {
  console.error('需要 DSH_API_URL、OWNER_SESSION_ID、MEMBER_SESSION_ID')
  process.exit(2)
}

async function post(sessionId, body, headers = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ sessionId, ...body }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
async function get(params) {
  const url = `${API}?${new URLSearchParams(params)}`
  const res = await fetch(url)
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const label = `shared-doc-regression-${Date.now()}`
let id = ''
const results = []
const test = async (name, fn) => {
  try {
    await fn()
    results.push(['PASS', name])
  } catch (err) {
    results.push(['FAIL', name, String(err?.message ?? err)])
  }
}

try {
  const created = await post(OWNER, {
    action: 'docs-create',
    title: '共享档案权限回归',
    description: 'temporary shared-doc regression',
    content: 'shared regression body',
    projectLabel: label,
  })
  assert.equal(created.status, 200)
  assert.equal(created.body.ok, true)
  id = created.body.doc.id
  const rev = created.body.doc.rev

  const shared = await post(OWNER, { action: 'docs-update', id, rev, familyShared: true })
  assert.equal(shared.status, 200)
  assert.equal(shared.body.doc.familyShared, true)
  const sharedRev = shared.body.doc.rev

  await test('member sees shared doc as read-only', async () => {
    const listed = await get({ action: 'docs-list', sessionId: MEMBER, limit: '100' })
    const hit = (listed.body.items || listed.body.entries || []).find((x) => x.id === id)
    assert.ok(hit)
    assert.equal(hit.readOnly, true)
    assert.equal(hit.canEdit, false)
    assert.equal(hit.familyShared, true)
    const read = await get({ action: 'docs-read', sessionId: MEMBER, id })
    assert.equal(read.body.ok, true)
    assert.equal(read.body.readOnly, true)
    assert.equal(read.body.doc.readOnly, true)
    assert.equal(read.body.doc.canEdit, false)
    assert.ok(read.body.doc.ownerName)
  })

  await test('member cannot change enabled/familyShared/archive/delete', async () => {
    for (const payload of [
      { action: 'docs-update', id, rev: sharedRev, enabled: false },
      { action: 'docs-update', id, rev: sharedRev, familyShared: false },
      { action: 'docs-update', id, rev: sharedRev, archived: true },
      { action: 'docs-remove', id },
    ]) {
      const r = await post(MEMBER, payload)
      assert.equal(r.body.ok, false)
    }
  })

  await test('owner keeps normal controls', async () => {
    const read = await get({ action: 'docs-read', sessionId: OWNER, id })
    assert.equal(read.body.ok, true)
    assert.equal(read.body.readOnly, false)
    assert.equal(read.body.doc.readOnly, false)
    assert.equal(read.body.doc.canEdit, true)
    const disabled = await post(OWNER, { action: 'docs-update', id, rev: sharedRev, enabled: false })
    assert.equal(disabled.body.ok, true)
    assert.equal(disabled.body.doc.enabled, false)
  })
} finally {
  if (id) {
    const current = await get({ action: 'docs-read', sessionId: OWNER, id }).catch(() => null)
    if (current?.body?.doc) {
      let rev = current.body.doc.rev
      if (current.body.doc.familyShared) {
        const off = await post(OWNER, { action: 'docs-update', id, rev, familyShared: false }).catch(() => null)
        if (off?.body?.doc) rev = off.body.doc.rev
      }
      const cfg = await get({ action: 'config', sessionId: OWNER }).catch(() => null)
      const token = cfg?.body?.coreConfirmToken
      if (token) await post(OWNER, { action: 'docs-update', id, rev, archived: true }, { 'x-memory-palace-confirm': token }).catch(() => null)
      await post(OWNER, { action: 'docs-remove', id }).catch(() => null)
    }
  }
}

for (const [status, name, error] of results) {
  console.log(status, name, ...(error ? [`:: ${error}`] : []))
}
const failed = results.filter(([status]) => status === 'FAIL').length
console.log(`\nSUMMARY ${results.length - failed}/${results.length}`)
if (failed) process.exitCode = 1
