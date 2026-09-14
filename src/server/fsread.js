import fs from 'node:fs'
import path from 'node:path'
import { ok, empty, absent, denied, malformed } from './result.js'

const DENIED_CODES = new Set(['EACCES', 'EPERM'])

export function readDirSafe(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return absent(dir)
    if (DENIED_CODES.has(err.code)) return denied(dir, err.code)
    throw err
  }
  return entries.length === 0 ? empty() : ok(entries)
}

export function readFileSafe(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return text.length === 0 ? empty() : ok(text)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return absent(file)
    if (DENIED_CODES.has(err.code)) return denied(file, err.code)
    throw err
  }
}

// Never include the raw parser message — Node embeds input context in it,
// which would leak secrets into logs. Spec §9.6.
//
// V8 reports a position for only some syntax errors. For the common multi-line
// cases it gives none, and this used to return line 1 column 1 regardless —
// a confident, wrong answer pointing at the top of a file whose error is
// further down. Unknown is now null, which the UI can say out loud.
function positionOf(text, err) {
  const msg = err.message || ''

  // Newer V8 states it outright: "... at position 7 (line 1 column 8)".
  const explicit = /line (\d+) column (\d+)/.exec(msg)
  if (explicit) return { line: Number(explicit[1]), column: Number(explicit[2]) }

  const at = /position (\d+)/.exec(msg)
  if (!at) return { line: null, column: null }

  const before = text.slice(0, Number(at[1]))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

export function readJsonSafe(file) {
  const raw = readFileSafe(file)
  if (raw.state !== 'ok') return raw
  try {
    return ok(JSON.parse(raw.value))
  } catch (err) {
    const { line, column } = positionOf(raw.value, err)
    return malformed(file, 'Invalid JSON', line, column)
  }
}

// One traversal, shared by the two finders below. Cycle-guarded on resolved
// paths, and tolerant of an unmapped errno: a single bad directory must never
// discard the results gathered before it.
function walkSafe(dir, maxDepth, onDir, onFile) {
  const deniedDirs = []
  const errors = []
  const seen = new Set()

  const visit = (current, depth) => {
    if (depth > maxDepth) return

    // Symlinks can point back up the tree; key the guard on the resolved path.
    let real
    try { real = fs.realpathSync(current) } catch { real = current }
    if (seen.has(real)) return
    seen.add(real)

    let r
    try {
      r = readDirSafe(current)
    } catch (err) {
      errors.push({ path: current, errno: err.code ?? 'UNKNOWN' })
      return
    }
    if (r.state === 'denied') { deniedDirs.push(current); return }
    if (r.state !== 'ok') return

    for (const entry of r.value) {
      const full = path.join(current, entry.name)
      // Dirent.isDirectory() is false for a symlink pointing at a directory,
      // so resolve it explicitly or the subtree vanishes with no signal.
      let isDir = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        try { isDir = fs.statSync(full).isDirectory() } catch { isDir = false }
      }
      if (isDir) { onDir(full, entry.name); visit(full, depth + 1) }
      else onFile(full, entry.name)
    }
  }

  visit(dir, 1)
  return { deniedDirs, errors }
}

export function walkForSafe(dir, filename, maxDepth = 8) {
  const found = []
  const { deniedDirs, errors } = walkSafe(dir, maxDepth,
    () => {},
    (full, name) => { if (name === filename) found.push(full) })
  return { found, denied: deniedDirs, errors }
}

// Agents and commands live in a DIRECTORY of that name, at a depth that varies
// per plugin (the version segment is sometimes literal, sometimes "unknown"),
// so they are found by directory name rather than by path shape.
export function walkForDirSafe(dir, dirname, maxDepth = 8) {
  const found = []
  const { deniedDirs, errors } = walkSafe(dir, maxDepth,
    (full, name) => { if (name === dirname) found.push(full) },
    () => {})
  return { found, denied: deniedDirs, errors }
}
