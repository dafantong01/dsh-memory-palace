/**
 * 记忆宫殿 · 家族注册表（纯 Node，无 DSH runtime 依赖）
 *
 * <cwd>/memory-palace/families.json
 * {
 *   version: 1,
 *   families: {
 *     [familyId]: {
 *       familyId, rootSessionId, rootFolder, displayName,
 *       members: [{ sessionId, folder, name }],
 *       status: 'active' | 'abdicated' | 'dissolved',
 *       formerRootSessionId?, createdAt, updatedAt
 *     }
 *   }
 * }
 *
 * 约束：
 * - 一个会话最多属于一个家族
 * - root 只记在 rootSessionId，不重复放进 members
 * - 只用 sessionId 做身份；folder/name 是显示与路径快照
 * - 所有写操作先备份、再原子写；失败不 throw
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

const ROOT = 'memory-palace'
const FILE = 'families.json'
const VERSION = 1

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function filePath(cwd) {
  return path.join(cwd, ROOT, FILE)
}

const META_FILE = 'meta.json'
const JOURNAL_FILE = '.family-journal.json'

function metaPath(cwd, folder) {
  return folder ? path.join(cwd, ROOT, folder, META_FILE) : ''
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

function readMetaSnapshot(cwd, folder) {
  const file = metaPath(cwd, folder)
  if (!file) return null
  try { return { file, text: fs.readFileSync(file, 'utf8') } } catch { return { file, text: null } }
}

function writeMemberMeta(cwd, folder, meta) {
  if (!folder) return
  writeAtomic(metaPath(cwd, folder), JSON.stringify(meta, null, 2) + '\n')
}

function restoreMetaSnapshot(snapshot) {
  if (!snapshot?.file) return
  try {
    if (snapshot.text === null) fs.rmSync(snapshot.file, { force: true })
    else writeAtomic(snapshot.file, snapshot.text)
  } catch { /* rollback best effort */ }
}

function writeJournal(cwd, payload) {
  try {
    writeAtomic(path.join(cwd, ROOT, JOURNAL_FILE), JSON.stringify(payload, null, 2) + '\n')
  } catch { /* journal best effort */ }
}

function recordInvalid(cwd, familyId, action, error) {
  try {
    const file = path.join(cwd, ROOT, 'families.invalid.json')
    let list = []
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { list = [] }
    if (!Array.isArray(list)) list = []
    list.push({ at: now(), familyId: String(familyId || ''), action: String(action || ''), error: String(error || '') })
    writeAtomic(file, JSON.stringify(list.slice(-100), null, 2) + '\n')
  } catch { /* invalid log best effort */ }
}

function emptyState() {
  return { version: VERSION, families: {} }
}

export function loadFamilies(cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(cwd), 'utf8'))
    if (!raw || typeof raw !== 'object' || !raw.families || typeof raw.families !== 'object') {
      return { ok: true, state: emptyState(), warnings: ['families.json 格式不合法，已按空表处理'] }
    }
    return { ok: true, state: { version: Number(raw.version) || VERSION, families: raw.families }, warnings: [] }
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, state: emptyState(), warnings: [] }
    return { ok: false, error: String(err?.message ?? err), state: emptyState() }
  }
}

function saveFamilies(cwd, state) {
  const p = filePath(cwd)
  const dir = path.dirname(p)
  fs.mkdirSync(dir, { recursive: true })
  if (fs.existsSync(p)) {
    const backupDir = path.join(cwd, 'memory-palace-backups')
    fs.mkdirSync(backupDir, { recursive: true })
    fs.copyFileSync(p, path.join(backupDir, `families.json.bak-${stamp()}-${randomUUID().slice(0, 6)}`))
  }
  const tmp = `${p}.tmp-${process.pid}-${randomUUID()}`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, p)
}

function now() {
  return new Date().toISOString()
}

function cloneFamily(f) {
  return { ...f, members: Array.isArray(f.members) ? f.members.map((m) => ({ ...m })) : [] }
}

