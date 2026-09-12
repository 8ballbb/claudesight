import React, { useEffect, useState } from 'react'
import Editor from './Editor.jsx'
import s from './app.module.css'

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

function SourceState({ report }) {
  const copy = {
    absent: `No ${report.label} directory — nothing is configured there`,
    empty: `${report.label}: empty`,
    denied: `${report.label}: present, unreadable`,
    malformed: `${report.label}: parse error`,
    ok: null,
  }[report.state]
  return copy ? <li className={s.note}>{copy}</li> : null
}

export default function App() {
  const [inv, setInv] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    fetch('/api/inventory').then((r) => r.json()).then(setInv)
  }, [])

  if (!inv) return <p className={s.note}>Loading…</p>

  return (
    <main className={s.page}>
      <header className={s.header}>
        <h1>claude-atlas</h1>
        <p className={s.note}>{inv.root}</p>
      </header>

      {inv.sources?.length > 0 && (
        <ul className={s.sources}>
          {inv.sources.map((r) => <SourceState key={r.label + r.dir} report={r} />)}
        </ul>
      )}

      {inv.denied?.length > 0 && (
        <p className={s.warn}>
          {inv.denied.length} directories unreadable (permission denied) — grant Full Disk
          Access to see them.
        </p>
      )}

      {inv.errors?.length > 0 && (
        <p className={s.warn}>
          {inv.errors.length} directories could not be read (unexpected error) — some artifacts may be missing.
        </p>
      )}

      {inv.groups.map((g) => (
        <section key={g.kind} className={s.group}>
          <h2>{g.kind} <span className={s.count}>{g.items.length}</span></h2>
          <ul>
            {g.items.map((item) => (
              <li key={item.id} className={s.row}>
                <button className={s.name} onClick={() => setOpen(item)}>{item.label}</button>
                <span className={s.meta}>{item.plugin ?? item.origin ?? ''}</span>
                {item.drift === 'drifted' && <span className={s.drift}>drift</span>}
                {item.state && item.state !== 'ok' && <span className={s.drift}>{item.state}</span>}
                {item.malformed && <span className={s.drift}>malformed</span>}
                {item.unreadable && <span className={s.drift}>{item.unreadable}</span>}
                {item.manifestState && item.manifestState !== 'ok' && (
                  <span className={s.drift}>manifest {item.manifestState}</span>
                )}
                <span className={s.klass}>{item.writability.class}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {open && <Editor item={open} post={post} onClose={() => setOpen(null)} />}
    </main>
  )
}
