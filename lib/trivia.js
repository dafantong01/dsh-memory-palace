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
  expiryAt, classifyExpiry, isLongLived, reviewDeadline, reviewOverdue, TRASH_DAYS,
} from './trivia-age.js'

const TRIVIA_DIR = 'trivia'
const INDEX_FILE = 'index.jsonl'
const TRASH_DIR = '.triviatrash'

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
const GENERIC_TAG_WORDS = loadWordSet('../data/stopwords.zh.txt')
for (const w of loadWordSet('../data/generic-tags.zh.txt')) GENERIC_TAG_WORDS.add(w)

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

export function normalizeTriviaTags(tags) {
  if (tags === undefined || tags === null) return { ok: true, tags: [] }
  if (!Array.isArray(tags)) return { ok: false, error: 'tags 必须是数组' }
  const out = []
  for (const raw of tags) {
    const t = String(raw ?? '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (t.length > MAX_TAG_CHARS) return { ok: false, error: `单个 tag 不能超过 ${MAX_TAG_CHARS} 字：${t}` }
    if (/[,，]/.test(t)) return { ok: false, error: `tag 不能含逗号：${t}` }
    if (/[你我他她它您咱]/.test(t)) return { ok: false, error: `tag 不要带人称代词：${t}` }
    if (/(吗|呢|吧|啊|呀|哦|嗯|哈|啦|嘛)$/.test(t)) return { ok: false, error: `tag 不要用语气词：${t}` }
    const stems = tagStems(t)
    if (stems.some((s) => GENERIC_TAG_WORDS.has(s))) {
      return { ok: false, error: `tag 太泛，换更具体的词：${t}` }
    }
    if (!out.includes(t)) out.push(t)
  }
  if (out.length > MAX_TAGS) return { ok: false, error: `最多 ${MAX_TAGS} 个 tag` }
  return { ok: true, tags: out }
}

export function validateTriviaText(text) {
  if (typeof text !== 'string') return { ok: false, error: 'text 必须是字符串' }
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return { ok: false, error: 'text 不能为空' }
  if (t.length > MAX_TEXT_CHARS) return { ok: false, error: `杂事条目不能超过 ${MAX_TEXT_CHARS} 字` }
  return { ok: true, text: t }
}

function parseLine(line) {
  try {
    const item = JSON.parse(line)
    if (!item || typeof item !== 'object' || !item.id || !item.text) return null
    return item
  } catch {
    return null
  }
}

export function listTrivia(cfg, opts = {}) {
  const file = indexFileFor(cfg)
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const items = []
  for (const line of lines) {
    if (!line.trim()) continue
    const item = parseLine(line)
    if (item) items.push(item)
  }
  if (opts.includePending === false) return items.filter((x) => x.pendingReview !== true)
  return items
}

export function readTrivia(cfg, id) {
  return listTrivia(cfg).find((x) => x.id === String(id || '')) || null
}

function writeAll(cfg, items) {
  const dir = triviaDirFor(cfg)
  ensureDir(dir)
  const text = items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : '')
  atomicWrite(indexFileFor(cfg), text)
}

export function addTrivia(cfg, { text, tags }) {
  const textRes = validateTriviaText(text)
  if (!textRes.ok) return textRes
  const tagRes = normalizeTriviaTags(tags)
  if (!tagRes.ok) return tagRes
  if (!tagRes.tags.length) return { ok: false, error: '至少给 1 个具体 tag，方便以后检索' }
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
  }
  item.expiresAt = new Date(expiryAt(item)).toISOString()
  const items = listTrivia(cfg)
  writeAll(cfg, [...items, item])
  return { ok: true, item }
}

export function updateTrivia(cfg, id, { text, tags }) {
  const items = listTrivia(cfg)
  const idx = items.findIndex((x) => x.id === String(id || ''))
  if (idx < 0) return { ok: false, error: '杂事条目不存在', code: 'not-found' }
  const textRes = validateTriviaText(text !== undefined ? text : items[idx].text)
  if (!textRes.ok) return textRes
  const tagRes = normalizeTriviaTags(tags !== undefined ? tags : items[idx].tags)
  if (!tagRes.ok) return tagRes
  if (!tagRes.tags.length) return { ok: false, error: '至少给 1 个具体 tag，方便以后检索' }
  const now = nowIso()
  const next = {
    ...items[idx],
    text: textRes.text,
    tags: tagRes.tags,
    updatedAt: now,
    lastAccessAt: now,
    hits: (Number(items[idx].hits) || 0) + 1,
    pendingReview: false,
    reviewDeadline: '',
  }
  next.expiresAt = new Date(expiryAt(next)).toISOString()
  items[idx] = next
  writeAll(cfg, items)
  return { ok: true, item: next }
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
  items.splice(idx, 1)
  writeAll(cfg, items)
  return { ok: true, removed: 1 }
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

/**
 * 每日维护：重算过期线、分流、复审超时清理、trash 清理。
 * 返回统计，调用方负责写入/刷新与分片。
 */
export function ageTrivia(cfg, now = Date.now()) {
  const items = listTrivia(cfg)
  // 空会话不创建 trivia 目录/空索引。
  if (!items.length && !fs.existsSync(indexFileFor(cfg))) {
    return { total: 0, reviewed: 0, trashed: 0, pruned: 0, kept: 0 }
  }
  const keep = []
  const stats = { total: items.length, reviewed: 0, trashed: 0, pruned: 0, kept: 0 }
  for (const item of items) {
    if (item.pendingReview === true) {
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
      keep.push({
        ...item,
        pendingReview: true,
        reviewDeadline: new Date(reviewDeadline(now)).toISOString(),
      })
      stats.reviewed++
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
