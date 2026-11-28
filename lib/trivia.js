/**
 * 杂事随记：存储层。
 *
 * 目录：<命名空间>/trivia/
 *   index.jsonl        一行一条
 *   .triviatrash/      到期/复审超时条目（保留 30 天）
 *
 * 并发：调用方负责 withSessionWriteLock；本模块只做同步文件操作。
 * 访问强化：recordAccess 只改 hits/lastAccessAt/expiresAt，不动 createdAt/updatedAt。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  MAX_TEXT_CHARS, MAX_TAGS, MAX_TAG_CHARS,
  expiryAt, classifyExpiry, isLongLived, reviewDeadline, reviewOverdue, TRASH_DAYS, RECENT_READ_DAYS, renewalDays,
} from './trivia-age.js'
import { synonymsOf } from './recall-terms.js'
import { stemEnglishPhrase } from './en-stemmer.js'

const TRIVIA_DIR = 'trivia'
const INDEX_FILE = 'index.jsonl'
const TRASH_DIR = '.triviatrash'
const META_FILE = 'meta.json'
const TRIVIA_SCHEMA = 2
export const TRIVIA_SALIENCE_MAX = 9
export const TRIVIA_SCORE_REVIEW = 70
export const TRIVIA_SCORE_DIRECT = 40
export const TRIVIA_IMPORTANCE_DIRECT = 6

/** 泛词表：公开中文停用词 + 人工补充的泛化描述词。 */
function loadWordSet(rel) {
  const set = new Set()
  try {
    const text = fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
    for (const line of text.split('\n')) {
      const w = line.trim()
      if (!w || w.startsWith('#')) continue
      set.add(w.toLowerCase())
    }
  } catch { /* 缺文件时退化为空表，不影响写入 */ }
  return set
}

function loadAfinn() {
  try {
    return JSON.parse(fs.readFileSync(new URL('../data/afinn.zh.json', import.meta.url), 'utf8'))
  } catch {
    return {}
  }
}

/** 用近义词并查集把情绪词按同一组去重。 */
function buildEmotionGroups() {
  const positive = new Set(EMOTION_POSITIVE_BASE)
  const negative = new Set(EMOTION_NEGATIVE_BASE)
  for (const [word, score] of Object.entries(AFINN_ZH)) {
    if (typeof word !== 'string' || word.trim().length < 2) continue
    const n = Number(score)
    if (!word || !Number.isFinite(n) || n === 0) continue
    if (n > 0) positive.add(word)
    else negative.add(word)
  }
  const parent = new Map()
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x)
    let p = parent.get(x)
    while (p !== parent.get(p)) p = parent.get(p)
    while (x !== p) {
      const next = parent.get(x)
      parent.set(x, p)
      x = next
    }
    return p
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  const hand = new Set([...EMOTION_POSITIVE_BASE, ...EMOTION_NEGATIVE_BASE])
  const add = (word, set) => {
    if (typeof word !== 'string') return
    const w = word.trim()
    if ((w.length < 2 && !hand.has(w)) || w.length > 16) return
    set.add(w)
    for (const syn of synonymsOf(w)) {
      const s = String(syn || '').trim()
      if ((s.length < 2 && !hand.has(s)) || s.length > 16) continue
      set.add(s)
      union(w, s)
    }
  }
  for (const w of [...positive]) add(w, positive)
  for (const w of [...negative]) add(w, negative)
  const groups = (set) => {
    const map = new Map()
    for (const word of set) {
      const root = find(word)
      if (!map.has(root)) map.set(root, [])
      map.get(root).push(word)
    }
    return [...map.values()].filter((terms) => terms.some((w) => w.length > 0))
  }
  return { positive: groups(positive), negative: groups(negative) }
}

const GENERIC_TAG_WORDS = loadWordSet('../data/stopwords.zh.txt')
for (const w of loadWordSet('../data/generic-tags.zh.txt')) GENERIC_TAG_WORDS.add(w)
for (const w of loadWordSet('../data/stopwords.en.txt')) GENERIC_TAG_WORDS.add(w)

const nowIso = () => new Date().toISOString()

export function triviaDirFor(cfg) {
  return path.join(cfg.dir, TRIVIA_DIR)
}

function indexFileFor(cfg) {
  return path.join(triviaDirFor(cfg), INDEX_FILE)
}

