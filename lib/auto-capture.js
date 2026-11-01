/**
 * 热记忆自动写入 · 候选抽取（纯代码，不调用模型）。
 * 这里只做“值得让模型/用户看一眼”的候选，不是最终写入门槛。
 */

const EXPLICIT = /(记住|记得|谨记|记下|别忘|要记得|请记住|请记得|切忌|切勿|务必|一定要|千万|严禁|禁止|不许|不要再|必须)/
const FUTURE = /(以后都|以后别|以后不要|下次|从现在起|今后|从今往后|从此|往后|始终|永远|默认|以后用)/
const CORRECTION = /(不对|不是|错了|改成|更正|应该是|不是.{0,12}而是|之前说错)/
const PREFERENCE = /(我(更|偏)?喜欢|我习惯|我讨厌|请用|不要用|别再|最好|优先)/
const IDENTITY = /(当成|当作|视作|身份|人格|设定)/
const SELF_FACT = /(你(又)?(难道)?(忘记|不记得)|你其实|你一直|你总是|你喜欢|你讨厌|你是)/

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigrams(text) {
  const s = normalize(text)
  const out = new Set()
  if (s.length < 2) return out
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

function similarity(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const x of A) if (B.has(x)) hit++
  return hit / Math.max(A.size, B.size)
}

function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[。！？!?；;\n])/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function cleanCandidate(sentence) {
  let s = String(sentence || '').trim()
  s = s.replace(/^(你|您)?(以后|今后|从今往后|从此|往后|下次)?(还是|也要|要|必须)*/u, '')
  s = s.replace(/^(又)?(难道)?(忘记|不记得)[：:，,\s]*/u, '')
  s = s.replace(/^(请)?(记住|记得|谨记|记下|别忘|要记得|切忌|切勿|务必|一定要|千万|严禁|禁止|不许|不要再)[：:，,\s]*/u, '')
  s = s.replace(/[。！？!?；;\s]*(这种事|这件事|就行|即可|啊|吧|呢)+$/u, '')
  s = s.replace(/(了)?(吗|么|呢)?[。！？!?；;\s]*$/u, '')
  const idm = s.match(/^把(.+?)当成(你的)?身份.*$/u)
  if (idm) s = idm[1].trim()
  // “切忌……没做备份”这类双重否定，转成正向约束。
  const m = s.match(/^(.*?)没(做|有)?(.+)$/u)
  if (m && /(切忌|不要|别|禁止|不许)/.test(sentence)) {
    s = `务必${m[1]}${m[3]}`
  }
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * @param {string} text 用户原始消息
 * @param {{existing?: string[], max?: number}} opts existing=已有记忆内容
 * @returns {{candidates: Array<{text:string,kind:string,confidence:number,reason:string}>, skipped: Array<{text:string,reason:string}>}}
 */
export function extractCandidates(text, opts = {}) {
  const existing = Array.isArray(opts.existing) ? opts.existing.filter((x) => typeof x === 'string') : []
  const max = Math.min(Math.max(Number(opts.max) || 3, 1), 10)
  const candidates = []
  const skipped = []
  const seen = new Set()

  for (const sentence of splitSentences(text)) {
    if (sentence.length < 6 || sentence.length > 800) continue
    const flags = {
      explicit: EXPLICIT.test(sentence),
      future: FUTURE.test(sentence),
      correction: CORRECTION.test(sentence),
      preference: PREFERENCE.test(sentence),
      identity: IDENTITY.test(sentence),
      selfFact: SELF_FACT.test(sentence),
    }
    if (!flags.explicit && !flags.future && !flags.correction && !flags.preference && !flags.identity && !flags.selfFact) continue

    const key = normalize(sentence)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const kind = flags.correction ? 'correction'
      : flags.identity ? 'identity'
        : flags.selfFact ? 'identity'
          : flags.preference ? 'preference'
            : flags.future ? 'future'
              : 'explicit'
    const confidence = flags.correction ? 0.9
      : flags.identity ? 0.88
        : flags.selfFact ? 0.78
          : flags.explicit ? 0.82
            : flags.future ? 0.75
              : 0.65

    let duplicate = false
    const normalized = normalize(sentence)
    for (const old of existing) {
      const normalizedOld = normalize(old)
      if (normalizedOld.length >= 4 && (normalized.includes(normalizedOld) || normalizedOld.includes(normalized))) {
        duplicate = true
        break
      }
      if (similarity(sentence, old) >= 0.72) { duplicate = true; break }
    }
    if (duplicate) {
      skipped.push({ text: sentence, reason: '与现有记忆高度相似' })
      continue
    }
    if (candidates.length >= max) continue
    candidates.push({
      text: sentence,
      proposedText: cleanCandidate(sentence) || sentence,
      kind,
      confidence,
      reason: flags.correction ? '纠正/否定' : flags.identity ? '身份/设定' : flags.selfFact ? '自我事实提醒' : flags.explicit ? '显式记忆词' : flags.future ? '未来约束' : '偏好表达',
    })
  }

  candidates.sort((a, b) => b.confidence - a.confidence)
  return { candidates, skipped }
}

export const __test = { normalize, similarity, extractCandidates }
