import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = fs.readFileSync(path.join(root, 'lib', 'index.js'), 'utf8')

// @deepseek-ai/schemastery does not expose z.enum; using it makes the whole
// plugin entry fail to load and the HTTP route disappears.
assert.equal(source.includes('z.enum('), false, 'schemastery has no z.enum; use z.union([z.const(...)])')
assert.ok(source.includes("z.union([z.const('off')"), 'provider enum must be a union of consts')
console.log('SUMMARY plugin-schema-guard 2/2')