export function familyOfSession(state, sessionId) {
  for (const family of Object.values(state.families || {})) {
    if (family.rootSessionId === sessionId) return { role: 'root', family: cloneFamily(family) }
    if ((family.members || []).some((m) => m.sessionId === sessionId)) return { role: 'child', family: cloneFamily(family) }
  }
  return null
}

function folderForSession(cwd, sessionId, fallback) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, ROOT, '.namespaces.json'), 'utf8'))
    const v = raw && typeof raw === 'object' ? raw[sessionId] : ''
    if (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(v)) return v
  } catch { /* fall through */ }
  return fallback
}

export function cleanupEmptyFamilies(cwd) {
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  let changed = false
  for (const [id, family] of Object.entries(state.families || {})) {
    const members = Array.isArray(family.members) ? family.members : []
    if (members.length > 0) continue
    const rootFolder = folderForSession(cwd, family.rootSessionId, family.rootFolder)
    const rootDir = rootFolder ? path.join(cwd, ROOT, rootFolder) : ''
    const rootReadable = Boolean(rootDir && fs.existsSync(rootDir) && fs.existsSync(path.join(rootDir, 'config.json')))
    if (family.status === 'abdicated' || !rootReadable) {
      delete state.families[id]
      changed = true
    }
  }
  if (!changed) return { ok: true, changed: false }
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  writeJournal(cwd, { at: now(), action: 'cleanup-empty-families', changed })
  return { ok: true, changed: true }
}

export function familyStatus(cwd, sessionId) {
  try { recoverFamilyJournal(cwd) } catch { /* recovery best effort */ }
  try { cleanupEmptyFamilies(cwd) } catch { /* cleanup best effort */ }
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const found = familyOfSession(loaded.state, sessionId || '')
  let membership = found
  if (found && found.family.status === 'active' && found.family.rootFolder) {
    const rootFolder = folderForSession(cwd, found.family.rootSessionId, found.family.rootFolder)
    const dir = path.join(cwd, ROOT, rootFolder)
    if (!fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'config.json'))) {
      membership = { ...found, family: { ...found.family, status: 'orphaned', derivedStatus: true } }
    }
  }
  return { ok: true, state: loaded.state, membership, warnings: loaded.warnings }
}

export function renameFamilyFolder(cwd, sessionId, nextFolder, nextName) {
  if (!sessionId || !nextFolder) return { ok: true, changed: false }
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const found = familyOfSession(state, sessionId)
  if (!found) return { ok: true, changed: false }
  const family = state.families[found.family.familyId]
  if (!family) return { ok: true, changed: false }
  const name = String(nextName || nextFolder)
  if (found.role === 'root') {
    family.rootFolder = String(nextFolder)
  } else {
    const member = (family.members || []).find((m) => m.sessionId === sessionId)
    if (!member) return { ok: true, changed: false }
    member.folder = String(nextFolder)
    member.name = name
  }
  family.updatedAt = now()
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  writeJournal(cwd, { at: now(), action: 'rename-family-folder', familyId: family.familyId, sessionId, folder: nextFolder })
  return { ok: true, changed: true, role: found.role }
}

export function repairFamilyRootFolders(cwd, folderOfSession) {
  if (!cwd || typeof folderOfSession !== 'function') return { ok: true, changed: false, repaired: [] }
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const repaired = []
  for (const family of Object.values(state.families || {})) {
    const rootFolder = String(family?.rootFolder || '')
    if (rootFolder && fs.existsSync(path.join(cwd, ROOT, rootFolder))) continue
    const sid = String(family?.rootSessionId || '')
    if (!sid) continue
    let actual = ''
    try { actual = String(folderOfSession(sid) || '') } catch { actual = '' }
    if (!actual || !fs.existsSync(path.join(cwd, ROOT, actual))) continue
    family.rootFolder = actual
    family.updatedAt = now()
    repaired.push({ familyId: family.familyId, from: rootFolder, to: actual })
  }
  if (!repaired.length) return { ok: true, changed: false, repaired: [] }
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  writeJournal(cwd, { at: now(), action: 'repair-family-root-folder', repaired })
  return { ok: true, changed: true, repaired }
}