function trashDirFor(cfg) {
  return path.join(triviaDirFor(cfg), TRASH_DIR)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 6)}`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

function tagStems(t) {
  const base = String(t || '').toLowerCase()
  const out = new Set([base])
  const noSuffix = base.replace(/(吗|呢|吧|啊|呀|哦|嗯|哈|啦|嘛|呗|咯|了|着|过|的|地|得)+$/g, '')
  out.add(noSuffix)
  const noPrefix = noSuffix.replace(/^(很|太|挺|超|好|真|特别|非常)+/g, '')
  out.add(noPrefix)
  return [...out].filter(Boolean)
}

// 只用于匹配已有内容 tag，不做历史数据改标签。
function canonicalTagText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(?<=[\p{Script=Han}])[了着过](?=[\p{Script=Han}])/gu, '')
    .replace(/(吗|呢|吧|啊|呀|哦|嗯|哈|啦|嘛|呗|咯)+$/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function tagVariantRegex(tag) {
  const chars = [...canonicalTagText(tag)]
  if (chars.length < 2) return null
  const escaped = chars.map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(escaped.join('(?:了|着|过)?'), 'u')
}

// 纯功能词/补语 tag 直接拒绝；含实词的“看完/坐飞机”不误伤。
const PURE_FUNCTION_TAG = /^(?:[了着过的地得吗呢吧啊呀哦嗯哈啦嘛呗咯]|[完好到住上下]|起来|下去|出来|过来|过去|看看|试试)+$/u
const LATIN_TAG = /^[a-z][a-z' -]*$/i

/** 判断一个已知 tag 是否命中文本：先归一化，再精确、近义词、严格变形正则。 */
export function tagMatchesText(tag, text) {
  const rawTag = String(tag || '').trim()
  if (LATIN_TAG.test(rawTag)) {
    const target = stemEnglishPhrase(rawTag).split(' ').filter(Boolean)
    const words = stemEnglishPhrase(text).split(' ').filter(Boolean)
    if (!target.length || !words.length) return false
    if (target.length === 1) return words.includes(target[0])
    for (let i = 0; i <= words.length - target.length; i++) {
      if (target.every((w, j) => words[i + j] === w)) return true
    }
    return false
  }
  const t = canonicalTagText(tag)
  const s = canonicalTagText(text)
  if (!t || !s) return false
  if (s.includes(t)) return true
  for (const synonym of synonymsOf(t)) {
    const v = canonicalTagText(synonym)
    if (v && s.includes(v)) return true
  }
  const variant = tagVariantRegex(tag)
  return Boolean(variant && variant.test(s))
}

export function normalizeTriviaTags(tags, knownTags = []) {
  if (tags === undefined || tags === null) return { ok: true, tags: [] }
  if (!Array.isArray(tags)) return { ok: false, error: 'tags 必须是数组' }
  const known = Array.isArray(knownTags) ? knownTags.filter((t) => typeof t === 'string' && t.trim()) : []
  const out = []
  for (const raw of tags) {
    let t = String(raw ?? '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (t.length > MAX_TAG_CHARS) return { ok: false, error: `单个 tag 不能超过 ${MAX_TAG_CHARS} 字：${t}` }
    if (!/[\p{L}\p{N}]/u.test(t)) return { ok: false, error: `tag 不能只有标点/空白：${t}` }
    if (/^\d+$/.test(t)) return { ok: false, error: `tag 不能是纯数字：${t}` }
    if (/[,，]/.test(t)) return { ok: false, error: `tag 不能含逗号：${t}` }
    if (/[你我他她它您咱]/.test(t)) return { ok: false, error: `tag 不要带人称代词：${t}` }
    if (/(吗|呢|吧|啊|呀|哦|嗯|哈|啦|嘛)$/.test(t)) return { ok: false, error: `tag 不要用语气词：${t}` }
    if (PURE_FUNCTION_TAG.test(t)) return { ok: false, error: `tag 不能是纯功能词/补语：${t}` }
    const stems = tagStems(t)
    if (stems.some((s) => GENERIC_TAG_WORDS.has(s))) {
      return { ok: false, error: `tag 太泛，换更具体的词：${t}` }
    }
    for (const k of known) {
      if (tagMatchesText(k, t) || tagMatchesText(t, k)) { t = k; break }
    }
    if (!out.includes(t)) out.push(t)
  }
  if (out.length > MAX_TAGS) return { ok: false, error: `最多 ${MAX_TAGS} 个 tag` }
  return { ok: true, tags: out }
}

export function validateTriviaText(text, maxChars = MAX_TEXT_CHARS) {
  if (typeof text !== 'string') return { ok: false, error: 'text 必须是字符串' }
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return { ok: false, error: 'text 不能为空' }
  if (t.length > maxChars) return { ok: false, error: `杂事条目不能超过 ${maxChars} 字` }
  return { ok: true, text: t }
}

const EMOTION_POSITIVE_BASE = ['开心', '高兴', '喜欢', '可爱', '感谢', '放心', '成功', '解决', '修复', '惊喜', '期待', '满意', '舒服', '厉害', '优秀', '爱', '赞', '棒', '爽', '安心', '激动', '兴奋', '得意', '温暖']
const EMOTION_NEGATIVE_BASE = ['难过', '生气', '烦', '焦虑', '担心', '害怕', '疼', '痛', '后悔', '失望', '糟', '坏', '累', '压力', '讨厌', '恶心', '愤怒', '悬', '慌', '愣', '枯', '忍', '发软']
const AFINN_ZH = loadAfinn()
const IMPORTANCE_BASE = ['过敏', '医院', '药', '总阀', '刹车', '报警', '风险', '危险', '急诊', '病危', '手术']
const CORE_INTENT_RE = /(记(得|住|着)|别忘(了)?|提醒(我|一下)?|以后都|从现在起|长期记忆|关键记忆|热核|核心记忆|用户画像|身份|称呼|叫我|铁律|规则)/u

/** 判定内容是否应进入四大热核，而不是会过期的杂事。 */
export function looksLikeCoreMemory(text) {
  return CORE_INTENT_RE.test(String(text || ''))
}

// 复用 data/synonyms.v1.json.gz，不手写几万词；只做有限扩展。
function expandLexicon(words) {
  const out = new Set(words)
  for (const w of words) {
    for (const s of synonymsOf(w)) {
      if (typeof s === 'string' && s.length >= 1 && s.length <= 12) out.add(s)
    }
  }
  return [...out]
}

const EMOTION_POSITIVE = expandLexicon(EMOTION_POSITIVE_BASE)
const EMOTION_NEGATIVE = expandLexicon(EMOTION_NEGATIVE_BASE)
const EMOTION_GROUPS = buildEmotionGroups()
const IMPORTANCE_WORDS = expandLexicon(IMPORTANCE_BASE)

const countHits = (text, words) => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0)
function emotionTokens(text) {
  const out = new Set()
  try {
    for (const part of new Intl.Segmenter('zh', { granularity: 'word' }).segment(String(text || ''))) {
      if (part.isWordLike && part.segment) out.add(String(part.segment).toLowerCase())
    }
  } catch { /* 无分词时退化为整段 */ }
  if (!out.size && text) out.add(String(text).toLowerCase())
  return out
}
const countEmotionGroups = (tokens, groups) => groups.reduce((n, terms) => {
  return n + (terms.some((w) => [...tokens].some((t) => t === w || t.includes(w))) ? 1 : 0)
}, 0)
const clampInt = (n, min, max) => Math.min(Math.max(Math.round(n), min), max)

/** 高精度事件词：只收多字、可指认具体事情；不把“换/修/取/送”这类单字动词算事件。 */
const EVENT_SIGNAL = /(复查|复诊|急诊|手术|体检|面试|签合同|签约|结婚|领证|离婚|搬家|房租|续租|维修|维护|安装|迁移|报名|考试|考核|汇报|例会|评审|开会|上线|发布|付款|缴费|续费|到期|挂失|报警|漏水|漏气|故障|培训|出差|航班|改签|入职|辞职|退休|住院|出院|接种|产检|家长会|开学|毕业|答辩|婚礼|葬礼|添丁|分手|和好|发烧|清洗)/u
const ROLE_SIGNAL = /(父亲|母亲|爸爸|妈妈|孩子|儿子|女儿|伴侣|对象|丈夫|妻子|男友|女友|房东|邻居|同事|领导|老板|师傅|医生|护士|老师|同学|弟弟|妹妹|哥哥|姐姐|爷爷|奶奶|外婆|外公|舅舅|姑姑|阿姨|朋友)/u

function eventSignal(t) {
  if (!EVENT_SIGNAL.test(t)) return 0
  return ROLE_SIGNAL.test(t) ? 2 : 1
}

/** 内部显著性评估；不暴露给用户，只用于写入门控和能力记录。 */
/** 结构证据分桶；同桶取最高，桶间相加后封顶 8；旧词表不再重复计结构触发词。 */
function structuralImportance(t) {
  const time = /(\d{1,2}\s*[:：]\d{2}|\d{1,2}\s*点|周[一二三四五六日天]|下周[一二三四五六日天]?|周末|下个月|今天|明天|后天|月底|年底|截止|逾期|之前|前)/u
  const event = /(开会|评审|上线|发布|同步|培训|面试|体检|提交|交报告|截止|报名|维修|维护|安装|迁移|备份|重启|约|见面|到期|续费|付款|缴费|例会|汇报|考试|考核|检查|复查|手术|急诊|取|送|还|搬|换|修|丢|挂失|报名)/u
  const change = /(?:从?.{0,16}?(?:改|换|调|移|推迟|提前)(?:到|成|为)|把.{1,16}(?:改|换|调|移)(?:到|成|为))/u
  const error = /(报错|错误|异常|失败|崩了|挂了|超时|拒绝|找不到|不兼容|权限不足|OOM|timeout|error|failed|exception)/iu
  const http = /(?:接口|服务|请求|响应).{0,12}(?:4\d{2}|5\d{2})/iu
  const state = /(漏水|漏气|断电|跳闸|故障|停机|宕机|锁死|丢失|泄露|过期|到期|断网|卡死|崩溃|恢复|修好|重启|重装|丢了|挂失|断了|顶开|擦到)/u
  const numeric = /(最多|至少|不超过|不少于|上限|下限|封顶|超过|低于|高于).{0,12}?(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万两半]+)\s*(?:天|小时|分钟|秒|次|个|条|GB|MB|KB|%|元|块|人|页|行|字|岁|度|件|台|份)/iu
  const version = /(?:从\s*v?\d+(?:\.\d+){0,3}\s*(?:升|降|回滚|切)(?:到|至)\s*v?\d+(?:\.\d+){0,3}|(?:升级|降级|回滚)(?:到|至)\s*v?\d+(?:\.\d+){0,3}|v?\d+(?:\.\d+){1,3}\s*(?:版本)?\s*(?:不兼容|兼容|废弃|移除|弃用))/iu
  const decision = /(决定|定了|确定|拍板|选|采用|放弃|回滚|切换).{0,30}(\d|今天|明天|下周|周末|下个月|月底|年底|v?\d+\.\d+|方案|镜像|接口|端口|版本|地址|时间|地点)/iu
  const rule = /(?:发布前|上线前|每次|以后|之后|所有|任何|每周|每日)?\s*(?:必须|务必|一定要|不能|不得|禁止|严禁|只能|不要|别再|不许|都要)\s*([^，。；\n]{2,40})/u
  const ruleScope = /(发布|上线|每次|以后|之后|所有|任何|迁移|部署|备份|删除|日志|测试|权限|接口|配置|数据|文件|账号|端口|版本|环境|流程|脚本|数据库)/u
  const dependency = /(卡在|阻塞|依赖|受限于|等着|等|被)[^。；\n]{2,24}(审批|确认|证书|接口|权限|资源|预算|回复|上线|发布|合并|测试|部署|排期|人力|服务|联调|验收)/u
  const exception = /(除了|除非|只有|只要)[^。；\n]{2,24}(才|就|都|否则|不然|能|可以|必须)[^。；\n]{2,30}/u
  const periodic = /(每天|每日|每周[一二三四五六日天]?|每月\d{1,2}[日号]?|每\d+\s*(?:天|小时|分钟|周|月)).{0,24}(?:\d{1,2}\s*[点时]|备份|同步|重启|检查|清理|发布|报表|会议|维护)/u
  const assigned = /(?:由|交给|指派|安排|找|联系)\s*(?!我|你|他|她|它|我们|你们|他们|她们|大家|自己|公司|部门|客服|对方)[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_.\-]{1,15}\s*(?:负责|处理|跟进|对接|确认|完成|来|去)/u
  const hasError = error.test(t) || http.test(t)
  const a = Math.min(5, Math.max(hasError ? 5 : 0, state.test(t) ? 3 : 0, dependency.test(t) ? 2 : 0))
  const b = Math.min(5, Math.max(change.test(t) ? 5 : 0, version.test(t) ? 5 : 0))
  const c = Math.min(4, Math.max(rule.test(t) && ruleScope.test(t) ? 4 : 0, /(截止|逾期|之前|前提交)/u.test(t) ? 3 : 0, time.test(t) && event.test(t) ? 1 : 0))
  const d = Math.min(3, numeric.test(t) ? 3 : 0)
  const e = Math.min(2, Math.max(decision.test(t) ? 2 : 0, exception.test(t) || periodic.test(t) || assigned.test(t) ? 1 : 0))
  const lexical = Math.min(4, countHits(t, IMPORTANCE_WORDS) * 2)
  return Math.min(10, Math.min(8, a + b + c + d + e) + lexical)
}

export function assessTrivia(text) {
  const t = String(text || '').toLowerCase()
  const tokens = emotionTokens(t)
  const positive = countEmotionGroups(tokens, EMOTION_GROUPS.positive)
  const negative = countEmotionGroups(tokens, EMOTION_GROUPS.negative)
  const emotion = clampInt(positive - negative, -10, 10)
  const importance = clampInt(structuralImportance(t), 0, 10)
  const eventScore = eventSignal(t)
  const baseScore = Math.round(60 * (importance / 10) + 40 * ((10 * (1 - Math.exp(-(positive + negative) / 2))) / 10))
  const eventApplied = eventScore > 0
  const effectiveImportance = eventApplied ? Math.min(10, importance + eventScore) : importance
  const arousal = Math.min(10, positive + negative)
  const emotionIntensity = 10 * (1 - Math.exp(-(positive + negative) / 2))
  const score = baseScore
  const salience = Math.min(20, Math.round(score / 5))
  return { positive, negative, emotion, importance, eventScore, eventApplied, effectiveImportance, baseScore, arousal, emotionIntensity, score, salience, salience100: score }
}

function normalizeEntityList(value) {
  const list = Array.isArray(value) ? value : []
  const out = []
  for (const raw of list) {
    const s = String(raw || '').trim()
    if (s.length < 1 || s.length > 32) continue
    if (!out.includes(s)) out.push(s)
    if (out.length >= 10) break
  }
  return out
}

function textKey(text) {
  return String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function textBigrams(text) {
  const s = textKey(text)
  if (!s) return new Set()
  if (s.length === 1) return new Set([s])
  const out = new Set()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

function textSimilarity(a, b) {
  const ka = textKey(a)
  const kb = textKey(b)
  if (!ka || !kb) return 0
  if (ka === kb) return 1
  const A = textBigrams(ka)
  const B = textBigrams(kb)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

const FILLER_RE = /(很|太|真|超级|超|特别|非常|咋|这么|那么|呢|了|的|我|你|他|她|今天|昨天|明天|小|大|猛|乖巧)/g
const PRAISE_RE = /(可爱|喜欢|爱你|好棒|厉害|萌|漂亮|帅|乖)/u
const NEGATION_RE = /(不|没|别|勿|无)/u
const FOOD_RE = /(吃|喝|干|炫|吞|嚼|做饭|下厨)/u
// 只共享这些词不足以判重，避免“A 工程档案 / B 金融档案”被当成同一件事。
const GENERIC_RELATION_TAGS = new Set(['项目', '档案', '任务', '工作', '文件', '下午', '上午', '今天', '明天', '时间', '提醒', '交代', '交付', '安排', '事情', '笔记', '记录'])

function canonicalText(text) {
  let s = textKey(text)
  s = s.replace(FILLER_RE, '')
  s = s.replace(/(.)\1+/gu, '$1')
  return s
}

function foodCore(text) {
  let s = textKey(text)
  s = s.replace(FILLER_RE, '')
  s = s.replace(/(吃|喝|干|炫|吞|嚼|过|着)/g, '')
  s = s.replace(/(.)\1+/gu, '$1')
  return s
}

function ruleSimilarity(a, b) {
  const ca = canonicalText(a)
  const cb = canonicalText(b)
  if (ca && ca === cb) return 1
  if (PRAISE_RE.test(a) && PRAISE_RE.test(b) && NEGATION_RE.test(a) === NEGATION_RE.test(b)) return 0.95
  if (FOOD_RE.test(a) && FOOD_RE.test(b)) {
    const fa = foodCore(a)
    const fb = foodCore(b)
    if (fa && fa === fb) return 0.95
  }
  return 0
}

/** 高风险/强情绪事件不自动直写，交候选或模型判断。 */
export function isHighRiskCapture(text) {
  return /(病危|急诊|抢救|手术|住院|复查|去世|癌症|分手|离婚|事故|报警|自杀|流产|大出血|骨折|昏迷)/u.test(String(text || ''))
}

/** 只从名字谓词/称呼/@/句首说话人/引号名抓明确实体；不从普通主宾猜。 */
export function extractExplicitEntities(text) {
  const raw = String(text || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '')
  if (!raw) return []
  const out = []
  const bad = /^(?:我|你|您|他|她|它|我们|你们|他们|她们|咱们|大家|自己|本人|对方|谁|有人|某人|别人|人家|这个|那个|什么|这里|那里|今天|明天|昨天|现在|公司|部门|客服|对方)$/u
  const looksLikeValue = (s) => /^(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.\w+|[A-Za-z]:\\|\/[\w./-]+|v?\d+(?:\.\d+)+$)/i.test(s)
  const add = (value) => {
    let s = String(value || '').trim().replace(/^[「“"']|[」”"']$/g, '').replace(/[，,。！？；;：:]+$/g, '').trim()
    s = s.replace(/^[@＠]/, '').trim()
    if (!s || s.length > 32 || bad.test(s) || looksLikeValue(s)) return
    if (/[\n]/.test(s)) return
    if (!out.includes(s)) out.push(s)
  }

  const named = /(?:我(?:的)?(?:名字|网名|昵称|ID|账号)(?:叫|是|：|:)|(?:网名|昵称|外号|绰号|花名)(?:叫|是|：|:)?|称呼我为?|喊我)\s*[：:]?\s*([^\n。！？；;，,]{1,32})/giu
  for (const m of raw.matchAll(named)) add(m[1])

  const at = /(?<![\w.+\-/=])[@＠]([A-Za-z0-9_\u4e00-\u9fff]{2,32})/gu
  for (const m of raw.matchAll(at)) {
    const v = m[1]
    if (/^(?:all|here|everyone)$/i.test(v)) continue
    add(v)
  }

  const quotedNamed = /(?:网名|昵称|外号|绰号|名字|称呼)[^「“"'\n]{0,12}[「“"']([^」”"'\n]{1,32})[」”"']/gu
  for (const m of raw.matchAll(quotedNamed)) add(m[1])

  const speaker = /(?:^|[。！？；;\n])\s*([\u4e00-\u9fff]{2,12}|@[A-Za-z0-9_\u4e00-\u9fff]{2,32}|[「“"'][^」”"'\n]{1,32}[」”"'])\s*(?:说|问|告诉|交代|提醒|通知|回复|喊|讲|提到|补充|强调|透露|承认|否认|解释|表示|指出)/gu
  for (const m of raw.matchAll(speaker)) {
    const v = String(m[1]).replace(/^[「“"']|[」”"']$/g, '')
    if (/^(?:今天|昨天|明天|现在|刚才|后来|最后|首先|另外|其实|所以|但是|不过|而且|因此|据说|听说|传说)$/u.test(v)) continue
    add(v)
  }
  const assigned = /(?:由|交给|指派|安排|找|联系)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_.\-]{1,15})\s*(?:负责|处理|跟进|对接|确认|完成|来|去)/gu
  for (const m of raw.matchAll(assigned)) add(m[1])
  return normalizeEntityList(out)
}
/** 自动捕获结构分：谓词框架 + 具体论元；单个时间/名词不算信号。 */
export function structuralScore(text) {
  const s = String(text || '').normalize('NFKC')
  if (!s) return 0
  const time = /(\d{1,2}\s*[:：]\d{2}|\d{1,2}\s*点|周[一二三四五六日天]|下周[一二三四五六日天]?|周末|下个月|今天|明天|后天|月底|年底|截止|逾期|之前|前)/u
  const event = /(开会|评审|上线|发布|同步|培训|面试|体检|提交|交报告|截止|报名|维修|维护|安装|迁移|备份|重启|约|见面|到期|续费|付款|缴费|例会|汇报|考试|考核|检查|复查|手术|急诊|取|送|还|搬|换|修|丢|挂失|报名)/u
  const change = /(?:从?.{0,16}?(?:改|换|调|移|推迟|提前)(?:到|成|为)|把.{1,16}(?:改|换|调|移)(?:到|成|为))/u
  const error = /(报错|错误|异常|失败|崩了|挂了|超时|拒绝|找不到|不兼容|权限不足|OOM|timeout|error|failed|exception)/iu
  const errorSpecific = /([A-Z]{2,}\d*|\d{2,5}\s*(?:ms|s|秒|分钟)|原因|因为|由于|根因|导致|影响|修复|回滚|重启|端口|证书|配置|日志|路径|接口|服务|进程|内存|磁盘)/iu
  const state = /(漏水|漏气|断电|跳闸|故障|停机|宕机|锁死|丢失|泄露|过期|到期|断网|卡死|崩溃|恢复|修好|重启|重装|丢了|挂失|断了|顶开|擦到)/u
  const numeric = /(最多|至少|不超过|不少于|上限|下限|封顶|超过|低于|高于).{0,12}?(?:\d+(?:\.\d+)?|[一二三四五六七八九十百千万两半]+)\s*(?:天|小时|分钟|秒|次|个|条|GB|MB|KB|%|元|块|人|页|行|字|岁|度|件|台|份)/iu
  const version = /(?:从\s*v?\d+(?:\.\d+){0,3}\s*(?:升|降|回滚|切)(?:到|至)\s*v?\d+(?:\.\d+){0,3}|(?:升级|降级|回滚)(?:到|至)\s*v?\d+(?:\.\d+){0,3}|v?\d+(?:\.\d+){1,3}\s*(?:版本)?\s*(?:不兼容|兼容|废弃|移除|弃用))/iu
  const decision = /(决定|定了|确定|拍板|选|采用|放弃|回滚|切换).{0,30}(\d|今天|明天|下周|周末|下个月|月底|年底|v?\d+\.\d+|方案|镜像|接口|端口|版本|地址|时间|地点)/iu
  const rule = /(?:发布前|上线前|每次|以后|之后|所有|任何|每周|每日)?\s*(?:必须|务必|一定要|不能|不得|禁止|严禁|只能|不要|别再|不许|都要)\s*([^，。；\n]{2,40})/u
  const ruleScope = /(发布|上线|每次|以后|之后|所有|任何|迁移|部署|备份|删除|日志|测试|权限|接口|配置|数据|文件|账号|端口|版本|环境|流程|脚本|数据库)/u
  const dependency = /(卡在|阻塞|依赖|受限于|等着|等|被)[^。；\n]{2,24}(审批|确认|证书|接口|权限|资源|预算|回复|上线|发布|合并|测试|部署|排期|人力|服务|联调|验收)/u
  const exception = /(除了|除非|只有|只要)[^。；\n]{2,24}(才|就|都|否则|不然|能|可以|必须)[^。；\n]{2,30}/u
  const periodic = /(每天|每日|每周[一二三四五六日天]?|每月\d{1,2}[日号]?|每\d+\s*(?:天|小时|分钟|周|月)).{0,24}(?:\d{1,2}\s*[点时]|备份|同步|重启|检查|清理|发布|报表|会议|维护)/u
  const assigned = /(?:由|交给|指派|安排|找|联系)\s*(?!我|你|他|她|它|我们|你们|他们|她们|大家|自己|公司|部门|客服|对方)[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_.\-]{1,15}\s*(?:负责|处理|跟进|对接|确认|完成|来|去)/u
  let score = 0
  if (change.test(s)) score += 5
  if (error.test(s) && errorSpecific.test(s)) score += 5
  if (state.test(s) && /[\u4e00-\u9fff]{2,}/u.test(s)) score += 3
  if (numeric.test(s)) score += 4
  if (version.test(s)) score += 4
  if (decision.test(s)) score += 2
  if (time.test(s) && event.test(s)) score += 3
  if (rule.test(s) && ruleScope.test(s)) score += 2
  if (dependency.test(s)) score += 2
  if (exception.test(s)) score += 2
  if (periodic.test(s)) score += 2
  if (assigned.test(s)) score += 2
  return score
}

export function isCaptureQuestion(text) {
  return /[?？]\s*$|(是不是|是否|怎么|为什么|哪一?个|多少|多久|什么|谁|哪里|如何|能不能|可不可以|吗|呢)/u.test(String(text || ''))
}

/** 明确的测试/元话语，不进候选；测试环境、测试数据等实体事实不受影响。 */
export function isCaptureMetaTest(text) {
  return /(测试一下|测试一句|测试场景|模拟场景|看这句|能不能记住|请忽略|不用记|刚才那句是测试)/u.test(String(text || ''))
}

export function hasStructuralCaptureSignal(text) {
  return structuralScore(text) > 0
}

/** 插件后捕获：挑一条高信号“关键段”，不复制整轮；超过 50 字标记 needsReview 交给模型压缩。 */
export function extractCaptureCandidate(text, knownTags = [], fallbackTag = '自动捕获', opts = {}) {
  const raw = String(text || '')
  if (!raw) return null
  const signal = /(发现|根因|修复|踩坑|决定|风险|注意|必须|不能|错误|失败|结论|配置|备份|截止|规则|安全|隐患|问题|方案|取舍|bug|fix|error)/i
  const skip = /(记忆宫殿|测试召回|晚安|好的|可以|建议|如果|比如|下一步|总结|我会|我建议|你说得对|谢谢|TODO)/i
  const metaTest = /(测试了?一个?场景|测试场景|模拟场景)/u
  const lead = /^(但是|不过|然后|其实|就是说|另外|所以|而且|现在|刚刚|我觉得|我发现|我们|你|这个|那个|有一个要注意的点)[，,：:\s]*/u
  const structuralOnly = opts.structuralOnly === true
  const excludeQuestions = opts.excludeQuestions === true
  const excludeContextDependent = opts.excludeContextDependent === true
  const requireContentTag = opts.requireContentTag === true
  const excludeMetaTest = opts.excludeMetaTest === true
  const maxChars = Math.min(MAX_TEXT_CHARS, Math.max(8, Number(opts.maxChars) || MAX_TEXT_CHARS))
  const contextDependent = /(这句|这条|这件事|这个|那个|它|该|此|上面|下面|前面|后面|刚才|刚刚|这样|那样|这么|那么|只要.{0,40}(?:就好|就行|即可|就可以了))/u
  const clauses = raw
    .split(/[。！？!?；;，,\n]+/)
    .map((s) => s.replace(/^[#>*\-\s]+/, '').replace(lead, '').trim())
    .filter(Boolean)
  let best = null
  for (const clause of clauses) {
    if (clause.length < 8 || clause.length > 140) continue
    if (skip.test(clause) || (excludeMetaTest && metaTest.test(clause))) continue
    if (excludeContextDependent && contextDependent.test(clause)) continue
    if (excludeQuestions && isCaptureQuestion(clause)) continue
    if (!structuralOnly && !signal.test(clause)) continue
    if (structuralOnly) {
      const score = structuralScore(clause)
      if (score <= 0) continue
      const tags = knownTags.filter((t) => String(t).length >= 2 && tagMatchesText(t, clause)).slice(0, 2)
      if (!tags.length && requireContentTag) continue
      const outTags = tags.length ? tags : [fallbackTag]
      const row = clause.length <= maxChars
        ? { text: clause, tags: outTags, needsReview: false, score }
        : { text: clause.slice(0, maxChars), tags: outTags, needsReview: true, raw: clause.slice(0, 200), score }
      if (!best || row.score > best.score || (row.score === best.score && row.text.length < best.text.length)) best = row
      continue
    }
    const tags = knownTags.filter((t) => String(t).length >= 2 && tagMatchesText(t, clause)).slice(0, 2)
    if (!tags.length && requireContentTag) return null
    const outTags = tags.length ? tags : [fallbackTag]
    if (clause.length <= maxChars) return { text: clause, tags: outTags, needsReview: false }
    return { text: clause.slice(0, maxChars), tags: outTags, needsReview: true, raw: clause.slice(0, 200) }
  }
  if (best) {
    const { score, ...rest } = best
    return rest
  }
  return null
}
/** 在已有 tag 池里为一个候选找精确/近义匹配，不写库。 */
export function matchTagPool(candidate, tags, limit = 3) {
  const c = String(candidate || '').trim()
  if (!c || !Array.isArray(tags)) return []
  const exact = String(c).toLowerCase()
  const out = []
  for (const item of tags) {
    const name = typeof item === 'string' ? item : String(item?.name || '')
    if (!name) continue
    const hit = String(name).toLowerCase() === exact
      ? 'exact'
      : (tagMatchesText(name, c) || tagMatchesText(c, name) ? 'near' : '')
    if (!hit) continue
    out.push({
      tag: name,
      kind: hit,
      rank: Number(item?.rank) || 0,
      count: Number(item?.count) || 0,
    })
    if (out.length >= limit) break
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.rank - a.rank : a.kind === 'exact' ? -1 : 1))
}

/** 从文本中提一个具体词作为新 tag；优先显式实体，再用分词，最后用英文词。 */
export function suggestCaptureTag(text) {  const raw = String(text || '').trim()
  if (!raw) return ''
  const explicit = extractExplicitEntities(raw)
  for (const name of explicit) {
    const n = String(name || '').trim().slice(0, 16)
    if (n && normalizeTriviaTags([n]).ok) return n
  }
  const stop = new Set(['今天', '明天', '后天', '昨天', '上午', '下午', '晚上', '凌晨', '早上', '中午', '现在', '刚才', '时候', '一个', '这个', '那个', '我们', '你们', '他们', '自己', '东西', '事情', '情况', '问题'])
  const usable = (word) => {
    const w = String(word || '').trim()
    if (w.length < 2 || w.length > 16) return false
    if (stop.has(w)) return false
    if (/^\d+$/u.test(w)) return false
    if (/[的了着过吗呢吧啊呀哦嗯哈啦嘛]$/u.test(w)) return false
    return normalizeTriviaTags([w]).ok
  }
  try {
    const seg = new Intl.Segmenter('zh', { granularity: 'word' })
    for (const part of seg.segment(raw)) {
      if (!part.isWordLike) continue
      const w = String(part.segment || '').trim()
      if (/^[A-Za-z][A-Za-z' -]{1,15}$/u.test(w)) {
        if (usable(w)) return w
      } else if (usable(w)) {
        return w
      }
    }
  } catch { /* 无 Intl.Segmenter 时走英文兜底 */ }
  for (const m of raw.matchAll(/[A-Za-z][A-Za-z' -]{1,15}/gu)) {
    const w = m[0].trim()
    if (usable(w)) return w
  }
  return ''
}

const PLACE_HINT = /(省|市|区|县|镇|村|路|街|道|站|机场|医院|学校|公司|店|楼|馆|园|港|岛|山|河|湖|海|广场|小区)/u

/** 先复用已有 tag；没有时按实体/地名/事件生成新 tag，并给出置信度。 */
export function planCaptureTag(text, knownTags = []) {
  const matched = (knownTags || []).filter((t) => String(t).length >= 2 && tagMatchesText(t, text)).slice(0, 2)
  if (matched.length) return { tags: matched, confidence: 0.95, kind: 'existing', missing: false }
  const entities = extractExplicitEntities(text)
  if (entities.length) {
    const tag = entities.find((e) => normalizeTriviaTags([e]).ok)
    if (tag) return { tags: [tag], confidence: 0.95, kind: 'entity', missing: false }
  }
  const placeMentioned = PLACE_HINT.test(String(text || ''))
  const tag = suggestCaptureTag(text)
  if (!tag) return { tags: [], confidence: 0, kind: placeMentioned ? 'place' : 'event', missing: true }
  const tagIsPlace = PLACE_HINT.test(tag)
  const confidence = placeMentioned && tagIsPlace ? 0.85 : 0.65
  return {
    tags: [tag],
    confidence,
    kind: placeMentioned ? 'place' : 'event',
    missing: placeMentioned && !tagIsPlace,
  }
}

/** 自动捕获时给候选补上下文：候选所在句 + 前后各一句，边界处少一句就少一句。 */
export function withCaptureContext(raw, candidate, maxChars = 60) {
  const text = String(raw || '')
  const key = String(candidate || '')
  if (!text || !key) return key
  const at = text.indexOf(key)
  if (at < 0) return key
  const units = [...text.matchAll(/[^。！？!?；;\n]+[。！？!?；;\n]?/g)]
    .map((m) => ({ start: m.index, end: m.index + m[0].length }))
  if (!units.length) return key
  const idx = units.findIndex((u) => at >= u.start && at < u.end)
  if (idx < 0) return key
  const from = units[Math.max(0, idx - 1)].start
  const to = units[Math.min(units.length - 1, idx + 1)].end
  const context = text.slice(from, to).replace(/\s+/g, ' ').trim()
  return context.length <= maxChars ? context : context.slice(0, maxChars)
}

export function findSimilarTrivia(cfg, text, tags, excludeId = '') {
  const wanted = new Set((Array.isArray(tags) ? tags : []).map((x) => String(x).toLowerCase()))
  if (!wanted.size) return null
  let best = null
  for (const item of listTrivia(cfg)) {
    if (String(item.id) === String(excludeId)) continue
    if (item.status === 'archived' || item.status === 'superseded') continue
    const shared = (item.tags || []).filter((t) => wanted.has(String(t).toLowerCase()))
    if (!shared.length) continue
    const similarity = Math.max(textSimilarity(text, item.text), ruleSimilarity(text, item.text))
    const sharedSpecific = shared.filter((t) => !GENERIC_RELATION_TAGS.has(String(t).toLowerCase()))
    // 非精确命中时，至少要有具体 tag 共享；只共享“档案/下午”不能合并。
    if (!sharedSpecific.length && similarity < 1) continue
    if (!best || similarity > best.similarity) best = { item, similarity }
  }
  return best && best.similarity >= 0.82 ? best : null
}

function parseLine(line) {
  try {
    const item = JSON.parse(line)
    if (!item || typeof item !== 'object' || !item.id || !item.text) return null
    return normalizeTriviaItem(item)
  } catch {
    return null
  }
}

/**
 * v2 只加可选字段，旧条目读取时补默认值；不因读取重写 index。
 * 未知字段原样保留，迁移失败可从 index.jsonl.bak-schema2-* 回滚。
 */
function normalizeTriviaItem(item) {
  const out = { ...item }
  if (!Array.isArray(out.tags)) out.tags = []
  if (!Array.isArray(out.entities)) out.entities = []
  if (typeof out.status !== 'string' || !out.status) out.status = 'active'
  if (typeof out.validFrom !== 'string') out.validFrom = out.createdAt || ''
  if (typeof out.validTo !== 'string') out.validTo = ''
  if (typeof out.supersedes !== 'string') out.supersedes = ''
  if (typeof out.supersededBy !== 'string') out.supersededBy = ''
  if (!Array.isArray(out.relatedIds)) out.relatedIds = out.supersedes ? [out.supersedes] : []
  if (!Number.isInteger(out.emotion)) out.emotion = 0
  if (!Number.isInteger(out.importance)) out.importance = 0
  if (!Number.isInteger(out.eventScore)) out.eventScore = 0
  if (typeof out.eventApplied !== 'boolean') out.eventApplied = false
  if (!Number.isInteger(out.effectiveImportance)) out.effectiveImportance = Math.min(10, out.importance + out.eventScore)
  if (typeof out.baseScore !== 'number') out.baseScore = Number(out.salience100) || 0
  if (!Number.isInteger(out.positive)) out.positive = 0
  if (!Number.isInteger(out.negative)) out.negative = 0
  if (!Number.isInteger(out.arousal)) out.arousal = out.positive + out.negative
  if (typeof out.emotionIntensity !== 'number') out.emotionIntensity = out.arousal
  if (!Number.isInteger(out.salience)) out.salience = Math.min(20, Math.abs(out.emotion) + out.importance)
  if (typeof out.salience100 !== 'number') out.salience100 = Math.round((Math.min(20, Math.max(0, out.salience)) / 20) * 100)
  if (typeof out.score !== 'number') out.score = Math.round((Number(out.salience100) || 0))
  if (!Number.isInteger(out.interest)) out.interest = 5
  if (!Number.isInteger(out.repeatCount)) out.repeatCount = 0
  if (typeof out.lastSeenAt !== 'string') out.lastSeenAt = ''
  if (typeof out.novelty !== 'number') out.novelty = 1
  if (out.assessmentFallback !== true) out.assessmentFallback = false
  if (typeof out.captureOrigin !== 'string') out.captureOrigin = 'external'
  if (typeof out.source !== 'string' || !out.source) out.source = 'user'
  if (!Number.isInteger(out.schema)) out.schema = TRIVIA_SCHEMA
  return out
}

function metaFileFor(cfg) {
  return path.join(triviaDirFor(cfg), META_FILE)
}

function readMeta(cfg) {
  try {
    const raw = fs.readFileSync(metaFileFor(cfg), 'utf8')
    const meta = JSON.parse(raw)
    return meta && typeof meta === 'object' ? meta : null
  } catch {
    return null
  }
}

/** 首次 v2 写入前备份旧 index；只备份一次，随后写 meta。 */
function ensureSchemaMigration(cfg) {
  const meta = readMeta(cfg)
  if (meta && Number(meta.schemaVersion) >= TRIVIA_SCHEMA) return
  const dir = triviaDirFor(cfg)
  ensureDir(dir)
  const index = indexFileFor(cfg)
  if (fs.existsSync(index)) {
    const backup = path.join(dir, `index.jsonl.bak-schema2-${Date.now()}`)
    try { fs.copyFileSync(index, backup) } catch { /* 备份失败不阻断，但保留旧数据 */ }
  }
  atomicWrite(metaFileFor(cfg), JSON.stringify({ schemaVersion: TRIVIA_SCHEMA, updatedAt: nowIso() }) + '\n')
}

const ITEMS_CACHE = new Map()

function buildCache(items, st) {
  const byTag = new Map()
  const byEntity = new Map()
  const byId = new Map()
  for (const item of items) {
    byId.set(item.id, item)
    for (const tag of item.tags || []) {
      const key = String(tag).toLowerCase()
      if (!byTag.has(key)) byTag.set(key, new Set())
      byTag.get(key).add(item.id)
    }
    for (const entity of item.entities || []) {
      const key = String(entity).toLowerCase()
      if (!byEntity.has(key)) byEntity.set(key, new Set())
      byEntity.get(key).add(item.id)
    }
  }
  return { size: Number(st.size), mtimeNs: String(st.mtimeNs), items, byTag, byEntity, byId }
}

function readCache(cfg) {
  const file = indexFileFor(cfg)
  let st
  try { st = fs.statSync(file, { bigint: true }) } catch { return { items: [], byTag: new Map(), byEntity: new Map(), byId: new Map() } }
  const hit = ITEMS_CACHE.get(file)
  if (hit && hit.size === Number(st.size) && hit.mtimeNs === String(st.mtimeNs)) return hit
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const items = []
  for (const line of lines) {
    if (!line.trim()) continue
    const item = parseLine(line)
    if (item) items.push(item)
  }
  const cache = buildCache(items, st)
  ITEMS_CACHE.set(file, cache)
  return cache
}

function cachedItems(cfg) {
  return readCache(cfg).items
}

export function invalidateTriviaCache(cfg) {
  try { ITEMS_CACHE.delete(indexFileFor(cfg)) } catch { /* ignore */ }
}

export function listTrivia(cfg, opts = {}) {
  const items = cachedItems(cfg)
  if (opts.includePending === false) return items.filter((x) => x.pendingReview !== true)
  return items
}

export function readTrivia(cfg, id) {
  return listTrivia(cfg).find((x) => x.id === String(id || '')) || null
}

function writeAll(cfg, items) {
  const dir = triviaDirFor(cfg)
  ensureDir(dir)
  ensureSchemaMigration(cfg)
  const text = items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : '')
  atomicWrite(indexFileFor(cfg), text)
  try {
    const st = fs.statSync(indexFileFor(cfg), { bigint: true })
    ITEMS_CACHE.set(indexFileFor(cfg), buildCache(items, st))
  } catch { /* 缓存失败下次重读 */ }
}

export function addTrivia(cfg, { text, tags, entities } = {}, opts = {}) {
  const textRes = validateTriviaText(text, Number(opts.maxTextChars) || MAX_TEXT_CHARS)
  if (!textRes.ok) return textRes
  const items = listTrivia(cfg)
  const knownTags = [...new Set(items.flatMap((x) => Array.isArray(x.tags) ? x.tags : []))]
  const tagRes = normalizeTriviaTags(tags, knownTags)
  if (!tagRes.ok) return tagRes
  if (!tagRes.tags.length) return { ok: false, error: '至少给 1 个具体 tag，方便以后检索' }
  const entityList = normalizeEntityList(entities !== undefined ? entities : opts.entities)
  const source = opts.source === 'model' ? 'model' : opts.source === 'plugin' ? 'plugin' : 'user'
  const autoSource = source !== 'user'
  const assistantOrigin = opts.origin === 'assistant'
  const interest = clampInt(Number(cfg.triviaInterest) || 5, 1, 10)
  let assess = { positive: 0, negative: 0, emotion: 0, importance: 0, eventScore: 0, eventApplied: false, effectiveImportance: 0, baseScore: 0, arousal: 0, emotionIntensity: 0, score: 0, salience: 0, salience100: 0 }
  let assessFallback = false
  try {
    assess = assessTrivia(textRes.text)
  } catch {
    assessFallback = true
  }
  // 插件自动捕获走低分门；模型/用户主动写不因低分被拒。
  const threshold = Math.max(1, 7 - interest + (source === 'plugin' ? 1 : 0) + (assistantOrigin ? 2 : 0))
  if (autoSource && looksLikeCoreMemory(textRes.text)) {
    return {
      ok: false,
      code: 'use-core',
      error: '这是长期/规则/身份内容，请用 memory_core_write 写对应板块，不要写会过期的杂事。',
    }
  }
  // 模型自动写：相似条目不新增，记一次重复并续命；避免“每天夸一遍就存一遍”。
  if (autoSource) {
    let similar = null
    try {
      similar = findSimilarTrivia(cfg, textRes.text, tagRes.tags)
    } catch {
      // 插件去重失败时放行，模型写入作为兜底，不因索引异常丢事实。
      similar = null
    }
    if (similar) {
      const now = nowIso()
      const merged = {
        ...similar.item,
        repeatCount: (Number(similar.item.repeatCount) || 0) + 1,
        lastAccessAt: now,
        lastSeenAt: now,
        novelty: Math.max(0, 1 - similar.similarity),
        emotion: assess.emotion,
        importance: Math.max(Number(similar.item.importance) || 0, assess.importance),
        salience: Math.max(Number(similar.item.salience) || 0, assess.salience),
        salience100: Math.max(Number(similar.item.salience100) || 0, assess.salience100),
        score: Math.max(Number(similar.item.score) || 0, assess.score),
        interest,
      }
      merged.expiresAt = new Date(expiryAt(merged)).toISOString()
      writeAll(cfg, items.map((x) => (x.id === similar.item.id ? merged : x)))
      return {
        ok: false,
        code: 'duplicate',
        duplicateId: similar.item.id,
        similarity: Number(similar.similarity.toFixed(3)),
        error: `与 ${similar.item.id} 高度相似（${(similar.similarity * 100).toFixed(0)}%），未新增；已记一次重复。需要改事实请用该 id 更新。`,
      }
    }
  }
  // 只有插件本身评估失败时才让模型兜底；低显著度是插件的正常拒绝，不退回。
  if (source === 'plugin' && !opts.structural && !assessFallback && assess.salience < threshold) {
    return {
      ok: false,
      code: 'low-salience',
      error: `低显著度，未写入：情绪${assess.emotion}、重要性${assess.importance}，兴趣度${interest}需要≥${threshold}`,
      salience: assess.salience,
      score: assess.score,
      threshold,
    }
  }
  if (autoSource && !assessFallback && assess.score >= TRIVIA_SCORE_REVIEW && !opts.confirmHigh) {
    return {
      ok: false,
      code: 'high-salience',
      error: `显著度过高（${assess.score} ≥ ${TRIVIA_SCORE_REVIEW}），不要直接写杂事。请复核：应放关键记忆/用户画像/规则/角色自设等长期板块，还是确认仍是会过期的杂事；确认是杂事时用 confirmTrivia=true 再写。`,
      salience: assess.salience,
      score: assess.score,
      threshold: TRIVIA_SCORE_REVIEW,
    }
  }
  const at = nowIso()
  const item = {
    id: `trivia-${randomUUID().slice(0, 12)}`,
    text: textRes.text,
    tags: tagRes.tags,
    createdAt: at,
    updatedAt: at,
    lastAccessAt: '',
    hits: 0,
    pendingReview: false,
    reviewDeadline: '',
    entities: entityList,
    status: 'active',
    status: 'active',
    validFrom: at,
    validTo: '',
    supersedes: '',
    emotion: assess.emotion,
    positive: assess.positive,
    negative: assess.negative,
    arousal: assess.arousal,
    emotionIntensity: assess.emotionIntensity,
    importance: assess.importance,
    eventScore: assess.eventScore,
    eventApplied: assess.eventApplied,
    effectiveImportance: assess.effectiveImportance,
    baseScore: assess.baseScore,
    score: assess.score,
    salience: assess.salience,
    salience100: assess.salience100,
    interest,
    repeatCount: 0,
    lastSeenAt: '',
    novelty: 1,
    assessmentFallback: assessFallback,
    captureOrigin: assistantOrigin ? 'assistant' : 'external',
    source,
    schema: TRIVIA_SCHEMA,
  }
  item.expiresAt = new Date(expiryAt(item)).toISOString()
  writeAll(cfg, [...items, item])
  return { ok: true, item }
}

export function updateTrivia(cfg, id, { text, tags }) {
  const items = listTrivia(cfg)
  const idx = items.findIndex((x) => x.id === String(id || ''))
  if (idx < 0) return { ok: false, error: '杂事条目不存在', code: 'not-found' }
  const textRes = validateTriviaText(text !== undefined ? text : items[idx].text)
  if (!textRes.ok) return textRes
  const tagRes = normalizeTriviaTags(tags !== undefined ? tags : items[idx].tags, [...new Set(items.flatMap((x) => Array.isArray(x.tags) ? x.tags : []))])
  if (!tagRes.ok) return tagRes
  if (!tagRes.tags.length) return { ok: false, error: '至少给 1 个具体 tag，方便以后检索' }
  const now = nowIso()
  const assess = assessTrivia(textRes.text)
  const next = {
    ...items[idx],
    text: textRes.text,
    tags: tagRes.tags,
    entities: tagRes.tags.slice(0, 3),
    updatedAt: now,
    lastAccessAt: now,
    hits: (Number(items[idx].hits) || 0) + 1,
    pendingReview: false,
    reviewDeadline: '',
    emotion: assess.emotion,
    positive: assess.positive,
    negative: assess.negative,
    arousal: assess.arousal,
    emotionIntensity: assess.emotionIntensity,
    importance: assess.importance,
    eventScore: assess.eventScore,
    eventApplied: assess.eventApplied,
    effectiveImportance: assess.effectiveImportance,
    baseScore: assess.baseScore,
    score: assess.score,
    salience: assess.salience,
    salience100: assess.salience100,
    interest: clampInt(Number(cfg.triviaInterest) || Number(items[idx].interest) || 5, 1, 10),
  }
  next.expiresAt = new Date(expiryAt(next)).toISOString()
  items[idx] = next
  writeAll(cfg, items)
  return { ok: true, item: next }
}

/** 事实更新：不覆盖旧正文，新增一条并给旧条打过时标；旧条仍按自己的寿命过期。 */
export function supersedeTrivia(cfg, id, { text, tags, entities } = {}, opts = {}) {
  const items = listTrivia(cfg)
  const idx = items.findIndex((x) => x.id === String(id || ''))
  if (idx < 0) return { ok: false, error: '杂事条目不存在', code: 'not-found' }
  const old = items[idx]
  if (old.status === 'superseded') return { ok: false, error: '该条目已经过时，不能再作为替代起点', code: 'already-superseded' }
  const textRes = validateTriviaText(text !== undefined ? text : old.text)
  if (!textRes.ok) return textRes
  const tagRes = normalizeTriviaTags(tags !== undefined ? tags : old.tags, [...new Set(items.flatMap((x) => Array.isArray(x.tags) ? x.tags : []))])
  if (!tagRes.ok) return tagRes
  if (!tagRes.tags.length) return { ok: false, error: '至少给 1 个具体 tag，方便以后检索' }
  const now = nowIso()
  const assess = assessTrivia(textRes.text)
  const nextTags = [...new Set([...(old.tags || []), ...tagRes.tags])].slice(0, MAX_TAGS)
  const nextEntities = entities !== undefined
    ? normalizeEntityList(entities)
    : normalizeEntityList(old.entities)
  const relatedIds = [...new Set([old.id, ...(Array.isArray(old.relatedIds) ? old.relatedIds : [])])]
  const item = {
    id: `trivia-${randomUUID().slice(0, 12)}`,
    text: textRes.text,
    tags: nextTags,
    createdAt: now,
    updatedAt: now,
    lastAccessAt: '',
    hits: 0,
    pendingReview: false,
    reviewDeadline: '',
    entities: nextEntities,
    status: 'active',
    validFrom: now,
    validTo: '',
    supersedes: old.id,
    relatedIds,
    emotion: assess.emotion,
    positive: assess.positive,
    negative: assess.negative,
    arousal: assess.arousal,
    emotionIntensity: assess.emotionIntensity,
    importance: assess.importance,
    eventScore: assess.eventScore,
    eventApplied: assess.eventApplied,
    effectiveImportance: assess.effectiveImportance,
    baseScore: assess.baseScore,
    score: assess.score,
    salience: assess.salience,
    salience100: assess.salience100,
    interest: clampInt(Number(cfg.triviaInterest) || Number(old.interest) || 5, 1, 10),
    repeatCount: 0,
    lastSeenAt: '',
    novelty: 1,
    assessmentFallback: false,
    captureOrigin: old.captureOrigin || 'external',
    source: opts.source === 'model' ? 'model' : opts.source === 'plugin' ? 'plugin' : (old.source || 'user'),
    schema: TRIVIA_SCHEMA,
  }
  item.expiresAt = new Date(expiryAt(item)).toISOString()
  const oldNext = {
    ...old,
    status: 'superseded',
    validTo: now,
    supersededBy: item.id,
    relatedIds: [...new Set([...(Array.isArray(old.relatedIds) ? old.relatedIds : []), item.id])],
    updatedAt: now,
    pendingReview: false,
    reviewDeadline: '',
  }
  const next = items.map((x) => (x.id === old.id ? oldNext : x))
  next.push(item)
  writeAll(cfg, next)
  return { ok: true, item, superseded: oldNext, items: next }
}

/** 读/搜命中：强化但不改内容时间。 */
export function recordAccess(cfg, ids, { n = 1 } = {}) {
  const wanted = new Set((Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean))
  if (!wanted.size) return { ok: true, touched: 0 }
  const items = listTrivia(cfg)
  let touched = 0
  const at = nowIso()
  const next = items.map((item) => {
    if (!wanted.has(item.id)) return item
    if (item.status === 'superseded') return item
    touched++
    const updated = {
      ...item,
      hits: (Number(item.hits) || 0) + Math.max(1, Number(n) || 1),
      lastAccessAt: at,
    }
    updated.expiresAt = new Date(expiryAt(updated)).toISOString()
    return updated
  })
  if (touched) writeAll(cfg, next)
  return { ok: true, touched }
}

/** 复审保留：清 pendingReview，并延长 60 天；不改变正文。 */
export function keepTrivia(cfg, id, { days = 60 } = {}) {
  const items = listTrivia(cfg)
  const idx = items.findIndex((x) => x.id === String(id || ''))
  if (idx < 0) return { ok: false, error: '杂事条目不存在', code: 'not-found' }
  const now = Date.now()
  const next = {
    ...items[idx],
    pendingReview: false,
    reviewDeadline: '',
    lastAccessAt: new Date(now).toISOString(),
    hits: (Number(items[idx].hits) || 0) + 1,
    extendedUntil: new Date(now + days * 24 * 60 * 60 * 1000).toISOString(),
  }
  next.expiresAt = new Date(expiryAt(next)).toISOString()
  items[idx] = next
  writeAll(cfg, items)
  return { ok: true, item: next, items }
}

/** 手动删除：硬删；自动过期才进 .triviatrash。 */
export function removeTrivia(cfg, id) {
  const items = listTrivia(cfg)
  const idx = items.findIndex((x) => x.id === String(id || ''))
  if (idx < 0) return { ok: false, error: '杂事条目不存在', code: 'not-found' }
  const removed = items[idx]
  const predecessors = items.filter((x) => String(x.supersededBy || '') === String(removed.id))
  const successors = items.filter((x) => String(x.supersedes || '') === String(removed.id))
  const next = successors[0]
  const prev = predecessors[0]
  const relinked = []
  for (const item of items) {
    if (item.id === removed.id) continue
    let nextItem = item
    if (String(nextItem.supersededBy || '') === String(removed.id)) {
      nextItem = {
        ...nextItem,
        supersededBy: next ? next.id : '',
        ...(next ? {} : { status: 'active', validTo: '' }),
        relatedIds: [...new Set([...(nextItem.relatedIds || []), ...(next ? [next.id] : [])])].filter((x) => x !== removed.id),
      }
      relinked.push(nextItem.id)
    }
    if (String(nextItem.supersedes || '') === String(removed.id)) {
      nextItem = {
        ...nextItem,
        supersedes: prev ? prev.id : '',
        relatedIds: [...new Set([...(nextItem.relatedIds || []), ...(prev ? [prev.id] : [])])].filter((x) => x !== removed.id),
      }
      relinked.push(nextItem.id)
    }
    if (nextItem !== item) items[items.indexOf(item)] = nextItem
  }
  items.splice(idx, 1)
  writeAll(cfg, items)
  return { ok: true, removed: 1, relinked: [...new Set(relinked)] }
}

function moveToTrash(cfg, item, reason) {
  const dir = trashDirFor(cfg)
  ensureDir(dir)
  const safeId = String(item.id || 'trivia').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'trivia'
  const file = path.join(dir, `${safeId}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify({ ...item, trashReason: reason, trashedAt: nowIso() }, null, 2), 'utf8')
  return file
}

