import assert from 'node:assert/strict'
import { extractCaptureCandidate } from '../lib/trivia.js'

const knownTags = ['备份', '配置', '接口', '日志', '分页', '会议', '版本', '回滚']
const opts = {
  structuralOnly: true,
  excludeQuestions: true,
  requireContentTag: true,
  excludeMetaTest: true,
  maxChars: 46,
}
const shouldSkip = [
  '只要写清楚什么人地事就好了吧',
  '我测试了一个场景，我删除了中间条，但是前后两条不相干了',
  '我试了删除中间条，前后没有关联',
  '这个场景我复现了，结果还是不对',
  '我模拟了一条删除链路看看',
  '测试一下分页能不能翻',
  '你测试完把结果发我',
  '这条应该不要写进去',
  '建议自动捕获只写结构明确的',
  '如果还超，就再试一次',
  '假设我删掉中间这条',
  '举个例子，比如前后两条',
  '看起来前后两条不相干',
  '我还没确认这条是不是有效的',
  '可能这样写会好一点',
  '好的，我看看',
  '嗯，确实',
  '等一下，我先重启',
  '这个功能现在还是有问题',
  '自动捕获是不是应该有个 tag',
  '我觉得这条没有有效信息',
  '先别发版，等我看 note',
  '这版先不借鉴了',
  '我只是问一下，不是要你改',
  '你按这个思路再想想',
  '上面那条和下面那条没关系',
  '我刚才删了中间条',
  '用户说只要写清楚就行',
  '不要记录这句话',
  '我在测试自动捕获',
  '这条是误捕，删掉',
]
const shouldWrite = [
  ['测试环境备份改到凌晨四点', '备份'],
  ['生产配置改到凌晨四点', '配置'],
  ['接口 502 报错，回滚到上一版', '接口'],
]

for (const text of shouldSkip) {
  assert.equal(extractCaptureCandidate(text, knownTags, '自动捕获', opts), null, text)
}
for (const [text, tag] of shouldWrite) {
  const got = extractCaptureCandidate(text, knownTags, '自动捕获', opts)
  assert.ok(got, text)
  assert.equal(got.tags[0], tag, text)
}
console.log(`SUMMARY trivia-adversarial ${shouldSkip.length + shouldWrite.length}/${shouldSkip.length + shouldWrite.length}`)
