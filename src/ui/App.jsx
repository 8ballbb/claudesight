import React, { useCallback, useEffect, useState } from 'react'
import Editor from './Editor.jsx'
import s from './app.module.css'

export const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

// A reader can fail four distinguishable ways, and the whole point of this tool
// is that they never collapse into a bare zero.
const SOURCE_NOTE = {
  absent: (dir) => `${dir} does not exist — nothing is configured there`,
  empty: (dir) => `${dir} exists but is empty`,
  denied: (dir) => `${dir} exists but could not be read (permission denied)`,
  malformed: (dir) => `${dir} could not be parsed`,
}

// The internal class names are precise but they are not English. Show the
// consequence; the detail panel explains the distinction.
const CLASS_LABEL = {
  free: 'editable',
  exec: 'executable',
  redirect: 'read-only',
  readonly: 'read-only',
  guarded: 'protected',
}

const THEMES = [
  ['Instrument', [['instrument-dark', 'Dark'], ['instrument-light', 'Light']]],
  ['Cyberpunk', [['cyber-dark', 'Dark'], ['cyber-light', 'Light']]],
  ['Pastels', [['pastel-dark', 'Dark'], ['pastel-light', 'Light']]],
]

const THEME_KEY = 'atlas.theme'
const DEFAULT_THEME = 'instrument-dark'
const VALID = new Set(THEMES.flatMap(([, opts]) => opts.map(([v]) => v)))

