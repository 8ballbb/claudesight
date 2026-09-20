import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The catalogue of every settings.json key Claude Code accepts — its type,
// allowed values, description and default — read from a JSON Schema bundled
// with this package. The app never fetches it (no outbound requests) and can't
// derive it from the installed binary (a compiled blob), so it is refreshed
// out-of-band by scripts/refresh-settings-schema.mjs and shipped as data.
//
// The catalogue advises; it never gatekeeps. A key the schema does not list is
// UNKNOWN, not invalid — it may be newer than the bundled schema, or a typo —
// and the app says which rather than deciding. The schema itself agrees:
// additionalProperties is true.

const here = path.dirname(fileURLToPath(import.meta.url))
// src/server/readers → package root → data
const dataDir = path.join(here, '..', '..', '..', 'data')

// Resolve a local "#/$defs/foo" ref against the root schema. External refs are
// left unresolved — the schema uses only local ones, and a ref we cannot
// resolve degrades to "no detail", never to a crash.
function deref(node, root, seen = new Set()) {
  let cur = node
  while (cur && typeof cur === 'object' && typeof cur.$ref === 'string') {
    if (seen.has(cur.$ref)) return {}
    seen.add(cur.$ref)
    const parts = cur.$ref.replace(/^#\//, '').split('/')
    let target = root
    for (const p of parts) target = target?.[p]
    if (!target) return {}
    cur = target
  }
  return cur ?? {}
}

// The one control the UI can render for a value: a boolean toggle, an enum
// dropdown, a bounded number, a plain string — or `json` for anything richer
// (objects, arrays, unions), which the editor handles as structured JSON. A
// control the schema does not pin down degrades to `json`, never to a guess.
function controlFor(schema, root) {
  const s = deref(schema, root)
  if (Array.isArray(s.enum)) return 'enum'
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type
  if (type === 'boolean') return 'boolean'
  if (type === 'integer' || type === 'number') return 'number'
  if (type === 'string') return 'string'
  return 'json'
}

function entryFor(key, schema, root) {
  const s = deref(schema, root)
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') ?? s.type[0] : s.type ?? null
  return {
    key,
    control: controlFor(schema, root),
    type,
    description: s.description ?? null,
    enum: Array.isArray(s.enum) ? s.enum : null,
    default: 'default' in s ? s.default : undefined,
    min: typeof s.minimum === 'number' ? s.minimum : null,
    max: typeof s.maximum === 'number' ? s.maximum : null,
    deprecated: s.deprecated === true,
    // The raw sub-schema, so the editor can show the shape of a json-control
    // setting without this reader having to model every nested case.
    schema: s,
  }
}

export function readSettingsCatalog(dir = dataDir) {
  const schemaPath = path.join(dir, 'claude-code-settings.schema.json')
  const metaPath = path.join(dir, 'settings-schema.meta.json')

  let raw
  try {
    raw = fs.readFileSync(schemaPath, 'utf8')
  } catch {
    // The bundled catalogue is missing. Say so — the settings still edit as
    // JSON without it, and a silent empty catalogue would read as "Claude Code
    // has no settings", the bare-zero lie this app exists to prevent.
    return { state: 'absent', entries: new Map(), keys: [], provenance: null }
  }
  let root
  try {
    root = JSON.parse(raw)
  } catch {
    return { state: 'malformed', entries: new Map(), keys: [], provenance: null }
  }

  let provenance = null
  try { provenance = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch { /* optional */ }

  const props = root.properties ?? {}
  const entries = new Map()
  for (const [key, schema] of Object.entries(props)) {
    if (key === '$schema') continue
    entries.set(key, entryFor(key, schema, root))
  }
  return {
    state: entries.size ? 'ok' : 'empty',
    entries,
    keys: [...entries.keys()],
    provenance,
  }
}

// Compare a settings object's keys against the catalogue. Values are advised
// on, never rejected: an out-of-enum value is flagged as "the schema lists
// these", because the schema may lag the installed version.
export function classifySettings(value, catalog) {
  const known = []
  const unknown = []
  const outOfEnum = []
  for (const key of Object.keys(value ?? {})) {
    const entry = catalog.entries.get(key)
    if (!entry) { unknown.push(key); continue }
    known.push(key)
    if (entry.enum && !entry.enum.includes(value[key])) {
      outOfEnum.push({ key, value: value[key], allowed: entry.enum })
    }
  }
  return { known, unknown, outOfEnum }
}