export function renameFamilyDisplayName(cwd, sessionId, nextName) {
  if (!cwd || !sessionId) return { ok: false, error: '缺少会话参数' }
  const raw = String(nextName ?? '')
  if (!raw.trim()) return { ok: false, error: '家族名不能为空' }
  if (raw !== raw.trim()) return { ok: false, error: '家族名的首尾不能有空格' }
  if (raw.length > 32) return { ok: false, error: '家族名最多 32 个字符' }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(raw)) {
    return { ok: false, error: '家族名只能用英文（大小写均可）、数字、空格、下划线、连字符；不能中文，首尾不能是空格或符号' }
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(raw)) return { ok: false, error: '这是 Windows 保留名，换一个' }
  const name = raw
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const found = familyOfSession(state, sessionId)
  if (!found) return { ok: false, error: '当前会话不在家族中' }
  if (found.role !== 'root') return { ok: false, error: '只有母归属可以改家族名' }
  const family = state.families[found.family.familyId]
  if (!family) return { ok: false, error: '家族不存在' }
  if (family.status !== 'active') return { ok: false, error: '家族不是 active，不能改家族名' }
  const lower = name.toLowerCase()
  for (const other of Object.values(state.families || {})) {
    if (!other || other.familyId === family.familyId) continue
    if (String(other.displayName || '').toLowerCase() === lower) {
      return { ok: false, error: `家族名「${name}」已被其他家族使用，换一个` }
    }
  }
  family.displayName = name
  family.updatedAt = now()
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  writeJournal(cwd, { at: now(), action: 'rename-family-name', familyId: family.familyId, sessionId, name })
  return { ok: true, family: cloneFamily(family) }
}

/** 会话被删除后，把已不存在的成员从家族表里清掉；isAlive 由宿主侧提供。 */
export function pruneMissingMembers(cwd, isAlive) {
  if (!cwd || typeof isAlive !== 'function') return { ok: true, changed: false }
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  let changed = false
  for (const family of Object.values(loaded.state.families || {})) {
    if (!Array.isArray(family.members)) continue
    const keep = family.members.filter((m) => {
      try { return Boolean(m?.sessionId) && isAlive(m.sessionId) } catch { return true }
    })
    if (keep.length !== family.members.length) {
      family.members = keep
      family.updatedAt = now()
      changed = true
    }
  }
  if (changed) {
    try { saveFamilies(cwd, loaded.state) } catch { return { ok: false, error: '成员清理保存失败' } }
    writeJournal(cwd, { at: now(), action: 'prune-missing-members' })
  }
  return { ok: true, changed }
}

const ELECTION_LOCK = '.family-election.lock.json'
const ELECTION_LOCK_TTL_MS = 5 * 60 * 1000

function electionLockPath(cwd) {
  return path.join(cwd, ROOT, ELECTION_LOCK)
}

function acquireElectionLock(cwd, owner) {
  const file = electionLockPath(cwd)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx')
      fs.writeFileSync(fd, JSON.stringify({ owner, createdAt: Date.now() }), 'utf8')
      fs.closeSync(fd)
      return { ok: true, file }
    } catch (err) {
      if (err?.code !== 'EEXIST') return { ok: false, error: String(err?.message ?? err) }
      try {
        const lock = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (Date.now() - Number(lock.createdAt || 0) < ELECTION_LOCK_TTL_MS) {
          return { ok: false, busy: true, owner: lock.owner || '' }
        }
        fs.unlinkSync(file)
      } catch {
        try { fs.unlinkSync(file) } catch { /* ignore */ }
      }
    }
  }
  return { ok: false, busy: true }
}

function releaseElectionLock(file) {
  try { fs.unlinkSync(file) } catch { /* ignore */ }
}

function familyLockPath(cwd, familyId) {
  const hash = createHash('sha1').update(String(familyId || '')).digest('hex').slice(0, 12)
  return path.join(cwd, ROOT, '.family-locks', `${hash}.lock.json`)
}

