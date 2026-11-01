/**
 * 记忆宫殿 · 工作区数据布局迁移（纯 Node，无 DSH runtime 依赖）
 *
 * 目标布局：
 *   <cwd>/memory-palace/.layout.json
 *   <cwd>/memory-palace/<会话>/<YYYY-MM>/...      对话归档（保持原位）
 *   <cwd>/memory-palace/<会话>/_core/...           热记忆
 *   <cwd>/memory-palace/<会话>/_docs/...           项目档案
 *
 * 旧布局（仅开发期出现过）：
 *   <cwd>/memory-core/<会话>/...
 *   <cwd>/memory-docs/<会话>/...
 *
 * v0.1 的 memory-palace 归档不需要搬；只会写布局清单。
 * 所有操作：先备份、再移动、校验文件数/字节；目标存在绝不覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const LAYOUT_VERSION = 2
const ROOT = 'memory-palace'
const LAYOUT_FILE = '.layout.json'
const LOCK_FILE = '.layout.lock'
const MIGRATIONS_DIR = '.migrations'

function layoutPath(cwd) {
  return path.join(cwd, ROOT, LAYOUT_FILE)
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function countBytes(dir) {
  let files = 0
  let bytes = 0
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) walk(p)
      else if (st.isFile()) { files++; bytes += st.size }
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return { files, bytes }
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dst, name)
    const st = fs.statSync(s)
    if (st.isDirectory()) copyTree(s, d)
    else if (st.isFile()) fs.copyFileSync(s, d)
  }
}

function readLayout(cwd) {
  try {
    return JSON.parse(fs.readFileSync(layoutPath(cwd), 'utf8'))
  } catch {
    return null
  }
}

function writeLayout(cwd, data) {
  const p = layoutPath(cwd)
  const tmp = `${p}.tmp-${process.pid}-${randomUUID()}`
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, p)
}

function acquireLock(cwd) {
  const dir = path.join(cwd, ROOT)
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, LOCK_FILE)
  try {
    const fd = fs.openSync(p, 'wx')
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8')
    fs.closeSync(fd)
    return { ok: true, path: p }
  } catch (err) {
    if (err && err.code === 'EEXIST') return { ok: false, busy: true, path: p }
    return { ok: false, error: String(err?.message ?? err) }
  }
}

function releaseLock(lock) {
  if (!lock || !lock.path) return
  try { fs.unlinkSync(lock.path) } catch { /* ignore */ }
}

function planMoves(cwd) {
  const moves = []
  const conflicts = []
  for (const kind of ['core', 'docs']) {
    const srcRoot = path.join(cwd, `memory-${kind}`)
    if (!fs.existsSync(srcRoot)) continue
    for (const name of fs.readdirSync(srcRoot)) {
      const src = path.join(srcRoot, name)
      if (!fs.statSync(src).isDirectory()) continue
      const dst = path.join(cwd, ROOT, name, `_${kind}`)
      if (fs.existsSync(dst)) conflicts.push({ kind, session: name, src, dst })
      else moves.push({ kind, session: name, src, dst })
    }
  }
  return { moves, conflicts }
}

/**
 * 保证工作区布局。默认执行；dryRun 只返回计划。
 * 返回 { ok, moved, conflicts, layout, backupRoot?, warnings? }
 */
export function ensureLayout(cwd, opts = {}) {
  const dryRun = opts.dryRun === true
  if (!cwd) return { ok: false, error: '缺少工作区路径' }
  const root = path.join(cwd, ROOT)
  const previous = readLayout(cwd)
  const { moves, conflicts } = planMoves(cwd)

  // 没有任何数据：不创建空目录。
  if (!fs.existsSync(root) && moves.length === 0) {
    return { ok: true, moved: [], conflicts, layout: previous, skipped: true }
  }

  const next = previous && previous.schemaVersion === LAYOUT_VERSION
    ? previous
    : {
      schemaVersion: LAYOUT_VERSION,
      migrations: Array.isArray(previous?.migrations) ? previous.migrations : [],
      updatedAt: previous?.updatedAt || '',
    }

  if (conflicts.length) {
    return {
      ok: false,
      error: `检测到 ${conflicts.length} 个迁移冲突；目标已存在，未覆盖任何文件`,
      moved: [], conflicts, layout: previous,
    }
  }

  if (dryRun) {
    return { ok: true, dryRun: true, moves, conflicts, layout: next, wouldWrite: !previous || previous.schemaVersion !== LAYOUT_VERSION }
  }

  const lock = acquireLock(cwd)
  if (!lock.ok) {
    return { ok: false, busy: lock.busy === true, error: lock.busy ? '另一个迁移正在进行' : lock.error, moved: [], conflicts, layout: previous }
  }

  const moved = []
  const warnings = []
  const backupRoot = path.join(root, MIGRATIONS_DIR, `${stamp()}-${process.pid}`)
  try {
    for (const m of moves) {
      const before = countBytes(m.src)
      const backup = path.join(backupRoot, m.kind, m.session)
      copyTree(m.src, backup)
      const copy = countBytes(backup)
      if (copy.files !== before.files || copy.bytes !== before.bytes) {
        throw new Error(`备份校验失败：${m.src}`)
      }
      fs.mkdirSync(path.dirname(m.dst), { recursive: true })
      if (fs.existsSync(m.dst)) throw new Error(`目标在迁移过程中出现，拒绝覆盖：${m.dst}`)
      fs.renameSync(m.src, m.dst)
      const after = countBytes(m.dst)
      if (after.files !== before.files || after.bytes !== before.bytes) {
        throw new Error(`迁移校验失败：${m.dst}`)
      }
      moved.push({ ...m, files: after.files, bytes: after.bytes, backup })
    }
    next.updatedAt = new Date().toISOString()
    next.migrations = Array.isArray(next.migrations) ? next.migrations : []
    if (!next.migrations.includes('v0.1-archive-in-place')) next.migrations.push('v0.1-archive-in-place')
    if (moved.length && !next.migrations.includes('v0.2-core-docs-to-v0.3')) next.migrations.push('v0.2-core-docs-to-v0.3')
    writeLayout(cwd, next)
    if (moved.length) {
      warnings.push(`已迁移 ${moved.length} 个目录；备份在 ${path.relative(cwd, backupRoot)}`)
    }
    return { ok: true, moved, conflicts, layout: next, backupRoot, warnings }
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message ?? err),
      moved, conflicts, layout: previous,
      backupRoot: fs.existsSync(backupRoot) ? backupRoot : undefined,
      warnings: moved.length ? ['部分目录已移动，请按 backupRoot 恢复或重试'] : warnings,
    }
  } finally {
    releaseLock(lock)
  }
}

/** 只读状态，不创建目录、不加锁。 */
export function layoutStatus(cwd) {
  const layout = readLayout(cwd)
  const { moves, conflicts } = planMoves(cwd)
  const root = path.join(cwd, ROOT)
  return {
    ok: true,
    cwd,
    rootExists: fs.existsSync(root),
    schemaVersion: layout?.schemaVersion ?? null,
    migrations: layout?.migrations ?? [],
    updatedAt: layout?.updatedAt ?? null,
    pendingMoves: moves,
    conflicts,
  }
}
