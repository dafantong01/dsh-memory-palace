/**
 * 中文近义词 / 分类别名 / 回忆线索检测。
 * 数据来自 Chinese-Synonyms（Apache-2.0）离线压缩索引；运行时不联网。
 */
import fs from 'node:fs'
import zlib from 'node:zlib'

const MAX_TERMS = 14
const MAX_SYNONYMS_PER_WORD = 6
const MIN_WORD_LEN = 2

const CATEGORY_ALIASES = new Map(Object.entries({
  'plugin-dev': ['plugin-dev', 'plugin-development', 'plugindev', 'plugin_development', '插件开发', '插件开发调试'],
  'plugin-config': ['plugin-config', 'plugin-configuration', 'plugin_config', '插件配置'],
  'code-review': ['code-review', 'review', 'code_review', '代码审查', '审查'],
  'migration': ['migration', 'migrate', 'migration-engineering', '迁移', '搬家', '搬移'],
  'testing': ['testing', 'test', 'qa', '测试', '回归测试', '盲测'],
  'ui-design': ['ui-design', 'ui', 'ux', 'interface', 'ui设计', '界面'],
  'memory-architecture': ['memory-architecture', 'memory-design', '记忆架构', '记忆设计'],
  'memory-recall': ['memory-recall', 'recall', 'retrieval', '记忆检索', '回忆'],
  'roadmap': ['roadmap', 'plan', 'planning', '路线图', '计划'],
  'project-docs': ['project-docs', 'docs', 'document', '项目档案', '文档'],
  'release-plan': ['release-plan', 'release', '发布', '发布计划'],
  'cookie-recovery': ['cookie-recovery', 'cookie', 'cookies', 'cookie清理', '登录态'],
  'incident-recovery': ['incident-recovery', 'recovery', '事故恢复', '恢复'],
  'family-design': ['family-design', 'family', '家族', '记忆家族'],
  'injection-design': ['injection-design', 'injection', '注入', '热记忆注入'],
}))

const CUE_PATTERNS = [
  // 裸时间词不触发；必须和“说/聊/做/问题/版本/记得”等回忆语义共现。
  /(之前|上次|上回|以前|曾经|当时|那天|那次|有一次).{0,24}?(说|讲|聊|讨论|提到|提到过|问|做|弄|改|修|遇到|发生|问题|报错|bug|决定|方案|版本|怎么|咋|为什么|是不是|有没有|记得|忘)/,
  /(记得吗|还记得|不记得|想不起来|记不起来|回忆一下|回忆下|翻旧账|旧事|往事)/,
]

// 词典里缺的口语短语；只补高频、低歧义的，不追求覆盖全部。
const EXTRA_SYNONYMS = {
  '打不开': ['无法打开', '启动失败', '启动不了', '无法启动', '崩溃', '进不去'],
  '大半夜': ['半夜', '深夜', '凌晨', '夜里'],
  '大半夜打不开': ['无法启动', '启动失败', '崩溃', '进不去'],
  '上次': ['上回', '之前', '以前', '那次'],
  '记得': ['还记得', '想起', '回忆'],
  '崩溃': ['崩了', '挂了', '打不开', '闪退'],
  '恢复': ['修好', '还原', '救回'],
  '插件': ['扩展', 'plugin'],
  '项目档案': ['项目文档', '档案'],
  '会议': ['开会', '讨论会', 'meeting'],
  '守护进程': ['guardian', 'daemon', '后台进程'],
  '起不来': ['启动失败', '无法启动', '启动不了'],
  '写不了文件': ['权限修复', 'ACL', 'WRITE_OWNER', '写入失败'],
  '翻旧账': ['检索轮数', '摘要', '回忆'],
  '依赖报错': ['依赖', 'guardian', '依赖修复'],
  '沙箱': ['sandbox'],
  '守护进程起不来': ['guardian', '依赖修复', '启动失败', '无法启动'],
  '沙箱写不了文件': ['权限修复', 'ACL', 'WRITE_OWNER', '写入失败', '权限'],
  '翻旧账要几次': ['检索轮数', '检索', '摘要', '回忆'],
}

