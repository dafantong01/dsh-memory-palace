import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as docs from '../lib/docs.js'

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-docedit-'))
const NS = 'docedit'
const SID = 'session-docedit'
try {
  const created = docs.createDoc(cwd, NS, SID, {
    title: '局部编辑测试',
    body: '# 标题\n\n## 一\n旧一\n\n## 二\n旧二\n',
    tags: [],
    projectLabel: 'docedit-test',
  })
  assert.equal(created.ok, true)
  const id = created.doc.id

  // append
  const appended = docs.updateDoc(cwd, NS, SID, id, { rev: created.doc.rev, append: '追加的一行' })
  assert.equal(appended.ok, true)
  const afterAppend = docs.readDoc(cwd, NS, id)
  assert.equal(afterAppend.ok, true)
  assert.match(afterAppend.body, /追加的一行/)
  assert.match(afterAppend.body, /旧二/)
  const rev2 = afterAppend.doc.rev

  // 按节替换
  const sec = docs.updateDoc(cwd, NS, SID, id, { rev: rev2, section: '一', body: '新一' })
  assert.equal(sec.ok, true)
  const afterSec = docs.readDoc(cwd, NS, id)
  assert.match(afterSec.body, /新一/)
  assert.doesNotMatch(afterSec.body, /旧一/)
  assert.match(afterSec.body, /旧二/)
  const rev3 = afterSec.doc.rev

  // 标题不存在
  const missing = docs.updateDoc(cwd, NS, SID, id, { rev: rev3, section: '不存在', body: 'x' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'section-not-found')
  assert.match(missing.error, /现有标题/)

  // rev 冲突
  const conflict = docs.updateDoc(cwd, NS, SID, id, { rev: rev3 - 1, append: 'x' })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.conflict, true)

  // 清空一节
  const cleared = docs.updateDoc(cwd, NS, SID, id, { rev: rev3, section: '二', body: '' })
  assert.equal(cleared.ok, true)
  const afterClear = docs.readDoc(cwd, NS, id)
  assert.match(afterClear.body, /## 二/)
  assert.doesNotMatch(afterClear.body, /旧二/)

  // 围栏内的假标题不能被当成真标题；其它节空白不被折叠
  const fenced = docs.createDoc(cwd, NS, SID, {
    title: '围栏测试',
    body: '# D\n\n' + '\u0060'.repeat(3) + 'md\n## 甲\n示例\n' + '\u0060'.repeat(3) + '\n\n## 甲\n真甲\n\n## 乙\n乙\n',
    tags: [],
    projectLabel: 'docedit-fence',
  })
  assert.equal(fenced.ok, true)
  const fdoc = docs.readDoc(cwd, NS, fenced.doc.id)
  const fres = docs.updateDoc(cwd, NS, SID, fenced.doc.id, { rev: fdoc.doc.rev, section: '甲', body: '替换' })
  assert.equal(fres.ok, true)
  const fafter = docs.readDoc(cwd, NS, fenced.doc.id)
  assert.match(fafter.body, new RegExp('\u0060{3}md\n## 甲\n示例\n\u0060{3}'))
  assert.match(fafter.body, /## 甲\n\n替换/)
  assert.doesNotMatch(fafter.body, /真甲/)
  assert.match(fafter.body, /## 乙\n乙/)

  // 散文：按唯一原文替换
  const prose = docs.createDoc(cwd, NS, SID, { title: '鱼鱼日记', body: '今天下雨。\n鱼鱼在窗边看雨。\n晚上吃了面。\n', tags: [], projectLabel: 'prose-test' })
  assert.equal(prose.ok, true)
  const pd = docs.readDoc(cwd, NS, prose.doc.id)
  const f1 = docs.updateDoc(cwd, NS, SID, prose.doc.id, { rev: pd.doc.rev, find: '鱼鱼在窗边看雨。', replace: '鱼鱼在窗边发呆。' })
  assert.equal(f1.ok, true)
  const p1 = docs.readDoc(cwd, NS, prose.doc.id)
  assert.match(p1.body, /发呆/)
  assert.doesNotMatch(p1.body, /看雨/)
  const miss = docs.updateDoc(cwd, NS, SID, prose.doc.id, { rev: p1.doc.rev, find: '不存在的句子', replace: 'x' })
  assert.equal(miss.ok, false)
  assert.equal(miss.code, 'find-not-found')
  const amb = docs.updateDoc(cwd, NS, SID, prose.doc.id, { rev: p1.doc.rev, find: '。', replace: '!' })
  assert.equal(amb.ok, false)
  assert.equal(amb.code, 'find-not-unique')

  // 插入新节 / 删除整节
  const ins = docs.updateDoc(cwd, NS, SID, prose.doc.id, { rev: p1.doc.rev, insertAfter: '乙', heading: '丙', body: '丙内容' })
  assert.equal(ins.ok, false) // 该文档没有 乙
  const secDoc = docs.createDoc(cwd, NS, SID, { title: '小节测试', body: '# D\n\n## 甲\nA\n\n## 乙\nB\n', tags: [], projectLabel: 'sec-test' })
  const sd = docs.readDoc(cwd, NS, secDoc.doc.id)
  const ins2 = docs.updateDoc(cwd, NS, SID, secDoc.doc.id, { rev: sd.doc.rev, insertAfter: '甲', heading: '丙', body: 'C' })
  assert.equal(ins2.ok, true)
  const s1 = docs.readDoc(cwd, NS, secDoc.doc.id)
  assert.match(s1.body, /## 甲\nA[\s\S]*## 丙\n\nC[\s\S]*## 乙\nB/)
  const rem = docs.updateDoc(cwd, NS, SID, secDoc.doc.id, { rev: s1.doc.rev, removeSection: '丙' })
  assert.equal(rem.ok, true)
  const s2 = docs.readDoc(cwd, NS, secDoc.doc.id)
  assert.doesNotMatch(s2.body, /丙/)
  assert.match(s2.body, /## 乙\nB/)
  const remMiss = docs.updateDoc(cwd, NS, SID, secDoc.doc.id, { rev: s2.doc.rev, removeSection: '不存在' })
  assert.equal(remMiss.ok, false)

  console.log('PASS doc append/section/missing/conflict/clear')
  console.log('SUMMARY doc-edit 1/1')
} finally {
  fs.rmSync(cwd, { recursive: true, force: true })
}
