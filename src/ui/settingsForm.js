// Pure logic behind the settings form. The form is a second view over the
// editor's JSON text buffer, never a separate store: every edit returns a new
// settings object the caller serialises back into that buffer, so the raw-JSON
// view and the form can never disagree, and everything still flows through the
// one gated write path.

// The three bands the editor shows, in the order a user reasons about them:
// what is set here, what could be added, and what is here but the catalogue
// does not recognise. An unknown key is listed, never hidden and never
// removed — it may be newer than the bundled catalogue, or a typo, and this
// app does not decide which by deleting it.
export function bandsFor(value, entries) {
  const obj = value && typeof value === 'object' ? value : {}
  const byKey = new Map(entries.map((e) => [e.key, e]))

  const set = []
  const unknown = []
  for (const key of Object.keys(obj)) {
    const entry = byKey.get(key)
    if (entry) set.push({ ...entry, value: obj[key] })
    else unknown.push({ key, value: obj[key] })
  }

  const available = entries
    .filter((e) => !(e.key in obj))
    .sort((a, b) => Number(Boolean(a.deprecated)) - Number(Boolean(b.deprecated)) || a.key.localeCompare(b.key))

  return { set, available, unknown }
}

// A value outside a documented enum is reported, not corrected — the caller
// renders it as advice. Returns null when the value is fine or the setting has
// no enum to check against.
export function enumAdvice(entry, value) {
  if (!entry?.enum || entry.enum.includes(value)) return null
  return { value, allowed: entry.enum }
}

// Immutable edits. Each returns a NEW object so React sees the change and the
// original buffer is never mutated in place.
export function setValue(value, key, next) {
  return { ...(value ?? {}), [key]: next }
}

export function removeKey(value, key) {
  const next = { ...(value ?? {}) }
  delete next[key]
  return next
}

// Add a catalogue key that is not set yet, seeded with its documented default
// if it has one, else a type-appropriate empty value the user then edits. It
// is never seeded with a fabricated value dressed as a default.
export function addKey(value, entry) {
  const seed = 'default' in entry && entry.default !== undefined
    ? entry.default
    : emptyFor(entry)
  return setValue(value, entry.key, seed)
}

function emptyFor(entry) {
  if (entry.control === 'boolean') return false
  if (entry.control === 'number') return entry.min ?? 0
  if (entry.control === 'enum') return entry.enum?.[0] ?? ''
  if (entry.control === 'string') return ''
  // json-control settings (objects, arrays, unions) start empty so the user
  // fills the shape themselves rather than being handed a guessed skeleton.
  return entry.type === 'array' ? [] : {}
}

// Coerce a control's raw input to the type the setting expects. A number field
// yields a number, a toggle a boolean; a string stays a string. Anything the
// form cannot coerce cleanly is left to the JSON view.
export function coerce(control, raw) {
  if (control === 'boolean') return Boolean(raw)
  if (control === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  return raw
}
