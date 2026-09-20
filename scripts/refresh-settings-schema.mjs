#!/usr/bin/env node
// Refreshes the bundled Claude Code settings schema from SchemaStore.
//
// The app makes no outbound requests, ever, so it cannot fetch the schema at
// runtime and cannot derive it from the installed binary (a 302MB compiled
// blob with no schema file and no `config schema` command). The schema is
// therefore BUNDLED and refreshed out-of-band, here, at authoring time —
// network at build time is fine because this is not the app.
//
// SchemaStore maintains the schema and stamps each update with the Claude Code
// version it was synced to ("sync settings to Claude Code v2.1.220"). We record
// that version, the fetch date, the licence and a hash, so the app can state
// exactly how current the catalogue is rather than implying it is authoritative
// about the user's installed version.
//
//   node scripts/refresh-settings-schema.mjs         # fetch + write
//   node scripts/refresh-settings-schema.mjs --check  # report drift, write nothing
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const RAW = 'https://raw.githubusercontent.com/SchemaStore/schemastore/master/src/schemas/json/claude-code-settings.json'
const COMMITS = 'https://api.github.com/repos/SchemaStore/schemastore/commits?path=src/schemas/json/claude-code-settings.json&per_page=20'
const LICENSE = 'Apache-2.0'
const SOURCE = 'https://www.schemastore.org/claude-code-settings.json'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(here, '..', 'data')
const schemaFile = path.join(dataDir, 'claude-code-settings.schema.json')
const metaFile = path.join(dataDir, 'settings-schema.meta.json')

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'claudesight-refresh' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json()
}
async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'claudesight-refresh' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.text()
}

// The Claude Code version the latest SchemaStore commit synced to, e.g.
// "sync settings and keybindings to Claude Code v2.1.220" → "v2.1.220".
async function syncedVersion() {
  // The version is stamped only on the periodic "sync to Claude Code vX"
  // commits; interleaved fixes ("drop key", "allow wildcard") carry none, so
  // the newest commit often has no version. Walk back to the most recent one
  // that names a Claude Code version.
  const commits = await getJson(COMMITS)
  for (const c of commits) {
    const message = c.commit?.message ?? ''
    const version = /Claude Code (v\d+\.\d+\.\d+)/i.exec(message)?.[1]
    if (version) return { version, date: c.commit?.author?.date ?? null, message: message.split('\n')[0] }
  }
  const first = commits[0]?.commit
  return { version: null, date: first?.author?.date ?? null, message: (first?.message ?? '').split('\n')[0] }
}

const check = process.argv.includes('--check')

const schemaText = await getText(RAW)
JSON.parse(schemaText) // fail loudly if SchemaStore served something unparseable
const hash = sha(schemaText)
const synced = await syncedVersion()

if (check) {
  let current = null
  try { current = JSON.parse(fs.readFileSync(metaFile, 'utf8')) } catch { /* not yet bundled */ }
  const bundled = current?.syncedTo ?? '(none)'
  const upstream = synced.version ?? '(unparsed)'
  const stale = current?.sha256 !== hash
  console.log(`bundled:  ${bundled}  (${current?.sha256?.slice(0, 12) ?? '—'})`)
  console.log(`upstream: ${upstream}  (${hash.slice(0, 12)})  ${synced.message}`)
  if (stale) {
    console.log('\nDRIFT: SchemaStore has a newer schema. Run without --check to refresh.')
    process.exit(1)
  }
  console.log('\nup to date.')
  process.exit(0)
}

fs.mkdirSync(dataDir, { recursive: true })
fs.writeFileSync(schemaFile, schemaText)
fs.writeFileSync(metaFile, JSON.stringify({
  source: SOURCE,
  license: LICENSE,
  syncedTo: synced.version,
  syncedCommit: synced.message,
  syncedCommitDate: synced.date,
  fetchedAt: process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
    : new Date().toISOString(),
  sha256: hash,
}, null, 2) + '\n')

console.log(`Wrote ${path.relative(process.cwd(), schemaFile)} (synced to ${synced.version}, sha ${hash.slice(0, 12)})`)
