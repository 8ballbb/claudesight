import path from 'node:path'
import { readFileSafe } from '../fsread.js'

const MAX_DEPTH = 4
const IMPORT_RE = /^@([^\s]+)\s*$/gm

function extractImports(text) {
  const out = []
  for (const m of text.matchAll(IMPORT_RE)) out.push(m[1])
  return out
}

export function readMemory(filePath, opts = {}) {
  const depth = opts.depth ?? 0
  const seen = opts.seen ?? new Set()
  const resolved = path.resolve(filePath)

  if (seen.has(resolved)) {
    return { path: resolved, state: 'ok', content: '', bytes: 0, imports: [], cycle: true }
  }
  if (depth >= MAX_DEPTH) {
    return { path: resolved, state: 'ok', content: '', bytes: 0, imports: [], depthExceeded: true }
  }
  seen.add(resolved)

  const raw = readFileSafe(resolved)
  if (raw.state !== 'ok') {
    return { path: resolved, state: raw.state, content: '', bytes: 0, imports: [] }
  }

  const base = path.dirname(resolved)
  const imports = extractImports(raw.value).map((spec) =>
    readMemory(path.resolve(base, spec), { depth: depth + 1, seen }))

  return {
    path: resolved,
    state: 'ok',
    content: raw.value,
    bytes: Buffer.byteLength(raw.value),
    imports,
  }
}

export function flattenMemory(node, acc = []) {
  acc.push(node)
  for (const child of node.imports) flattenMemory(child, acc)
  return acc
}