function acquireFamilyLock(cwd, familyId, owner) {
  const file = familyLockPath(cwd, familyId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx')
      fs.writeFileSync(fd, JSON.stringify({ owner, familyId, createdAt: Date.now() }), 'utf8')
      fs.closeSync(fd)
      return { ok: true, file }
    } catch (err) {
      if (err?.code !== 'EEXIST') return { ok: false, error: String(err?.message ?? err) }
      try {
        const lock = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (Date.now() - Number(lock.createdAt || 0) < ELECTION_LOCK_TTL_MS) return { ok: false, busy: true, owner: lock.owner || '' }
        fs.unlinkSync(file)
      } catch {
        try { fs.unlinkSync(file) } catch { /* ignore */ }
      }
    }
  }
  return { ok: false, busy: true }
}

export function withFamilyFileLock(cwd, familyId, fn) {
  const lock = acquireFamilyLock(cwd, familyId, familyId)
  if (!lock.ok) return lock
  try {
    return fn()
  } finally {
    releaseElectionLock(lock.file)
  }
}

export function electRoot(cwd, { familyId, newRootSessionId, newRootFolder, newRootName, bySessionId, keepOldRoot = false }) {
  if (!cwd || !familyId || !newRootSessionId || !newRootFolder) return { ok: false, error: '缺少选举参数' }
  const lock = acquireElectionLock(cwd, newRootSessionId)
  if (!lock.ok) return lock
  try {
    const loaded = loadFamilies(cwd)
    if (!loaded.ok) return loaded
    const state = loaded.state
    const family = state.families[familyId]
    if (!family) return { ok: false, error: '家族不存在' }
    if (bySessionId && family.rootSessionId !== bySessionId) {
      return { ok: false, error: '只有当前母归属可以发起根转移' }
    }
    if (bySessionId) {
      const member = (family.members || []).find((m) => m.sessionId === newRootSessionId)
      if (!member || member.folder !== newRootFolder) {
        return { ok: false, error: '新根必须是本家族的活跃成员' }
      }
      if (family.status !== 'active') return { ok: false, error: '家族不是 active，不能转移根' }
    }
    if (family.rootSessionId === newRootSessionId) return { ok: true, noop: true, family: cloneFamily(family) }
    const oldRootSessionId = family.rootSessionId
    const oldRootFolder = family.rootFolder
    const metas = [oldRootFolder, newRootFolder, ...(family.members || []).map((m) => m.folder)]
      .filter(Boolean)
      .filter((folder, index, list) => list.indexOf(folder) === index)
      .map((folder) => readMetaSnapshot(cwd, folder))
    const stateBefore = JSON.parse(JSON.stringify(state))
    writeJournal(cwd, {
      at: now(),
      action: 'elect',
      familyId,
      newRootSessionId,
      oldRootSessionId,
      oldRootFolder,
      newRootFolder,
      familiesBefore: stateBefore,
      metas: metas.map((snapshot) => ({ file: snapshot.file, text: snapshot.text })),
    })
    family.familyId = newRootSessionId
    family.rootSessionId = newRootSessionId
    family.rootFolder = newRootFolder
    family.displayName = String(newRootName || newRootFolder)
    family.members = (family.members || []).filter((m) => m.sessionId !== newRootSessionId)
    if (keepOldRoot && oldRootFolder && oldRootSessionId && oldRootSessionId !== newRootSessionId
      && !family.members.some((m) => m.sessionId === oldRootSessionId)) {
      family.members.push({ sessionId: oldRootSessionId, folder: oldRootFolder, name: oldRootFolder })
    }
    family.status = 'migrating'
    family.formerRootSessionId = oldRootSessionId
    family.formerRootFolder = oldRootFolder
    family.updatedAt = now()
    delete state.families[familyId]
    state.families[newRootSessionId] = family
    try {
      saveFamilies(cwd, state)
      family.status = 'active'
      family.updatedAt = now()
      saveFamilies(cwd, state)
      writeMemberMeta(cwd, newRootFolder, { sessionId: newRootSessionId, familyId: newRootSessionId, role: 'root' })
      for (const member of family.members) {
        writeMemberMeta(cwd, member.folder, { sessionId: member.sessionId, familyId: newRootSessionId, role: 'child' })
      }
      if (oldRootFolder && oldRootFolder !== newRootFolder) {
        if (keepOldRoot) {
          writeMemberMeta(cwd, oldRootFolder, { sessionId: oldRootSessionId, familyId: newRootSessionId, role: 'child', formerRoot: true, archivedReadOnly: true })
        } else {
          writeMemberMeta(cwd, oldRootFolder, { sessionId: oldRootSessionId, familyId: '', role: 'independent', formerRoot: true, archivedReadOnly: true })
        }
      }
    } catch (err) {
      try { saveFamilies(cwd, stateBefore) } catch { /* rollback best effort */ }
      for (const snapshot of metas) restoreMetaSnapshot(snapshot)
      writeJournal(cwd, { at: now(), action: 'elect-rollback', familyId, newRootSessionId, error: String(err?.message ?? err) })
      return { ok: false, error: `选举写入失败，已回滚：${String(err?.message ?? err)}` }
    }
    writeJournal(cwd, { at: now(), action: 'elect-ok', familyId: newRootSessionId, oldRootSessionId, oldRootFolder, newRootFolder })
    return { ok: true, family: cloneFamily(family), oldRootSessionId, oldRootFolder }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  } finally {
    releaseElectionLock(lock.file)
  }
}

