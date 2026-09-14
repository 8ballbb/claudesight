import React, { useCallback, useEffect, useState } from 'react'
import Editor from './Editor.jsx'
import Inventory, { Notices } from './Inventory.jsx'
import Projects from './Projects.jsx'
import { useCloseGuard, CloseGuard } from './closeGuard.jsx'
import s from './app.module.css'

export const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

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

  if (!open) return <button className={s.newBtn} onClick={() => setOpen(true)}>+ new skill</button>

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

function GlobalView({ inv, reload, guard }) {
  const [created, setCreated] = useState(null)

  const afterCreate = async (r) => {
    const fresh = await reload()
    const item = fresh?.groups.flatMap((g) => g.items).find((i) => i.id === r.id)
    if (item) guard.request(item)
    setCreated(r.warning ?? 'Created. Its first version is saved as "created".')
  }

  return (
    <div className={`${s.body} ${guard.open ? s.split : ''}`}>
      <div>
        <Notices inv={inv} />
        {created && (
          <p className={s.createdNote}>
            {created}
            <button className={s.linkQuiet} onClick={() => setCreated(null)}>dismiss</button>
          </p>
        )}
        <Inventory
          inv={inv}
          openId={guard.open?.id}
          onOpen={guard.request}
          extras={{ skill: <NewSkill onCreated={afterCreate} /> }}
        />
      </div>
      {guard.open && (
        <Editor
          key={guard.open.id}
          item={guard.open}
          post={post}
          onClose={() => guard.request(null)}
          onDirtyChange={guard.onDirtyChange}
          onSaved={reload}
        />
      )}
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('global')
  const [inv, setInv] = useState(null)
  const [failed, setFailed] = useState(null)
  const guard = useCloseGuard()

  const reload = useCallback(async () => {
    try {
      const r = await fetch('/api/inventory')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const fresh = await r.json()
      setInv(fresh)
      return fresh
    } catch (e) {
      setFailed(e.message)
      return null
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  if (failed) return <p className={s.loading}>Could not load inventory: {failed}</p>
  if (!inv) return <p className={s.loading}>Reading configuration…</p>

  const total = inv.groups.reduce((n, g) => n + g.items.length, 0)
  const editable = inv.groups.reduce(
    (n, g) => n + g.items.filter((i) => ['free', 'exec'].includes(i.writability.class)).length, 0)

  return (
    <main className={s.page}>
      <header className={s.header}>
        <h1 className={s.wordmark}>claude·atlas</h1>
        <nav className={s.nav}>
          <button
            className={`${s.navTab} ${page === 'global' ? s.navOn : ''}`}
            onClick={() => guard.request(null, () => setPage('global'))}
          >
            global
          </button>
          <button
            className={`${s.navTab} ${page === 'projects' ? s.navOn : ''}`}
            onClick={() => guard.request(null, () => setPage('projects'))}
          >
            projects
          </button>
        </nav>
        <span className={s.rootPath}>{page === 'global' ? inv.root : 'per-project configuration'}</span>
        <span className={s.tally}>
          {page === 'global' && <><b>{total}</b> artifacts · <b>{editable}</b> editable</>}
        </span>
        <ThemePicker />
      </header>

      {page === 'global'
        ? <GlobalView inv={inv} reload={reload} guard={guard} />
        : <Projects post={post} guard={guard} />}

      <CloseGuard pending={guard.pending} onKeep={guard.keepEditing} onDiscard={guard.discard} />
    </main>
  )
}
