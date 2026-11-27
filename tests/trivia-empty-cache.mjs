import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listTrivia, recallTrivia } from '../lib/trivia.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trivia-empty-cache-'))
const cfg = { dir: path.join(root, 'ns'), triviaInterest: 5 }
try {
  assert.deepEqual(listTrivia(cfg), [])
  assert.deepEqual(recallTrivia(cfg, '测试环境备份'), [])
  console.log('SUMMARY trivia-empty-cache 2/2')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