function ThemePicker() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY)
      if (saved && VALID.has(saved)) return saved
    } catch { /* storage blocked — fall through to the default */ }
    return DEFAULT_THEME
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { window.localStorage.setItem(THEME_KEY, theme) } catch { /* non-fatal */ }
  }, [theme])

  return (
    <select
      className={s.themePick}
      value={theme}
      onChange={(e) => setTheme(e.target.value)}
      aria-label="Colour theme"
    >
      {THEMES.map(([label, opts]) => (
        <optgroup key={label} label={label}>
          {opts.map(([value, mode]) => (
            <option key={value} value={value}>{label} · {mode}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

const CLASS_CHIP = {
  free: s.free,
  exec: s.exec,
  redirect: s.locked,
  readonly: s.locked,
  guarded: s.caution,
}

function meta(item) {
  if (item.kind === 'memory') return `${item.bytes} bytes`
  if (item.kind === 'settings') return `${item.keys} keys`
  if (item.kind === 'hookScript' || item.kind === 'statusLineScript') return item.keyPath
  if (item.kind === 'skill') return [item.plugin, item.description].filter(Boolean).join(' · ')
  if (item.kind === 'plugin') {
    return [item.recordedVersion, item.scope].filter(Boolean).join(' · ')
  }
  return item.path
}

function Chips({ item }) {
  const out = []
  if (item.state && item.state !== 'ok') out.push([item.state, s.caution])
  if (item.malformed) out.push(['malformed', s.alarm])
  if (item.unreadable) out.push([item.unreadable, s.alarm])
  if (item.drift === 'drifted') out.push(['drift', s.alarm])
  if (item.drift === 'unknown-version') out.push(['no version', s.caution])
  if (item.manifestState && item.manifestState !== 'ok') {
    out.push([`manifest ${item.manifestState}`, s.alarm])
  }
  if (item.enabled === false) out.push(['disabled', s.locked])
  const cls = item.writability.class
  out.push([CLASS_LABEL[cls] ?? cls, CLASS_CHIP[cls] ?? s.locked])
  return (
    <span className={s.rowTail}>
      {out.map(([text, tone], i) => (
        <span key={`${text}-${i}`} className={`${s.chip} ${tone}`}>{text}</span>
      ))}
    </span>
  )
}

function NewSkill({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await post('/api/create', { kind: 'skill', name: name.trim(), description })
    setBusy(false)
    if (!r.ok) { setError(r.reason ?? r.error); return }
    setOpen(false); setName(''); setDescription('')
    onCreated(r)
  }

  if (!open) {
    return (
      <button className={s.newBtn} onClick={() => setOpen(true)}>+ new skill</button>
    )
  }

  return (
    <form className={s.newForm} onSubmit={submit}>
      <input
        className={s.labelInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="name (lower-case, hyphens)"
        aria-label="Skill name"
        autoFocus
      />
      <input
        className={s.labelInput}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="description — when should Claude use this?"
        aria-label="Skill description"
      />
      <button className={s.btn} type="submit" disabled={busy || !name.trim() || !description.trim()}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      <button className={`${s.btn} ${s.btnQuiet}`} type="button" onClick={() => { setOpen(false); setError(null) }}>
        Cancel
      </button>
      {error && <p className={`${s.status} ${s.bad}`}>{error}</p>}
    </form>
  )
}

export default function App() {
  const [inv, setInv] = useState(null)
  const [open, setOpen] = useState(null)
  const [failed, setFailed] = useState(null)
  const [created, setCreated] = useState(null)

  const afterCreate = async (r) => {
    const fresh = await fetch('/api/inventory').then((x) => x.json())
    setInv(fresh)
    const item = fresh.groups.flatMap((g) => g.items).find((i) => i.id === r.id)
    if (item) setOpen(item)
    setCreated(r.warning ?? `Created. Its first version is saved as "created".`)
  }

  const load = useCallback(() => {
    fetch('/api/inventory')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setInv)
      .catch((e) => setFailed(e.message))
  }, [])

  useEffect(load, [load])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (failed) return <p className={s.loading}>Could not load inventory: {failed}</p>
  if (!inv) return <p className={s.loading}>Reading configuration…</p>

  const total = inv.groups.reduce((n, g) => n + g.items.length, 0)
  const editable = inv.groups.reduce(
    (n, g) => n + g.items.filter((i) => ['free', 'exec'].includes(i.writability.class)).length, 0)

  const notes = (inv.sources ?? [])
    .filter((r) => r.state !== 'ok')
    .map((r) => ({ tag: r.label, text: SOURCE_NOTE[r.state]?.(r.dir) ?? `${r.dir}: ${r.state}` }))

  if (inv.denied?.length) {
    notes.push({
      tag: 'unreadable',
      text: `${inv.denied.length} directories could not be read (permission denied)`,
      attn: true,
    })
  }
  if (inv.errors?.length) {
    notes.push({
      tag: 'errors',
      text: `${inv.errors.length} directories failed unexpectedly — some artifacts may be missing`,
      attn: true,
    })
  }

  return (
    <main className={s.page}>
      <header className={s.header}>
        <h1 className={s.wordmark}>claude·atlas</h1>
        <span className={s.rootPath}>{inv.root}</span>
        <span className={s.tally}>
          <b>{total}</b> artifacts · <b>{editable}</b> editable
        </span>
        <ThemePicker />
      </header>

      {notes.length > 0 && (
        <ul className={s.notices}>
          {notes.map((n) => (
            <li key={n.tag + n.text} className={`${s.notice} ${n.attn ? s.attn : ''}`}>
              <span className={s.noticeTag}>{n.tag}</span>
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={`${s.body} ${open ? s.split : ''}`}>
        <div>
          {inv.groups.map((g) => (
            <section key={g.kind} className={s.group}>
              <div className={s.groupHead}>
                <h2 className={s.groupName}>{g.kind}</h2>
                <span className={s.groupCount}>{g.items.length}</span>
                <span className={s.groupRule} />
                {g.kind === 'skill' && <NewSkill onCreated={afterCreate} />}
              </div>
              {g.kind === 'skill' && created && (
                <p className={s.createdNote}>
                  {created}
                  <button className={s.linkQuiet} onClick={() => setCreated(null)}>dismiss</button>
                </p>
              )}
              <ul className={s.rows}>
                {g.items.map((item, i) => (
                  <li
                    key={item.id}
                    className={`${s.row} ${open?.id === item.id ? s.active : ''}`}
                  >
                    <span className={s.index}>{String(i + 1).padStart(2, '0')}</span>
                    <button className={s.rowName} onClick={() => setOpen(item)}>
                      {item.label}
                    </button>
                    <span className={s.rowMeta}>{meta(item)}</span>
                    <Chips item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {open && (
          <Editor
            key={open.id}
            item={open}
            post={post}
            onClose={() => setOpen(null)}
            onSaved={load}
          />
        )}
      </div>
    </main>
  )
}
