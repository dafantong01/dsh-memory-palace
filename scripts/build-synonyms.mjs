/**
 * 从 Chinese-Synonyms 的 cndict.txt 生成压缩索引。
 * 用法：node scripts/build-synonyms.mjs <cndict.txt>
 * 运行时不联网，只加载 data/synonyms.v1.json.gz。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const src = process.argv[2]
if (!src || !fs.existsSync(src)) {
  console.error('usage: node scripts/build-synonyms.mjs <cndict.txt>')
  process.exit(1)
}
const text = fs.readFileSync(src, 'utf8')
const groups = []
for (const line of text.split(/\r?\n/)) {
  const words = line.trim().split(/\s+/).filter((w) => w && w.length <= 16)
  if (words.length < 2) continue
  const uniq = [...new Set(words)]
  if (uniq.length < 2) continue
  groups.push(uniq)
}
const payload = {
  version: 1,
  source: 'Chinese-Synonyms (shangfr/Chinese-Synonyms)',
  sourceUrl: 'https://github.com/shangfr/Chinese-Synonyms',
  license: 'Apache-2.0',
  generatedAt: new Date().toISOString(),
  groups,
}
const out = path.join(process.cwd(), 'data', 'synonyms.v1.json.gz')
fs.mkdirSync(path.dirname(out), { recursive: true })
const raw = Buffer.from(JSON.stringify(payload), 'utf8')
fs.writeFileSync(out, zlib.gzipSync(raw, { level: 9 }))
console.log(JSON.stringify({
  groups: groups.length,
  rawBytes: raw.length,
  gzBytes: fs.statSync(out).size,
  out,
}, null, 2))