export function transferRoot(cwd, { familyId, fromSessionId, newRootSessionId, newRootName }) {
  if (!cwd || !familyId || !fromSessionId || !newRootSessionId) return { ok: false, error: '缺少根转移参数' }
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const family = loaded.state.families[familyId]
  if (!family) return { ok: false, error: '家族不存在' }
  if (family.rootSessionId !== fromSessionId) return { ok: false, error: '只有当前母归属可以发起根转移' }
  if (family.status !== 'active') return { ok: false, error: '家族不是 active，不能转移根' }
  const member = (family.members || []).find((m) => m.sessionId === newRootSessionId)
  if (!member?.folder) return { ok: false, error: '新根必须是本家族的活跃成员' }
  return electRoot(cwd, {
    familyId,
    newRootSessionId,
    newRootFolder: member.folder,
    newRootName: newRootName || member.name || member.folder,
    bySessionId: fromSessionId,
    keepOldRoot: true,
  })
}

export function recoverFamilyJournal(cwd) {
  const journalPath = path.join(cwd, ROOT, JOURNAL_FILE)
  if (!fs.existsSync(journalPath)) return { ok: true, noop: true }
  let journal
  try { journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) } catch { return { ok: false, error: 'journal 无法解析' } }
  if (!journal || journal.action !== 'elect') return { ok: true, noop: true }
  try {
    const loaded = loadFamilies(cwd)
    if (!loaded.ok) return loaded
    const state = loaded.state
    const target = state.families[journal.newRootSessionId]
    if (target && target.formerRootSessionId === journal.oldRootSessionId) {
      if (target.status === 'migrating') {
        target.status = 'active'
        target.updatedAt = now()
        saveFamilies(cwd, state)
      }
      writeMemberMeta(cwd, journal.newRootFolder, { sessionId: journal.newRootSessionId, familyId: journal.newRootSessionId, role: 'root' })
      for (const member of target.members || []) {
        writeMemberMeta(cwd, member.folder, { sessionId: member.sessionId, familyId: journal.newRootSessionId, role: 'child' })
      }
      if (journal.oldRootFolder && journal.oldRootFolder !== journal.newRootFolder) {
        writeMemberMeta(cwd, journal.oldRootFolder, { sessionId: journal.oldRootSessionId, familyId: '', role: 'independent', formerRoot: true, archivedReadOnly: true })
      }
      writeJournal(cwd, { ...journal, action: 'elect-recovered', recoveredAt: now() })
      return { ok: true, recovered: 'completed', familyId: journal.newRootSessionId }
    }
    if (journal.familiesBefore) saveFamilies(cwd, journal.familiesBefore)
    for (const snapshot of journal.metas || []) restoreMetaSnapshot(snapshot)
    writeJournal(cwd, { ...journal, action: 'elect-rollback-recovered', recoveredAt: now() })
    return { ok: true, recovered: 'rolled-back' }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

export function familyRebuildSources(cwd, family) {
  const out = []
  const seen = new Set()
  const add = (folder, allowCore) => {
    const name = String(folder || '')
    if (!name || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(name)) return
    const key = name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ folder: name, dir: path.join(cwd, ROOT, name), allowCore })
  }
  add(family?.rootFolder, true)
  add(family?.formerRootFolder, true)
  for (const m of family?.members || []) add(m?.folder, false)
  return out
}

