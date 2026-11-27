/**
 * 软删除目录清理：只清普通文件，不碰索引和子目录。
 * 默认保留 30 天，最多 200 个文件；删文件后触发，不做定时器。
 */
import fs from 'node:fs'
import path from 'node:path'

export function pruneTrash(dir, opts = {}) {
  const days = Number.isFinite(Number(opts.days)) && Number(opts.days) > 0 ? Number(opts.days) : 30
  const maxFiles = Number.isFinite(Number(opts.maxFiles)) && Number(opts.maxFiles) > 0 ? Number(opts.maxFiles) : 200
  const recursive = opts.recursive === true
  const result = { removed: 0, kept: 0, errors: [] }
  let files = []
  const collect = (current) => {
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (recursive) collect(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = fs.statSync(full)
        files.push({ name: entry.name, full, mtimeMs: stat.mtimeMs })
      } catch { /* 单个文件读不到就跳过 */ }
    }
  }
  collect(dir)
  if (files.length === 0) return result
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
  if (recursive) {
    const pruneDirs = (current) => {
      let entries
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const full = path.join(current, entry.name)
        pruneDirs(full)
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full)
        } catch { /* 非空或删不掉就留着 */ }
      }
    }
    pruneDirs(dir)
  }
  return result
}
