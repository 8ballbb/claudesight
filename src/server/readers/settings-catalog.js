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

// Above this many fixed fields an object is a directory (env), not a form.
const OBJECT_FIELD_CAP = 24

const scalarType = (s) => (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') ?? s.type[0] : s.type ?? null)

// The leaf controls — a single value the UI renders directly. Returns null for
// anything that is not a leaf, so callers can decide what to do with it.
function leafControl(s) {
  if (Array.isArray(s.enum)) return 'enum'
  const type = scalarType(s)
  if (type === 'boolean') return 'boolean'
  if (type === 'integer' || type === 'number') return 'number'
  if (type === 'string') return 'string'
  return null
}

// The control the UI renders for a value. Beyond the leaves it knows three
// composites, and no more: a `list` of leaves, a `map` of string→string, and a
// one-level `object` whose every field is itself a leaf, list or map. Anything
// deeper — an object inside an object, a list of objects, a union — is `json`,
// edited as text. The depth cap is deliberate: a general "render any schema"
// form is a sinkhole whose payoff inverts with depth, so the composites stop
// one level down and never recurse into each other.
function controlFor(schema, root, depth = 0) {
  const s = deref(schema, root)
  const leaf = leafControl(s)
  if (leaf) return leaf
  const type = scalarType(s)

  if (type === 'array') {
    return leafControl(deref(s.items ?? {}, root)) ? 'list' : 'json'
  }
  if (type === 'object') {
    const props = s.properties ?? {}
    const ap = s.additionalProperties
    const apType = ap && typeof ap === 'object' ? scalarType(deref(ap, root)) : null

    // A string map with no fixed keys — modelOverrides and friends.
    if (Object.keys(props).length === 0) {
      return apType === 'string' ? 'map' : 'json'
    }
    // A documented string map: many named string vars PLUS arbitrary ones —
    // env, uniquely. Its own control: a searchable set/add form over the
    // documented keys, one level down, which is why the flat object form (and
    // its field cap) does not fit. The documented keys are fetched on demand,
    // not inlined into every catalogue load.
    if (apType === 'string') return 'envmap'
    // A fixed-key object becomes a form only at the top level, and only when
    // every field is form-able one level down (a leaf, a list, or a map). One
    // deep or irregular field, and the whole object stays json — honest over
    // a half-rendered form.
    if (depth > 0) return 'json'
    // An object form serves a handful of named fields; past that it is a
    // directory, not a form.
    if (Object.keys(props).length > OBJECT_FIELD_CAP) return 'json'
    const formable = Object.values(props).every((p) => controlFor(p, root, depth + 1) !== 'json')
    return formable ? 'object' : 'json'
  }
  return 'json'
}

function entryFor(key, schema, root, depth = 0) {
  const s = deref(schema, root)
  const control = controlFor(schema, root, depth)
  const entry = {
    key,
    control,
    type: scalarType(s),
    description: s.description ?? null,
    enum: Array.isArray(s.enum) ? s.enum : null,
    default: 'default' in s ? s.default : undefined,
    min: typeof s.minimum === 'number' ? s.minimum : null,
    max: typeof s.maximum === 'number' ? s.maximum : null,
    deprecated: s.deprecated === true,
    // The raw sub-schema, so the editor can show the shape of a json-control
    // setting without this reader having to model every nested case. Stripped
    // from the wire payload; `item`/`fields` below carry what the form needs.
    schema: s,
  }
  if (control === 'list') {
    const it = deref(s.items ?? {}, root)
    entry.item = { control: leafControl(it), enum: Array.isArray(it.enum) ? it.enum : null }
  }
  if (control === 'object') {
    // One level of recursion, capped by controlFor's depth guard: these fields
    // are leaves, lists or maps, never further objects.
    entry.fields = Object.entries(s.properties ?? {}).map(([k, v]) => entryFor(k, v, root, depth + 1))
  }
  return entry
}

// The documented sub-keys of a setting the UI edits as a searchable map — env's
// ~340 variables, each with its description. Fetched on demand when that editor
// opens, so the ~34KB of env docs never rides along with every catalogue load.
export function readSettingFields(key, dir = dataDir) {
  const catalog = readSettingsCatalog(dir)
  if (catalog.state !== 'ok') return { state: catalog.state, fields: [] }
  const entry = catalog.entries.get(key)
  if (!entry || entry.control !== 'envmap') return { state: 'absent', fields: [] }
  const props = entry.schema.properties ?? {}
  const fields = Object.entries(props).map(([k, v]) => ({
    key: k,
    description: v?.description ?? null,
    deprecated: v?.deprecated === true,
  }))
  return { state: fields.length ? 'ok' : 'empty', fields }
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