function pruneTriviaTrash(cfg, now = Date.now()) {
  const dir = trashDirFor(cfg)
  if (!fs.existsSync(dir)) return 0
  const maxAge = TRASH_DAYS * 24 * 60 * 60 * 1000
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const file = path.join(dir, name)
    try {
      if (now - fs.statSync(file).mtimeMs > maxAge) { fs.unlinkSync(file); removed++ }
    } catch { /* ignore */ }
  }
  return removed
}

function queryTerms(query) {
  const text = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!text) return []
  const terms = new Set()
  for (const m of text.matchAll(/[\p{Script=Han}0-9]{1,}/gu)) {
    const run = m[0]
    if (run.length === 1) {
      if (!GENERIC_TAG_WORDS.has(run)) terms.add(run)
      continue
    }
    if (!GENERIC_TAG_WORDS.has(run)) terms.add(run)
    for (let i = 0; i < run.length - 1; i++) {
      const t = run.slice(i, i + 2)
      if (!GENERIC_TAG_WORDS.has(t)) terms.add(t)
    }
  }
  for (const m of text.matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)) {
    if (m[0].length >= 2) terms.add(m[0])
  }
  return [...terms].slice(0, 16)
}

/**
 * 轻量召回：复用 trivia/index.jsonl 与现有 tags，不依赖图谱、不重排醒目度。
 * 只负责找候选；事实仍需 readTrivia 核验。返回按相关度排序的条目副本。
 */
