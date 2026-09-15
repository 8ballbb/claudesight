import React, { useEffect, useRef, useState } from 'react'
import Inventory, { Notices } from './Inventory.jsx'
import Editor from './Editor.jsx'
import s from './app.module.css'

const LAST_PROJECT = 'claudescope.lastProject'

// Below this the two panes stack, because a 320px list beside a 320px
// inventory is worse than either one full width.
const STACK_AT = 900

// How many marker chips fit a project row before it would clip.
const MARKERS_SHOWN = 4

const MARKER_ORDER = ['memory', 'settings', 'mcp', 'skills', 'claudeDir', 'pluginSource', 'git']
const MARKER_LABEL = {
  memory: 'CLAUDE.md', settings: 'settings', mcp: '.mcp.json',
  skills: 'skills', claudeDir: '.claude', pluginSource: 'plugin source', git: 'git',
}

export default function Projects({ post, guard, frozen }) {
  const [found, setFound] = useState(null)
  const [selected, setSelected] = useState(null)
  const [inv, setInv] = useState(null)
  const [adding, setAdding] = useState('')
  const [addError, setAddError] = useState(null)
  const [busy, setBusy] = useState(false)
  const detail = useRef(null)

  // Side by side, the picked project is simply visible — no scrolling needed
  // and the list keeps its place. Below the stacking breakpoint the old
  // layout returns, and so does the scroll that made it usable.
  const stacked = () => {
    try { return window.matchMedia(`(max-width: ${STACK_AT}px)`).matches } catch { return false }
  }

  useEffect(() => {
    if (selected && stacked() && detail.current) {
      detail.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selected])

  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then(setFound)
  }, [])

  const pick = async (project) => {
    setSelected(project)
    guard.request(null)
    setInv(null)
    // Remembered like fold state is, so returning to this page returns you to
    // what you were looking at rather than to nothing.
    try { window.localStorage.setItem(LAST_PROJECT, project.path) } catch { /* non-fatal */ }
    const r = await post('/api/project-inventory', { path: project.path })
    setInv(r.error ? null : r)
    if (r.error) setAddError(r.reason ?? r.error)
  }

  // Restore the last project, but only once and only if it is still discovered
  // and still on disk — a remembered path that has since gone must not
  // resurrect as a selection the page cannot fill.
  const restored = useRef(false)
  useEffect(() => {
    if (!found || restored.current) return
    restored.current = true
    let last = null
    try { last = window.localStorage.getItem(LAST_PROJECT) } catch { /* storage blocked */ }
    if (!last) return
    const match = found.projects.find((p) => p.path === last && p.exists)
    if (match) pick(match)
  }, [found]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className={`${s.body} ${guard.open ? s.split : ''}`}>
      <div className={s.projectsSplit}>
        <section className={`${s.group} ${s.projectList}`}>
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
                <button
                  className={s.rowName}
                  onClick={() => pick(p)}
                  disabled={!p.exists}
                  title={p.path}
                >
                  {p.path.split('/').slice(-2).join('/')}
                </button>
                <span className={s.rowMeta} title={p.path}>{p.path}</span>
                <span className={s.rowTail}>
                  {!p.exists && <span className={`${s.chip} ${s.alarm}`}>gone</span>}
                  {p.exists && !p.configured && <span className={`${s.chip} ${s.locked}`}>no config</span>}
                  {(() => {
                    // A row that silently clips its last chip is the same lie as
                    // a count standing in for the paths behind it. Show what
                    // fits, then say how many did not.
                    const found = p.markers ? MARKER_ORDER.filter((m) => p.markers[m]) : []
                    const shown = found.slice(0, MARKERS_SHOWN)
                    const hidden = found.length - shown.length
                    return (
                      <>
                        {shown.map((m) => (
                          <span
                            key={m}
                            className={`${s.chip} ${m === 'git' ? s.locked : s.free}`}
                            title={`${MARKER_LABEL[m]} found in this project`}
                          >
                            {MARKER_LABEL[m]}
                          </span>
                        ))}
                        {hidden > 0 && (
                          <span
                            className={`${s.chip} ${s.locked}`}
                            title={found.map((m) => MARKER_LABEL[m]).join(', ')}
                          >
                            +{hidden}
                          </span>
                        )}
                      </>
                    )
                  })()}
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
          <section className={`${s.group} ${s.projectDetail}`} ref={detail}>
            <div className={s.groupHead}>
              <h2 className={s.groupName}>{selected.path.split('/').pop()}</h2>
              <span className={s.groupRule} />
              {inv && (
                <span className={s.groupSplit}>
                  {(() => {
                    const n = inv.groups.reduce((a, g) => a + g.items.length, 0)
                    return `${n} artifact${n === 1 ? '' : 's'}`
                  })()}
                </span>
              )}
            </div>
            <p className={s.path}>{selected.path}</p>
            {!inv && <p className={s.loading}>Reading…</p>}
            {inv && <Notices inv={inv} />}
            {inv && <Inventory inv={inv} openId={guard.open?.id} onOpen={guard.request} scope="project" />}
          </section>
        )}
        {!selected && (
          <section className={`${s.group} ${s.projectDetail}`}>
            <p className={s.hint}>Pick a project to see what is configured in it.</p>
          </section>
        )}
      </div>

      {guard.open && (
        <Editor
          key={guard.open.id}
          item={guard.open}
          post={post}
          onClose={() => guard.request(null)}
          onDirtyChange={guard.onDirtyChange}
          onSaved={() => selected && pick(selected)}
          frozen={frozen}
        />
      )}
    </div>
  )
}
