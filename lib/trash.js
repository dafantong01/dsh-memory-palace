/**
 * 软删除目录清理：只清普通文件，不碰索引和子目录。
 * 默认保留 30 天，最多 200 个文件；删文件后触发，不做定时器。
 */
import fs from 'node:fs'
import path from 'node:path'

export function pruneTrash(dir, opts = {}) {
  const days = Number.isFinite(Number(opts.days)) && Number(opts.days) > 0 ? Number(opts.days) : 30
  const maxFiles = Number.isFinite(Number(opts.maxFiles)) && Number(opts.maxFiles) > 0 ? Number(opts.maxFiles) : 200
  const result = { removed: 0, kept: 0, errors: [] }
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return result
  }
  const files = []
  for (const name of names) {
    const full = path.join(dir, name)
    let stat
    try {
      stat = fs.statSync(full)
      if (!stat.isFile()) continue
    } catch {
      continue
    }
    files.push({ name, full, mtimeMs: stat.mtimeMs })
  }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  for (const file of files) {
    if (file.mtimeMs >= cutoff) continue
    try {
      fs.unlinkSync(file.full)
      result.removed += 1
    } catch (err) {
      result.errors.push(`${file.name}: ${String(err?.message ?? err)}`)
    }
  }
  const remaining = files
    .filter((file) => file.mtimeMs >= cutoff && fs.existsSync(file.full))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
  while (remaining.length > maxFiles) {
    const file = remaining.shift()
    try {
      fs.unlinkSync(file.full)
      result.removed += 1
    } catch (err) {
      result.errors.push(`${file.name}: ${String(err?.message ?? err)}`)
    }
  }
  result.kept = Math.max(0, files.length - result.removed)
  return result
}