/** 重建取源只允许根链/成员归档；成员私有 core 绝不进入族核。 */
export function familyRebuildMaterial(cwd, family) {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      if (/^\d{4}-\d{2}$/.test(e.name)) walkMd(path.join(dir, e.name))
    }
  }
  const walkMd = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walkMd(p)
      else if (e.isFile() && e.name.endsWith('.md')) files.push(p)
    }
  }
  const sources = familyRebuildSources(cwd, family)
  for (const src of sources) {
    if (src.allowCore) walkMd(path.join(src.dir, '_core'))
    walk(src.dir)
  }
  return { has: files.length > 0, files, sources: sources.map((s) => s.folder) }
}

export function markFamilyRebuild(cwd, familyId, reason, material) {
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const family = state.families[familyId]
  if (!family) return { ok: false, error: '家族不存在' }
  if (material && material.has === false) {
    family.rebuildPending = false
    family.rebuildDecision = 'nothing-to-rebuild'
    family.rebuildReason = String(reason || 'no-material')
    family.rebuildResolvedAt = now()
    family.updatedAt = now()
    try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
    return { ok: true, skipped: true, family: cloneFamily(family) }
  }
  family.rebuildPending = true
  family.rebuildReason = String(reason || 'old-root-core-missing')
  family.rebuildSources = Array.isArray(material?.sources) ? material.sources : []
  family.updatedAt = now()
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  return { ok: true, family: cloneFamily(family) }
}

export function resolveFamilyRebuild(cwd, familyId, decision) {
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const family = state.families[familyId]
  if (!family) return { ok: false, error: '家族不存在' }
  if (!family.rebuildPending) return { ok: false, error: '没有待重建标记' }
  family.rebuildPending = false
  family.rebuildDecision = decision === 'yes' ? 'yes' : 'no'
  family.rebuildResolvedAt = now()
  family.updatedAt = now()
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  const sources = familyRebuildSources(cwd, family).map((s) => s.folder)
  return {
    ok: true,
    decision: family.rebuildDecision,
    sources,
    instruction: family.rebuildDecision === 'yes'
      ? `用户同意重建：请只读这些来源整理热记忆，不要编造；不要读 .trash 或已删除条目。来源：${sources.join('、') || '（无）'}`
      : '用户选择保持为空：不要重建热记忆。',
    family: cloneFamily(family),
  }
}

export function assignRoot(cwd, { sessionId, folder, name }) {
  if (!cwd || !sessionId || !folder) return { ok: false, error: '缺少工作区/会话/目录' }
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const existing = familyOfSession(state, sessionId)
  if (existing) {
    // 已解散/已让位且没有成员的旧家族记录，允许同一会话重新建家。
    if (existing.family.status === 'active') return { ok: false, error: '该会话已经属于一个家族' }
    if (existing.family.status === 'abdicated' && (existing.family.members || []).length > 0) {
      return { ok: false, error: '该会话已让位但仍有成员，不能直接重建；请先处理旧家族' }
    }
    delete state.families[existing.family.familyId]
  }
  const at = now()
  const family = {
    familyId: sessionId,
    rootSessionId: sessionId,
    rootFolder: folder,
    displayName: String(name || folder),
    members: [],
    status: 'active',
    createdAt: at,
    updatedAt: at,
  }
  state.families[sessionId] = family
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  try { writeMemberMeta(cwd, folder, { sessionId, familyId: sessionId, role: 'root' }) } catch { /* meta best effort */ }
  return { ok: true, family: cloneFamily(family) }
}

