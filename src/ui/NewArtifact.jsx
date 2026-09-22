import { useState } from 'react'
import s from './app.module.css'

// The four kinds that can be created, and what each one needs from you.
// Memory has a fixed filename, so it takes no name. A rule is unconditional
// prose, so it needs no description; a skill and a subagent are both selected
// BY their description, so for those it is required rather than optional.
const KIND = {
  memory: { label: 'CLAUDE.md', name: false, description: false },
  rule: { label: 'rule', name: true, description: false },
  skill: { label: 'skill', name: true, description: true },
  agent: { label: 'subagent', name: true, description: true },
  settings: { label: 'settings.json', name: false, description: false },
}

const DESCRIPTION_HINT = {
  skill: 'description — when should Claude use this?',
  agent: 'description — when should Claude delegate to this?',
}

export function NewArtifact({ kind, project, onCreated, post }) {
  const spec = KIND[kind]
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!spec) return null

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await post('/api/create', {
      kind,
      name: spec.name ? name.trim() : undefined,
      description: spec.description ? description : undefined,
      // Absent at global scope. The server resolves this against the projects
      // it has already discovered; it is never a path to write to.
      project,
    })
    setBusy(false)
    if (!r.ok) { setError(r.reason ?? r.error); return }
    setOpen(false); setName(''); setDescription('')
    onCreated(r)
  }

  if (!open) {
    return <button className={s.newBtn} onClick={() => setOpen(true)}>+ new {spec.label}</button>
  }

  const incomplete = (spec.name && !name.trim()) || (spec.description && !description.trim())

  return (
    <form className={s.newForm} onSubmit={submit}>
      {spec.name && (
        <input
          className={s.labelInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name (lower-case, hyphens)"
          aria-label={`${spec.label} name`}
          autoFocus
        />
      )}
      {spec.description && (
        <input
          className={s.labelInput}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={DESCRIPTION_HINT[kind]}
          aria-label={`${spec.label} description`}
        />
      )}
      <button className={s.btn} type="submit" disabled={busy || incomplete}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      <button className={`${s.btn} ${s.btnQuiet}`} type="button" onClick={() => { setOpen(false); setError(null) }}>
        Cancel
      </button>
      {error && <p className={`${s.status} ${s.bad}`}>{error}</p>}
    </form>
  )
}

// The affordances a scope offers, keyed by the group they belong under.
//
// CLAUDE.md is the one kind with a fixed filename, so a second one cannot be
// created. Offering a button whose only possible outcome is "already exists"
// is an indicator promising something the page cannot deliver, so it is left
// out when the file is already there. Every other kind can have many.
export function creatorsFor({ project, onCreated, post, inv }) {
  const memory = inv?.groups?.find((g) => g.kind === 'memory')?.items ?? []
  // `absent` is a state this app SHOWS: the memory group carries a row for a
  // CLAUDE.md that does not exist yet, so you can see where it would go.
  // Keying on the label alone hid the creator exactly when it was useful.
  const haveClaudeMd = memory.some((i) => i.label === 'CLAUDE.md' && i.state !== 'absent')
  // Same for settings.json: a fixed filename, so once one exists there is
  // nothing to create — you edit it. Offered only when it is genuinely absent,
  // which is the case a user with no settings needs.
  const settings = inv?.groups?.find((g) => g.kind === 'settings')?.items ?? []
  const haveSettings = settings.some((i) => i.label === 'settings.json' && i.state !== 'absent')

  const singletons = { memory: haveClaudeMd, settings: haveSettings }

  const out = {}
  for (const kind of Object.keys(KIND)) {
    if (singletons[kind]) continue
    out[kind] = (
      <NewArtifact key={kind} kind={kind} project={project} onCreated={onCreated} post={post} />
    )
  }
  return out
}