export function recallTrivia(cfg, query, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 3, 1), 5)
  const exclude = new Set((Array.isArray(opts.excludeIds) ? opts.excludeIds : []).map(String))
  const terms = queryTerms(query)
  if (!terms.length) return []
  const full = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const queryChars = [...new Set(String(query || '').match(/[\p{Script=Han}]/gu) || [])].slice(0, 24)
  const multiQuery = /(和|以及|分别|两块|还有|同时|到底|能不能|还是)/.test(String(query || ''))
  const cache = readCache(cfg)
  // tag 倒排只做候选裁剪；多个词命中不同 tag 时，普通问题取最小候选集，
  // 多事实/冲突问法取并集，避免漏掉同一主题的第二条。
  const candidateSets = []
  for (const term of terms) {
    const bucketIds = new Set()
    for (const [tag, bucket] of cache.byTag) {
      if (tag === term || tag.startsWith(term) || (term.length >= 3 && tag.includes(term))) {
        for (const id of bucket) bucketIds.add(id)
      }
    }
    for (const [entity, bucket] of cache.byEntity) {
      if (entity === term || entity.startsWith(term) || (term.length >= 3 && entity.includes(term))) {
        for (const id of bucket) bucketIds.add(id)
      }
    }
    if (bucketIds.size) candidateSets.push(bucketIds)
  }
  let candidateIds = null
  if (multiQuery) {
    candidateIds = new Set()
    for (const set of candidateSets) for (const id of set) candidateIds.add(id)
    if (!candidateIds.size) candidateIds = null
  } else {
    for (const set of candidateSets) {
      if (!candidateIds || set.size < candidateIds.size) candidateIds = set
    }
  }
  const items = candidateIds && candidateIds.size
    ? [...candidateIds].map((id) => cache.byId.get(id)).filter(Boolean)
    : cache.items
  const rows = []
  for (const item of items) {
    if (exclude.has(String(item.id))) continue
    if (item.status === 'archived' || item.status === 'superseded') continue
    const now = Date.now()
    const validFrom = Date.parse(item.validFrom || '')
    const validTo = Date.parse(item.validTo || '')
    if (Number.isFinite(validFrom) && validFrom > now) continue
    if (Number.isFinite(validTo) && validTo > 0 && validTo < now) continue
    const tags = (item.tags || []).map((x) => String(x).toLowerCase())
    const entities = (item.entities || []).map((x) => String(x).toLowerCase())
    const text = String(item.text || '').toLowerCase()
    const hay = `${text} ${tags.join(' ')} ${entities.join(' ')}`
    let score = 0
    const matched = new Set()
    if (full.length >= 2 && hay.includes(full)) { score += 4; matched.add(full) }
    for (const term of terms) {
      if (tags.includes(term)) { score += 3; matched.add(term); continue }
      if (entities.includes(term)) { score += 2; matched.add(term); continue }
      if (text.includes(term)) { score += 1; matched.add(term) }
    }
    // 短查询可能拆不出有效二元词（例如“测试库”对“测试环境/数据库”）：
    // 只给没有基础命中的条目补一次 tag/实体字符重合，避免把“小张”这类共现噪声带进来。
    if (score <= 0 && queryChars.length) {
      const tagChars = new Set([...tags.join(''), ...entities.join('')])
      const charHits = queryChars.filter((ch) => tagChars.has(ch))
      if (charHits.length >= 2) {
        score = charHits.length
        charHits.forEach((ch) => matched.add(`char:${ch}`))
      }
    }
    if (score <= 0) continue
    const ts = Date.parse(item.lastAccessAt || item.updatedAt || item.createdAt || '') || 0
    rows.push({ item, score, matched: [...matched], ts })
  }
  rows.sort((a, b) => (b.score - a.score) || (b.ts - a.ts))
  const topScore = rows.length ? rows[0].score : 0
  // 多事实/冲突问法给更宽的截断；普通单事实问题收紧，避免同实体噪声。
  const defaultRatio = multiQuery ? 0.3 : 0.7
  const minRatio = Number.isFinite(Number(opts.minRatio)) ? Math.min(Math.max(Number(opts.minRatio), 0.1), 1) : defaultRatio
  const cutoff = Math.max(1, topScore * minRatio)
  return rows
    .filter((row) => row.score >= cutoff)
    .slice(0, limit)
    .map(({ item, score, matched }) => ({ ...item, recallScore: score, matchedTerms: matched }))
}