export function joinFamily(cwd, { rootSessionId, sessionId, folder, name }) {
  if (!cwd || !rootSessionId || !sessionId || !folder) return { ok: false, error: '缺少参数' }
  if (rootSessionId === sessionId) return { ok: false, error: '不能加入自己' }
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const family = state.families[rootSessionId]
  if (!family || family.status !== 'active') {
    recordInvalid(cwd, rootSessionId, 'join', '母归属不存在或已失效')
    return { ok: false, error: '母归属不存在或已失效' }
  }
  if (familyOfSession(state, sessionId)) return { ok: false, error: '该会话已经属于一个家族' }
  if ((family.members || []).some((m) => m.sessionId === sessionId)) return { ok: false, error: '已经在家族中' }
  family.members = Array.isArray(family.members) ? family.members : []
  family.members.push({ sessionId, folder, name: String(name || folder) })
  family.updatedAt = now()
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  try { writeMemberMeta(cwd, folder, { sessionId, familyId: rootSessionId, role: 'child' }) } catch { /* meta best effort */ }
  return { ok: true, family: cloneFamily(family) }
}

export function detachFamily(cwd, sessionId) {
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const found = familyOfSession(state, sessionId)
  if (!found) {
    recordInvalid(cwd, sessionId, 'detach', '该会话不属于任何家族')
    return { ok: false, error: '该会话不属于任何家族' }
  }
  if (found.role === 'root') {
    recordInvalid(cwd, found.family.familyId, 'detach', '母归属不能用脱离')
    return { ok: false, error: '母归属不能用脱离；请让位或解散' }
  }
  const family = state.families[found.family.familyId]
  const member = (family.members || []).find((m) => m.sessionId === sessionId)
  family.members = (family.members || []).filter((m) => m.sessionId !== sessionId)
  family.updatedAt = now()
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  if (member?.folder) {
    try { writeMemberMeta(cwd, member.folder, { sessionId, familyId: '', role: 'independent' }) } catch { /* meta best effort */ }
  }
  return { ok: true, family: cloneFamily(family) }
}

export function abdicateRoot(cwd, sessionId) {
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const found = familyOfSession(state, sessionId)
  if (!found || found.role !== 'root') {
    recordInvalid(cwd, sessionId, 'abdicate', '只有母归属可以让位')
    return { ok: false, error: '只有母归属可以让位' }
  }
  const family = state.families[found.family.familyId]
  const rootFolder = family.rootFolder
  family.status = 'abdicated'
  family.formerRootSessionId = sessionId
  family.updatedAt = now()
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  if (rootFolder) {
    try { writeMemberMeta(cwd, rootFolder, { sessionId, familyId: family.familyId, role: 'independent', formerRoot: true }) } catch { /* meta best effort */ }
  }
  return { ok: true, family: cloneFamily(family) }
}

export function dissolveFamily(cwd, sessionId) {
  const loaded = loadFamilies(cwd)
  if (!loaded.ok) return loaded
  const state = loaded.state
  const found = familyOfSession(state, sessionId)
  if (!found || found.role !== 'root') {
    recordInvalid(cwd, sessionId, 'dissolve', '只有母归属可以解散家族')
    return { ok: false, error: '只有母归属可以解散家族' }
  }
  const family = state.families[found.family.familyId]
  const entries = [{ sessionId, folder: family.rootFolder }, ...(family.members || []).map((m) => ({ sessionId: m.sessionId, folder: m.folder }))]
  family.members = []
  family.status = 'dissolved'
  family.updatedAt = now()
  // 解散后不保留空壳家族；否则独立会话会显示成“母归属（已解散）”。
  delete state.families[family.familyId]
  try { saveFamilies(cwd, state) } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  for (const entry of entries) {
    try { writeMemberMeta(cwd, entry.folder, { sessionId: entry.sessionId, familyId: '', role: 'independent' }) } catch { /* meta best effort */ }
  }
  return { ok: true, family: cloneFamily(family) }
}
