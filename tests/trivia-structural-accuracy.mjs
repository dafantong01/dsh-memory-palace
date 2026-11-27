import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addTrivia, hasStructuralCaptureSignal, extractCaptureCandidate, isHighRiskCapture } from '../lib/trivia.js'

const A = [
  ['s1', '把玄关的鞋摆正，换了新鞋垫，出门前顺手关了走廊的灯。', 0],
  ['s2', '楼下快递站把包裹挪到了最里面那排货架，找了三分钟。', 0],
  ['s3', '冰箱上层的酸奶还剩两盒，顺手在便签上写了日期。', 0],
  ['s4', '阳台的纱窗松了一角，用扎带临时固定了一下。', 1],
  ['s5', '晚上把米淘好泡上，定好闹钟明早六点煮粥。', 0],
  ['s6', '发现常用的那支笔没水了，翻抽屉找出同款替芯换上。', 0],
  ['s7', '小区道闸周四上午维护，那天开车进出得走人工通道。', 2],
  ['s8', '对门邻居送来一小袋自家晒的笋干，说炖汤前要先泡软。', 2],
  ['s9', '母亲打电话说舅舅家添了个男孩，让我有空回去看看。', 3],
  ['s10', '夜里接到老家电话说外婆病危，我订了最早一班车赶回去。', 10],
  ['s11', '公司组织团建改到了下周三下午，地点换到城郊的农庄。', 2],
  ['s12', '试着自己修好了台灯的接触不良，拧紧螺丝后灯就亮了。', 4],
  ['s13', '周五的汇报临时提前到周四，连夜把十几页幻灯片重排了一遍。', 5],
  ['s14', '在旧外套口袋里翻出一张百元钞，算是今天的意外之财。', 4],
  ['s15', '妹妹养的仓鼠半夜把笼门顶开，全家打手电找了半小时。', 5],
  ['s16', '隔壁单元的水管漏水，渗到我家天花板，拍照后联系房东来看。', 5],
  ['s17', '借出去的电动钻被还回来时钻头断了，对方说会赔一套新的。', 4],
  ['s18', '骑车经过路口被一辆送餐车擦到，人没事，只蹭破了裤脚。', 6],
  ['s19', '父亲血压忽然升高送去了急诊，挂了一夜水才稳住。', 9],
  ['s20', '交往三年的对象提出分手，我在楼下坐到凌晨才回家。', 9],
  ['s21', '收到一封匿名的感谢信，说去年帮忙指路的事一直记着。', 6],
  ['s22', '决定下个月搬出合租房，先去看两处单间再定。', 7],
  ['s23', '公司群里通知年底前完成安全考核，没过的要重考一次。', 6],
  ['s24', '报名了小区周末的急救培训，学完能拿到一张证书。', 5],
  ['s25', '在图书馆丢了借书卡，挂失后重新办了一张花了半小时。', 3],
]

const B = [
  ['e1', '早上出门发现楼道灯坏了，顺手把垃圾带下了楼。', 'low'],
  ['e2', '把阳台那盆薄荷挪到了窗边，浇了半杯水就出门了。', 'low'],
  ['e3', '厨房水槽下面垫了一块旧毛巾，接住偶尔渗出来的水。', 'low'],
  ['e4', '收到调岗通知，新工位在靠窗那排，下午就能搬过去。', 'medium'],
  ['e5', '抽到了周五晚上的讲座入场名额，激动得在客厅转了两圈。', 'medium'],
  ['e6', '养了两年的绿萝整盆枯了，蹲在阳台边上愣了好一会儿。', 'medium'],
  ['e7', '体检报告上有一项指标偏高，约了下周复查，心里一直悬着。', 'high'],
  ['e8', '楼上半夜拖动家具的动静又响了，忍到第三晚才去敲门提醒。', 'medium'],
  ['e9', '决定把攒下的年假一次用完，下个月报个全天的维修班。', 'high'],
  ['e10', '家里立了新规矩，晚上十点半以后手机都放在玄关充电。', 'medium'],
  ['e11', '骑车下坡时刹车有点发软，回来立刻预约了车行检查。', 'high'],
  ['e12', '燃气灶打火后闻到淡淡的味道，关了总阀再没敢开。', 'high'],
  ['e13', '泡茶时更喜欢用矮一点的杯子，握着手感比高杯舒服。', 'low'],
  ['e14', '看纸质书习惯先翻到最后看一眼结尾，再回头慢慢读。', 'low'],
  ['e15', '周末把衣柜里的冬衣翻出来，晒了一排才收回去。', 'low'],
  ['e16', '组里要求明早十点前把接口文档传到共享群，迟了要说明情况。', 'medium'],
  ['e17', '带我的前辈提醒我，接口文档最晚明天上午十点发到群里。', 'medium'],
  ['e18', '下班路上把伞忘在地铁座位上了，走到小区门口才发现。', 'low'],
  ['e19', '回家才想起伞落在车厢里，只能明天再买一把。', 'low'],
  ['e20', '楼下面包店重新开张，排队领到了第一炉的试吃小份。', 'medium'],
]

function run(name, cases, isA) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-accuracy-'))
  const cfg = { dir: root, triviaInterest: 5 }
  fs.mkdirSync(path.join(root, 'trivia'), { recursive: true })
  let tp = 0, fp = 0, tn = 0, fn = 0
  const misses = []
  const writes = []
  try {
    for (const [id, text, target] of cases) {
      const cand = hasStructuralCaptureSignal(text)
        ? extractCaptureCandidate(text, [id], 'autotest', { structuralOnly: true })
        : null
      let wrote = false
      if (cand && !cand.needsReview && !isHighRiskCapture(cand.text)) {
        const r = addTrivia(cfg, { ...cand, tags: [id], entities: [] }, { source: 'plugin', origin: 'user', structural: true })
        wrote = !!r.ok
        if (wrote) writes.push({ id, target, text: cand.text })
      }
      const expected = isA ? (target >= 2 && target <= 8) : (target !== 'low')
      if (wrote && expected) tp++
      else if (wrote && !expected) fp++
      else if (!wrote && expected) { fn++; misses.push({ id, target }) }
      else tn++
    }
    const n = cases.length
    console.log(name, JSON.stringify({
      n,
      writes: tp + fp,
      tp,
      fp,
      tn,
      fn,
      accuracy: ((tp + tn) / n * 100).toFixed(1) + '%',
      precision: tp + fp ? (tp / (tp + fp) * 100).toFixed(1) + '%' : '-',
      recall: tp + fn ? (tp / (tp + fn) * 100).toFixed(1) + '%' : '-',
      misses,
      writes,
    }))
    assert.equal(fp, 0, `${name} 不应有误直写`)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

run('A-new-25', A, true)
run('B-old-20', B, false)
console.log('SUMMARY trivia-structural-accuracy pass')