/**
 * 服务端分页/过滤：只返回当前页，避免 UI 一次拿全部条目。
 * 数据源仍是 index.jsonl；cachedItems 负责避免每次翻页重新解析整文件。
 */
export function pageTrivia(cfg, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200)
  const offset = Math.max(Number(opts.offset) || 0, 0)
  const q = String(opts.q || '').toLowerCase().trim()
  const filter = ['all', 'fresh', 'review', 'stale'].includes(opts.filter) ? opts.filter : 'all'
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const ageDays = (item) => {
    if (item.pendingReview === true) return -1
    const t = Math.max(
      Date.parse(item.lastAccessAt || '') || 0,
      Date.parse(item.updatedAt || '') || 0,
      Date.parse(item.createdAt || '') || 0,
    )
    return t ? (now - t) / day : 0
  }
  const tags = new Set()
  const rows = []
  for (const item of listTrivia(cfg)) {
    for (const t of item.tags || []) tags.add(t)
    if (q) {
      const hay = `${String(item.text || '')} ${(item.tags || []).join(' ')} ${(item.entities || []).join(' ')}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    const days = ageDays(item)
    if (filter === 'review' && item.pendingReview !== true) continue
    if (filter === 'fresh' && (item.pendingReview === true || days > 7)) continue
    if (filter === 'stale' && !(item.pendingReview === true || days > 30)) continue
    rows.push(item)
  }
  rows.sort((a, b) => {
    const ar = a.pendingReview === true ? 1 : 0
    const br = b.pendingReview === true ? 1 : 0
    if (ar !== br) return br - ar
    return (Date.parse(b.updatedAt || b.createdAt || '') || 0) - (Date.parse(a.updatedAt || a.createdAt || '') || 0)
  })
  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
    tags: [...tags].sort((a, b) => String(a).localeCompare(String(b), 'zh')),
  }
}

/**
 * 每日维护：重算过期线、分流、复审超时清理、trash 清理。
 * 返回统计，调用方负责写入/刷新与分片。
 */
export function ageTrivia(cfg, now = Date.now()) {
  const items = listTrivia(cfg)
  const autoReview = cfg.triviaAutoReview !== false
  // 空会话不创建 trivia 目录/空索引。
  if (!items.length && !fs.existsSync(indexFileFor(cfg))) {
    return { total: 0, reviewed: 0, trashed: 0, pruned: 0, kept: 0, autoKept: 0 }
  }
  const keep = []
  const stats = { total: items.length, reviewed: 0, trashed: 0, pruned: 0, kept: 0, autoKept: 0 }
  const recentlyUsed = (item) => {
    const last = Date.parse(item.lastAccessAt || '')
    return (Number(item.hits) || 0) > 0
      && Number.isFinite(last)
      && (now - last) <= RECENT_READ_DAYS * 24 * 60 * 60 * 1000
  }
  for (const item of items) {
    if (item.status === 'superseded') {
      const expiry = expiryAt(item)
      if (Number.isFinite(expiry) && now >= expiry) {
        moveToTrash(cfg, item, 'superseded-expired')
        stats.trashed++
      } else {
        keep.push({ ...item, expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : item.expiresAt })
      }
      continue
    }
    if (item.pendingReview === true) {
      if (autoReview && !reviewOverdue(item, now) && recentlyUsed(item)) {
        const next = {
          ...item,
          pendingReview: false,
          reviewDeadline: '',
          extendedUntil: new Date(now + renewalDays(item.hits) * 24 * 60 * 60 * 1000).toISOString(),
        }
        next.expiresAt = new Date(expiryAt(next)).toISOString()
        keep.push(next)
        stats.autoKept++
        continue
      }
      if (autoReview && !recentlyUsed(item)) {
        moveToTrash(cfg, item, 'review-stale')
        stats.trashed++
        continue
      }
      const dl = Date.parse(item.reviewDeadline || '')
      if (!Number.isFinite(dl)) {
        // 截止时间缺失/损坏：补一个 14 天窗口，避免永久滞留。
        keep.push({ ...item, reviewDeadline: new Date(reviewDeadline(now)).toISOString() })
        stats.reviewed++
        continue
      }
      if (reviewOverdue(item, now)) {
        moveToTrash(cfg, item, 'review-timeout')
        stats.trashed++
      } else {
        keep.push(item)
        stats.reviewed++
      }
      continue
    }
    const kind = classifyExpiry(item, now)
    if (kind === 'keep') {
      const next = { ...item, expiresAt: new Date(expiryAt(item)).toISOString() }
      keep.push(next)
      stats.kept++
      continue
    }
    if (kind === 'review' && isLongLived(item, now)) {
      if (autoReview && recentlyUsed(item)) {
        const next = {
          ...item,
          pendingReview: false,
          reviewDeadline: '',
          extendedUntil: new Date(now + renewalDays(item.hits) * 24 * 60 * 60 * 1000).toISOString(),
        }
        next.expiresAt = new Date(expiryAt(next)).toISOString()
        keep.push(next)
        stats.autoKept++
      } else if (autoReview) {
        moveToTrash(cfg, item, 'expired-stale')
        stats.trashed++
      } else {
        keep.push({
          ...item,
          pendingReview: true,
          reviewDeadline: new Date(reviewDeadline(now)).toISOString(),
        })
        stats.reviewed++
      }
      continue
    }
    moveToTrash(cfg, item, kind === 'review' ? 'expired' : 'expired')
    stats.trashed++
  }
  writeAll(cfg, keep)
  stats.pruned = pruneTriviaTrash(cfg, now)
  return stats
}

export function pendingReviewItems(cfg) {
  return listTrivia(cfg).filter((x) => x.pendingReview === true)
}
