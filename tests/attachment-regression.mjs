import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as docs from '../lib/docs.js'

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-attach-'))
const NS = 'attach-regression'
const SID = 'session-attach-regression'
try {
  const created = docs.createDoc(cwd, NS, SID, { title: 'T', content: 'b', tags: [], projectLabel: 'attach-reg' })
  assert.equal(created.ok, true)
  const id = created.doc.id
  const add = (p) => docs.addDocAttachmentPath(cwd, NS, SID, id, { path: p })

  // 路径挂载：外部文件只挂路径
  const file = path.join(cwd, 'local.txt')
  fs.writeFileSync(file, 'x')
  const local = add(file)
  assert.equal(local.ok, true)
  assert.equal(local.attachment.kind, 'file')
  assert.equal(fs.existsSync(path.join(cwd, 'memory-palace', NS, '_docs', 'assets', id, path.basename(file))), false)

  // 同路径去重
  const dupPath = add(file)
  assert.equal(dupPath.code, 'duplicate')

  // 网页链接
  const url = add('https://example.com/a?b=1')
  assert.equal(url.ok, true)
  assert.equal(url.attachment.kind, 'url')
  assert.equal(add('HTTPS://EXAMPLE.COM/a?b=1').code, 'duplicate')
  for (const bad of ['ftp://example.com/x', 'file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.com/']) {
    assert.equal(add(bad).code, 'invalid-url', bad)
  }

  // 上限
  for (const u of ['https://example.org/1', 'https://example.org/2', 'https://example.org/3']) add(u)
  assert.equal(add('https://example.org/6').code, 'too-many')

  // 删除链接只摘索引；删除文件不动原文件
  const list = docs.readDoc(cwd, NS, id).doc.attachments
  assert.equal(list.length, 5)
  const rmUrl = docs.removeDocAttachment(cwd, NS, SID, id, list.find((a) => a.kind === 'url').id)
  assert.equal(rmUrl.ok, true)
  const rmFile = docs.removeDocAttachment(cwd, NS, SID, id, list.find((a) => a.kind === 'file').id)
  assert.equal(rmFile.ok, true)
  assert.equal(fs.existsSync(file), true)

  console.log('PASS attachment path/url/dedupe/max/remove')
  console.log('SUMMARY attachment 1/1')
} finally {
  fs.rmSync(cwd, { recursive: true, force: true })
}
