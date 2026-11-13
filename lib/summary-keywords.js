/**
 * 归档摘要的“关键词行”校验。
 *
 * 约定：摘要正文之后可以有一行
 *   关键词（仅供检索）：词1、词2、词3
 * 或
 *   关键词：无
 *
 * 规则（2026-11-13 与用户确认）：
 * - 关键词行可选；没有就不校验
 * - 「无」表示该段不参与关键词检索
 * - 有关键词时：每个必须是该段覆盖轮次原文里的原词；最多 8 个；单个 ≤16 字；整行 ≤120 字
 * - 数量下限只是建议，不强制
 */

const KW_RE = /^关键词(?:（[^）]*）)?\s*[:：]\s*(.*)$/

export function validateSummaryKeywords(text, sourceText, opts = {}) {
  const max = Number(opts.max) > 0 ? Number(opts.max) : 8
  const maxLen = Number(opts.maxLen) > 0 ? Number(opts.maxLen) : 16
  const maxLine = Number(opts.maxLine) > 0 ? Number(opts.maxLine) : 120
  const src = String(sourceText || '')
  const lines = String(text || '').split('\n')
  let lineIndex = -1
  let line = ''
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (KW_RE.test(t)) { lineIndex = i; line = t; break }
  }
  if (lineIndex < 0) return { ok: true, none: false, keywords: [], errors: [] }
  const raw = String(line.match(KW_RE)?.[1] ?? '').trim()
  if (!raw || raw === '无' || raw === '—' || raw === '-') {
    return { ok: true, none: true, keywords: [], errors: [] }
  }
  const errors = []
  if (line.length > maxLine) errors.push(`关键词行超过 ${maxLine} 字（${line.length} 字）`)
  const keywords = raw.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean)
  if (keywords.length > max) errors.push(`关键词超过 ${max} 个（${keywords.length} 个）`)
  for (const k of keywords) {
    if (k.length > maxLen) errors.push(`关键词「${k.slice(0, 24)}」超过 ${maxLen} 字`)
    if (!src.includes(k)) errors.push(`关键词「${k}」在该段对应轮次原文里没有出现`)
  }
  return { ok: errors.length === 0, none: false, keywords, errors, line, lineIndex }
}