let cachedMap = null
let cachedGroups = 0

function buildMap() {
  if (cachedMap) return cachedMap
  const map = new Map()
  try {
    const file = new URL('../data/synonyms.v1.json.gz', import.meta.url)
    const raw = zlib.gunzipSync(fs.readFileSync(file))
    const data = JSON.parse(raw.toString('utf8'))
    const groups = Array.isArray(data?.groups) ? data.groups : []
    cachedGroups = groups.length
    for (const group of groups) {
      if (!Array.isArray(group) || group.length < 2) continue
      for (const word of group) {
        if (typeof word !== 'string' || word.length < MIN_WORD_LEN) continue
        if (!map.has(word)) map.set(word, [])
        const list = map.get(word)
        for (const other of group) {
          if (other !== word && typeof other === 'string' && other.length >= MIN_WORD_LEN && !list.includes(other)) {
            list.push(other)
            if (list.length >= MAX_SYNONYMS_PER_WORD) break
          }
        }
      }
    }
  } catch {
    /* 索引缺失时保持空，不影响主流程 */
  }
  for (const [word, list] of Object.entries(EXTRA_SYNONYMS)) {
    const group = [word, ...list]
    for (const w of group) {
      if (w.length < MIN_WORD_LEN) continue
      const curated = list.filter((x) => x !== w)
      const old = (map.get(w) || []).filter((x) => !curated.includes(x))
      map.set(w, [...new Set([...curated, ...old])].slice(0, MAX_SYNONYMS_PER_WORD))
    }
  }
  cachedMap = map
  return map
}

export function synonymStatus() {
  const map = buildMap()
  return { words: map.size, groups: cachedGroups }
}

/** 对长中文串做贪心最长词切分；只接受至少 2 个词，避免“不存在的”被单个“存在”带偏。 */
function segmentCjk(token, map) {
  const parts = []
  let i = 0
  while (i < token.length) {
    let picked = ''
    for (let n = Math.min(6, token.length - i); n >= MIN_WORD_LEN; n--) {
      const sub = token.slice(i, i + n)
      if (map.has(sub)) { picked = sub; break }
    }
    if (picked) {
      parts.push(picked)
      i += picked.length
    } else {
      i += 1
    }
  }
  return parts.length >= 2 ? parts : []
}

/** 把查询扩展成带权重的词；不返回整段词典。 */
export function expandQuery(text, opts = {}) {
  const source = String(text ?? '').trim()
  if (!source) return []
  const max = Math.min(Math.max(Number(opts.maxTerms) || MAX_TERMS, 1), 24)
  const map = buildMap()
  const out = new Map()
  const add = (term, weight, kind) => {
    const w = String(term || '').trim().toLowerCase()
    if (!w || w.length < MIN_WORD_LEN) return
    const old = out.get(w)
    if (!old || weight > old.weight) out.set(w, { term: w, weight, kind })
  }
  const rawTokens = source.toLowerCase().split(/[\s,，。；;、:：!?！？()（）\[\]【】"'“”]+/).filter(Boolean)
  for (const token of rawTokens) {
    add(token, 1, 'original')
    const direct = map.get(token)
    if (direct) for (const s of direct) add(s, 0.6, 'synonym')
    if (!direct && token.length >= 4 && /[\u4e00-\u9fff]/.test(token)) {
      for (const part of segmentCjk(token, map)) {
        add(part, 0.7, 'segment')
        for (const s of map.get(part) || []) add(s, 0.55, 'synonym')
      }
    }
  }
  return [...out.values()]
    .sort((a, b) => b.weight - a.weight || a.term.length - b.term.length)
    .slice(0, max)
}

export function normalizeCategory(input) {
  const raw = String(input ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '')
  if (!raw) return ''
  for (const [canonical, aliases] of CATEGORY_ALIASES) {
    if (aliases.some((a) => a.toLowerCase() === raw)) return canonical
  }
  return raw
}

export function detectCueWords(text) {
  const s = String(text ?? '')
  return CUE_PATTERNS.filter((re) => re.test(s)).map((re) => s.match(re)?.[0] || '')
}
