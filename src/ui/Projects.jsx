import React, { useEffect, useState } from 'react'
import Inventory, { Notices } from './Inventory.jsx'
import Editor from './Editor.jsx'
import s from './app.module.css'

const MARKER_ORDER = ['memory', 'settings', 'mcp', 'skills', 'claudeDir', 'git']
const MARKER_LABEL = {
  memory: 'CLAUDE.md', settings: 'settings', mcp: '.mcp.json',
  skills: 'skills', claudeDir: '.claude', git: 'git',
}

export default function Projects({ post }) {
  const [found, setFound] = useState(null)
  const [selected, setSelected] = useState(null)
  const [inv, setInv] = useState(null)
  const [open, setOpen] = useState(null)
  const [adding, setAdding] = useState('')
  const [addError, setAddError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then(setFound)
  }, [])

  const pick = async (project) => {
    setSelected(project)
    setOpen(null)
    setInv(null)
    const r = await post('/api/project-inventory', { path: project.path })
    setInv(r.error ? null : r)
    if (r.error) setAddError(r.reason ?? r.error)
  }

  const addDirectory = async (e) => {
    e.preventDefault()
    setBusy(true)
    setAddError(null)
    const r = await post('/api/projects/add', { path: adding.trim() })
    setBusy(false)
    if (!r.ok) { setAddError(r.reason ?? r.error); return }
    setAdding('')
    setFound(r)
  }

  if (!found) return <p className={s.loading}>Looking for projects Claude has run in…</p>

  return (
    <div className={`${s.body} ${open ? s.split : ''}`}>
      <div>
        <section className={s.group}>
          <div className={s.groupHead}>
            <h2 className={s.groupName}>projects</h2>
            <span className={s.groupCount}>{found.projects.length}</span>
            <span className={s.groupRule} />
            <span className={s.groupCount}>{found.filtered} filtered</span>
          </div>

          <p className={s.hint}>
            Every directory Claude Code is known to have run in — from the project registry,
            your prompt history and session transcripts combined. No filesystem scan.
          </p>

          <ul className={s.rows}>
            {found.projects.map((p) => (
              <li key={p.path} className={`${s.row} ${selected?.path === p.path ? s.active : ''}`}>
                <span className={s.index}>{p.sessions || '·'}</span>
                <button className={s.rowName} onClick={() => pick(p)} disabled={!p.exists}>
                  {p.path.split('/').slice(-2).join('/')}
                </button>
                <span className={s.rowMeta}>{p.path}</span>
                <span className={s.rowTail}>
                  {!p.exists && <span className={`${s.chip} ${s.alarm}`}>gone</span>}
                  {p.exists && !p.configured && <span className={`${s.chip} ${s.locked}`}>no config</span>}
                  {p.markers && MARKER_ORDER.filter((m) => p.markers[m]).map((m) => (
                    <span key={m} className={`${s.chip} ${m === 'git' ? s.locked : s.free}`}>
                      {MARKER_LABEL[m]}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>

          <form className={s.newForm} onSubmit={addDirectory}>
            <input
              className={s.labelInput}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              placeholder="/path/to/a/project Claude hasn't run in yet"
              aria-label="Add a project directory"
            />
            <button className={`${s.btn} ${s.btnQuiet}`} type="submit" disabled={busy || !adding.trim()}>
              {busy ? 'Adding…' : 'Add directory'}
            </button>
          </form>
          {addError && <p className={`${s.status} ${s.bad}`}>{addError}</p>}
        </section>

        {selected && (
          <section className={s.group}>
            <div className={s.groupHead}>
              <h2 className={s.groupName}>{selected.path.split('/').pop()}</h2>
              <span className={s.groupRule} />
            </div>
            <p className={s.path}>{selected.path}</p>
            {!inv && <p className={s.loading}>Reading…</p>}
            {inv && <Notices inv={inv} />}
            {inv && <Inventory inv={inv} openId={open?.id} onOpen={setOpen} scope="project" />}
          </section>
        )}
      </div>

      {open && (
        <Editor
          key={open.id}
          item={open}
          post={post}
          onClose={() => setOpen(null)}
          onSaved={() => selected && pick(selected)}
        />
      )}
    </div>
  )
}
