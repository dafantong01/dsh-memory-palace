#!/usr/bin/env node
/**
 * 发布前检查插件展示元数据。
 *
 * 用法（在 profile 目录下，能解析到已安装包）：
 *   node %TEMP%\check-meta.mjs @dafantong01/dsh-memory-palace
 * 或直接检查源码目录：
 *   node scripts/check-meta.mjs .
 *
 * 注意：脚本如果放在包内运行，Node 的 self-reference 会解析到包自身而不是
 * profile 里的安装副本；验证安装版时请把脚本复制到包外再跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const arg = process.argv[2] || '.'
const notes = []
const errors = []

function ok(msg) { notes.push('  ✓ ' + msg) }
function fail(msg) { errors.push(msg) }

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
    fail(`${label} 无法解析：${e.message}`)
    return undefined
  }
}

function checkMetaFile(file, label) {
  if (!fs.existsSync(file)) { fail(`缺少 ${label}`); return }
  const data = readJson(file, label)
  if (!data) return
  if (typeof data.meta !== 'object' || data.meta === null) { fail(`${label} 缺少 meta 对象`); return }
  for (const key of ['title', 'description']) {
    if (typeof data.meta[key] !== 'string' || data.meta[key].trim() === '') fail(`${label} 的 meta.${key} 为空或不是字符串`)
    else ok(`${label} meta.${key} = ${data.meta[key]}`)
  }
}

function checkPackageFields(pkg) {
  const exp = pkg.exports
  if (!exp || typeof exp !== 'object') {
    fail('package.json 缺少 exports 对象')
  } else {
    const keys = Object.keys(exp)
    if (!keys.includes('./package.json')) fail('exports 缺少 "./package.json"')
    else ok('exports 导出 ./package.json')
    if (!keys.some((k) => k === './locale/*.json' || k === './locale/*')) fail('exports 缺少 "./locale/*.json"（或 "./locale/*"）')
    else ok('exports 导出 locale')
    if (!keys.includes('./client')) fail('exports 缺少 "./client"')
    else ok('exports 导出 ./client')
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes('locale')) fail('files 未包含 "locale"，npm 打包会漏掉展示元数据')
  else ok('files 包含 locale')
}

function finish() {
  console.log('')
  for (const n of notes) console.log(n)
  if (errors.length) {
    console.error('\n检查失败：')
    for (const e of errors) console.error('  ✗ ' + e)
    process.exitCode = 1
    return
  }
  console.log('\n插件展示元数据检查通过。')
  process.exitCode = 0
}

function checkDirectory(dir) {
  const pkgPath = path.join(dir, 'package.json')
  const pkg = readJson(pkgPath, 'package.json')
  if (!pkg) return
  checkPackageFields(pkg)
  checkMetaFile(path.join(dir, 'locale', 'en.json'), 'locale/en.json')
  checkMetaFile(path.join(dir, 'locale', 'zh.json'), 'locale/zh.json')
  console.log('提示：源码目录模式没有验证 Node 解析；发布前请在 profile 里用包名再跑一次（脚本放包外）。')
}

function checkInstalled(specifier) {
  const req = createRequire(path.join(process.cwd(), '__check_meta__.cjs'))
  let pkgPath
  try {
    pkgPath = req.resolve(`${specifier}/package.json`)
    ok(`resolve ${specifier}/package.json → ${pkgPath}`)
  } catch (e) {
    fail(`无法解析 ${specifier}/package.json：${e.code || e.message}（exports 未导出或包未安装）`)
    return
  }
  const pkg = readJson(pkgPath, `${specifier}/package.json`)
  if (!pkg) return
  checkPackageFields(pkg)
  for (const lang of ['en', 'zh']) {
    const sub = `${specifier}/locale/${lang}.json`
    try {
      const file = req.resolve(sub)
      ok(`resolve ${sub} → ${file}`)
      checkMetaFile(file, `locale/${lang}.json`)
    } catch (e) {
      fail(`无法解析 ${sub}：${e.code || e.message}（exports 是否导出 "./locale/*.json"？）`)
    }
  }
}

const dirArg = (() => { try { return fs.statSync(arg).isDirectory() } catch { return false } })()
if (dirArg) checkDirectory(path.resolve(arg))
else checkInstalled(arg)
finish()
