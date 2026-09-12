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
function positionOf(text, err) {
  const m = /position (\d+)/.exec(err.message || '')
  if (!m) return { line: 1, column: 1 }
  const offset = Number(m[1])
  const before = text.slice(0, offset)
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

export function walkForSafe(dir, filename, maxDepth = 8) {
  const found = []
  const deniedDirs = []
  const visit = (current, depth) => {
    if (depth > maxDepth) return
    const r = readDirSafe(current)
    if (r.state === 'denied') { deniedDirs.push(current); return }
    if (r.state !== 'ok') return
    for (const entry of r.value) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full, depth + 1)
      else if (entry.name === filename) found.push(full)
    }
  }
  visit(dir, 1)
  return { found, denied: deniedDirs }
}
