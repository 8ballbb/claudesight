import fs from 'node:fs'
import os from 'node:os'
import { diffText } from './linediff.js'
import path from 'node:path'
import crypto from 'node:crypto'
import { moveToTrash } from './trash.js'

// Explicit, user-created restore points. Distinct from the writer's automatic
// pre-write backup, which stays beside the original and stays deliberately
// dumb — a safety net must not depend on anything more complex than the write
// it protects.
//
// Sidecars are the source of truth. index.json is a convenience view, rewritten
// best-effort after each mutation and rebuildable by walking the tree, so no
// correctness depends on it and concurrent writers cannot corrupt the store.

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const keyFor = (target) => sha(path.resolve(target)).slice(0, 16)

export function storeRoot(home = os.homedir()) {
  return path.join(home, '.claudescope', 'versions')
}

// Snapshots of settings.json can contain an `env` block with API keys, so the
// mode is asserted rather than assumed — the mode argument is umask-masked.
function ensureDir(dir, home) {
  fs.mkdirSync(dir, { recursive: true })
  // Every directory we create, not just the leaf: mkdir's recursive mode does
  // not apply to intermediates, and the mode argument is umask-masked anyway.
  const chain = [path.join(home, '.claudescope'), storeRoot(home), dir]
  for (const d of chain) {
    fs.chmodSync(d, 0o700)
    const mode = fs.statSync(d).mode & 0o777
    if (mode !== 0o700) throw new Error(`${d} mode ${mode.toString(8)} is not 700`)
  }
}

function dirFor(target, home) {
  return path.join(storeRoot(home), keyFor(target))
}

function newId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`
}

export function listVersions(target, home = os.homedir()) {
  const dir = dirFor(target, home)
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const out = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      if (meta && meta.id) out.push(meta)
    } catch { /* a damaged sidecar hides one version, never the whole list */ }
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1))
}

export function createVersion(target, label, home = os.homedir()) {
  let content
  try {
    content = fs.readFileSync(target)
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, error: 'missing' }
    if (err.code === 'EACCES' || err.code === 'EPERM') return { ok: false, error: 'denied' }
    throw err
  }

  const dir = dirFor(target, home)
  ensureDir(dir, home)

  const id = newId()
  const snap = path.join(dir, `${id}.snap`)
  const fd = fs.openSync(snap, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, content)
    const mode = fs.fstatSync(fd).mode & 0o777
    if (mode !== 0o600) throw new Error(`snapshot mode ${mode.toString(8)} is not 600`)
  } finally {
    fs.closeSync(fd)
  }

  const meta = {
    id,
    path: path.resolve(target),
    at: new Date().toISOString(),
    label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 200) : null,
    bytes: content.length,
    hash: sha(content),
  }
  const metaFd = fs.openSync(path.join(dir, `${id}.json`), 'wx', 0o600)
  try {
    fs.writeFileSync(metaFd, JSON.stringify(meta, null, 2))
  } finally {
    fs.closeSync(metaFd)
  }

  refreshIndex(home)
  return { ok: true, version: meta }
}

// What will a restore actually change? Until now the only way to know was to
// restore and look. The bytes were always here; nothing new is read from disk
// that the app was not already reading.
export function compareVersion(target, id, home = os.homedir()) {
  const snapshot = readVersion(target, id, home)
  let current = null
  let currentReason = null
  try {
    current = fs.readFileSync(target, 'utf8')
  } catch (err) {
    currentReason = err.code === 'ENOENT' ? 'the file no longer exists' : `the file could not be read (${err.code})`
  }
  if (snapshot === null) {
    return { state: 'unverifiable', reason: 'this version snapshot could not be read', lines: [], addCount: 0, delCount: 0 }
  }
  if (current === null) {
    return { state: 'unverifiable', reason: currentReason, lines: [], addCount: 0, delCount: 0 }
  }
  // current -> snapshot, because that is what restoring does. Diffing the
  // other way round and flipping the signs in the UI works until someone
  // reads only one half of it.
  return diffText(current, snapshot, { beforeLabel: 'the current file', afterLabel: 'the version' })
}

export function readVersion(target, id, home = os.homedir()) {
  if (!/^[0-9A-Za-z._-]+$/.test(id)) return null
  const snap = path.join(dirFor(target, home), `${id}.snap`)
  try {
    return fs.readFileSync(snap, 'utf8')
  } catch {
    return null
  }
}

// Deletion goes to the platform trash, never to oblivion — the point is that
// it stays recoverable outside this app. If trashing fails, nothing is
// removed. `forceMechanism` exists so tests can trash into a temp home
// instead of littering the real Trash.
export function deleteVersion(target, id, home = os.homedir(), forceMechanism = null) {
  if (!/^[0-9A-Za-z._-]+$/.test(id)) return { ok: false, error: 'bad-id' }
  const dir = dirFor(target, home)
  const snap = path.join(dir, `${id}.snap`)
  const meta = path.join(dir, `${id}.json`)
  if (!fs.existsSync(snap)) return { ok: false, error: 'unknown-version' }

  // One self-describing folder, so the Trash entry says what it is and the
  // snapshot inside carries the original filename rather than a hash.
  const box = path.join(home, '.claudescope', '.trashing',
    `claudescope-version-${path.basename(target)}-${id}`)
  fs.rmSync(box, { recursive: true, force: true })
  fs.mkdirSync(box, { recursive: true })

  fs.copyFileSync(snap, path.join(box, path.basename(target)))
  let info = {}
  try { info = JSON.parse(fs.readFileSync(meta, 'utf8')) } catch { /* damaged sidecar */ }
  fs.writeFileSync(path.join(box, 'metadata.json'), JSON.stringify({
    ...info,
    deletedAt: new Date().toISOString(),
    restoreTo: path.resolve(target),
  }, null, 2))

  const trashed = moveToTrash(box, home, forceMechanism)
  if (!trashed.ok) {
    fs.rmSync(box, { recursive: true, force: true })
    return trashed // the originals are untouched
  }

  fs.rmSync(snap, { force: true })
  fs.rmSync(meta, { force: true })
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  } catch { /* leaving an empty directory is harmless */ }
  refreshIndex(home)
  return { ok: true, mechanism: trashed.mechanism }
}

// Derived view: which files have versions, and where. Rebuilt from the
// sidecars, so a lost or corrupt index costs nothing.
export function refreshIndex(home = os.homedir()) {
  const root = storeRoot(home)
  let keys
  try {
    keys = fs.readdirSync(root)
  } catch {
    return null
  }
  const files = {}
  for (const key of keys) {
    const dir = path.join(root, key)
    let stat
    try { stat = fs.statSync(dir) } catch { continue }
    if (!stat.isDirectory()) continue
    const versions = []
    let sourcePath = null
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
        sourcePath = meta.path ?? sourcePath
        versions.push({ id: meta.id, at: meta.at, label: meta.label, bytes: meta.bytes })
      } catch { /* skip damaged sidecar */ }
    }
    if (versions.length > 0) {
      files[key] = { path: sourcePath, versions: versions.sort((a, b) => (a.id < b.id ? 1 : -1)) }
    }
  }
  const index = { version: 1, generatedAt: new Date().toISOString(), files }
  try {
    fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(index, null, 2), { mode: 0o600 })
  } catch { /* the index is a convenience, never a dependency */ }
  return index
}
