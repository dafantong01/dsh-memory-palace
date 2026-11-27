import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recallTrivia } from '../lib/trivia.js'

const facts = [
  ['f1', '室友每晚十一点后戴上降噪耳机听广播，音量一直压在三格以内。', ['室友', '降噪耳机', '听广播']],
  ['f2', '每周三下午四点，隔壁工位的同事会去楼下空会议室打二十分钟电话。', ['周三下午', '空会议室', '打电话']],
  ['f3', '书房第二层抽屉里放着一把备用门卡，物业说只能刷地库侧门。', ['书房抽屉', '备用门卡', '地库侧门']],
  ['f4', '收纳箱最底下压着一台旧数码相机，电池仓盖用透明胶带缠了两圈。', ['收纳箱', '旧数码相机', '电池仓']],
  ['f5', '表姐不吃香菜和折耳根，点外卖时备注栏一定要写上不要葱。', ['表姐', '忌口', '外卖备注']],
  ['f6', '健身教练叮嘱过，腰伤没好之前别做硬拉，也别自己加重量。', ['健身教练', '腰伤', '硬拉']],
  ['f7', '内部周报规定周五中午十二点前提交，逾期要抄送组长并写明原因。', ['内部周报', '截止时间', '抄送组长']],
  ['f8', '测试环境的数据库每周一早上自动清空，跑用例前要先导入种子数据。', ['测试环境', '数据库', '种子数据']],
  ['f9', '如果当天下雨，楼顶晾的被单就得提前收，不然傍晚会有露水。', ['下雨天', '楼顶晾晒', '被单']],
  ['f10', '借出的折叠梯只给本层住户用，用完必须当天还回消防通道口。', ['折叠梯', '消防通道', '归还']],
  ['f11', '冰箱冷冻层第二格归我放速冻饺子，谁也别往里塞别的东西。', ['冷冻层', '速冻饺子', '占位']],
  ['f12', '室友说冷冻层第二格本来就是公用的，谁想放都行。', ['冷冻层', '公用', '室友']],
]
const queries = [
  ['我室友晚上戴耳机听东西，音量一般开到多大？', ['f1']],
  ['周三下午那个同事平时躲到哪儿打电话？', ['f2']],
  ['那把备用门卡我放哪了，能刷哪扇门来着？', ['f3']],
  ['收纳箱底下那台旧相机，电池盖是不是坏过？', ['f4']],
  ['表姐点外卖有什么忌口要写进备注？', ['f5']],
  ['教练说我腰没好之前不能练哪个动作？', ['f6']],
  ['周报和测试库这两块，时间上分别有什么硬性要求？', ['f7', 'f8']],
  ['下雨天楼顶晒的东西要怎么办？', ['f9']],
  ['折叠梯借出去之后什么时候必须还回来？', ['f10']],
  ['冷冻层第二格我到底能不能放速冻饺子？', ['f11', 'f12']],
  ['附近有没有修手表的店？', []],
  ['明天出门穿什么衣服合适？', []],
  ['豆浆机那个滤网怎么拆下来洗？', []],
  ['这个月电费大概多少钱？', []],
  ['周末那个展览的票在哪儿买？', []],
]

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-recall-blind-'))
const cfg = { dir: root }
const dir = path.join(root, 'trivia')
fs.mkdirSync(dir, { recursive: true })
const rows = facts.map(([id, text, tags], i) => ({
  id, text, tags,
  createdAt: `2026-11-${10 + i}T00:00:00.000Z`,
  updatedAt: `2026-11-${10 + i}T00:00:00.000Z`,
  lastAccessAt: '', hits: 0, pendingReview: false, reviewDeadline: '',
  expiresAt: '2027-02-01T00:00:00.000Z',
}))
fs.writeFileSync(path.join(dir, 'index.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')

try {
  let extras = 0
  for (const [q, expect] of queries) {
    const got = recallTrivia(cfg, q, { limit: 3 })
    const ids = got.map((x) => x.id)
    for (const id of expect) assert.ok(ids.includes(id), `${q} 应命中 ${id}，实际 ${ids.join(',')}`)
    extras += ids.filter((id) => !expect.includes(id)).length
  }
  assert.equal(extras, 0, `不应有额外召回，实际 ${extras} 条`)
  console.log('SUMMARY trivia-recall-blind 15/15 noise=0')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
