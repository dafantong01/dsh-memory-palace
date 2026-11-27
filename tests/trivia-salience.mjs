import assert from 'node:assert/strict'
import { assessTrivia } from '../lib/trivia.js'

const score = (s) => assessTrivia(s).importance

assert.equal(assessTrivia('今天上班真累').importance, 0)
assert.equal(assessTrivia('今天上班真累').emotion, -1)
assert.equal(score('发布前必须跑迁移脚本'), 4)
assert.equal(score('接口 502'), 5)
assert.equal(score('接口 502 报错'), 5)
assert.equal(score('从 v1 升 v2 不兼容'), 5)
assert.equal(score('备份时间从凌晨两点改到凌晨四点'), 5)
assert.equal(score('日志最多保留 7 天'), 3)
assert.equal(score('周三下午三点评审'), 1)
assert.equal(score('这个配置看起来真的很不错'), 0)
assert.equal(score('我必须睡了'), 0)
assert.equal(score('部署失败，原因是证书过期'), 5)
assert.equal(assessTrivia('部署失败，原因是证书过期').emotion, 0)
assert.ok(assessTrivia('服务挂了').importance >= 2)
assert.ok(assessTrivia('决定周五上线，回滚方案用旧镜像').importance >= 2)
console.log('SUMMARY trivia-salience 15/15')
