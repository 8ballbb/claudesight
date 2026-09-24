import { useEffect, useState } from 'react'
import s from './app.module.css'

// The sessions that ran in a project — read-only, because a transcript is
// guarded (editing one breaks --resume). Collapsed by default and loaded only
// when opened: it is a secondary view, and there is no reason to touch the
// transcript store on every project you select. Detail shows metadata and the
// prompts you typed, not the assistant's replies.

const when = (iso) => { try { return new Date(iso).toLocaleString() } catch { return iso } }
const day = (iso) => { try { return new Date(iso).toLocaleDateString() } catch { return iso } }
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function Detail({ project, session, post, onBack }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let live = true
    post('/api/session', { path: project, id: session.id }).then((r) => {
      if (!live) return
      if (r.state === 'ok') setD(r)
      else setErr(true)
    }).catch(() => { if (live) setErr(true) })
    return () => { live = false }
  }, [project, session.id, post])

  return (
    <div className={s.sessionDetail}>
      <button className={s.quietButton} onClick={onBack}>← all sessions</button>
      {err && <p className={`${s.hint} ${s.bad}`}>That session could not be read.</p>}
      {!d && !err && <p className={s.loading}>Reading the transcript…</p>}
      {d && (
        <>
          <h3 className={s.sessionTitle}>{d.title ?? '(untitled session)'}</h3>
          <dl className={s.sessionMeta}>
            <div><dt>started</dt><dd>{d.firstTs ? when(d.firstTs) : '—'}</dd></div>
            <div><dt>last activity</dt><dd>{d.lastTs ? when(d.lastTs) : '—'}</dd></div>
            <div><dt>messages</dt><dd>{d.messageCount}</dd></div>
            <div><dt>model</dt><dd>{d.model ?? '—'}</dd></div>
          </dl>
          <h4 className={s.bandHead}>your prompts <span className={s.groupCount}>{d.prompts.length}{d.capped ? '+' : ''}</span></h4>
          {d.prompts.length === 0 && <p className={s.hint}>No typed prompts — this session was driven by slash commands or a continuation.</p>}
          <ol className={s.promptList}>
            {d.prompts.map((p, i) => (
              <li key={i} className={s.promptRow}>
                {p.at && <span className={s.promptAt}>{when(p.at)}</span>}
                <span className={s.promptText}>{p.text}</span>
              </li>
            ))}
          </ol>
          {d.capped && <p className={s.hint}>Only the first {d.prompts.length} prompts are shown.</p>}
        </>
      )}
    </div>
  )
}

export function SessionsPanel({ project, post }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [chosen, setChosen] = useState(null)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && list === null) {
      post('/api/sessions', { path: project }).then((r) => setList(r)).catch(() => setList({ state: 'error', sessions: [] }))
    }
  }

  return (
    <section className={s.group}>
      <h2 className={s.groupHead}>
        <button className={s.groupToggle} onClick={toggle} aria-expanded={open}>
          <span className={s.caret} data-open={open ? 'yes' : undefined} aria-hidden="true">&#9656;</span>
          <span className={s.groupName}>sessions</span>
          {list?.sessions && <span className={s.groupCount}>{list.sessions.length}</span>}
        </button>
        <span className={s.groupRule} />
      </h2>
      {open && (
        <div>
          {list === null && <p className={s.loading}>Reading…</p>}
          {list && list.state !== 'ok' && (
            <p className={s.hint}>No sessions recorded in this project yet.</p>
          )}
          {list && list.state === 'ok' && chosen && (
            <Detail project={project} session={chosen} post={post} onBack={() => setChosen(null)} />
          )}
          {list && list.state === 'ok' && !chosen && (
            <ul className={s.rows}>
              {list.sessions.map((sess) => (
                <li key={sess.id} className={s.row}>
                  <span className={s.index} title={sess.lastActivity}>{day(sess.lastActivity)}</span>
                  <button className={s.rowName} onClick={() => setChosen(sess)} title={sess.id}>
                    {sess.title ?? '(untitled session)'}
                  </button>
                  <span className={s.rowTail}><span className={s.availType}>{kb(sess.bytes)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
