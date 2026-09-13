import React, { useEffect, useState } from 'react'
import s from './app.module.css'

// Why a thing cannot be edited, in plain language. A dead read-only box with no
// explanation reads as a broken app; these classes are deliberate.
const WHY = {
  redirect: {
    title: 'Installed copy — edits would be lost',
    text: 'This lives under the plugin cache. Claude Code overwrites it on the next plugin update, so a change here disappears without warning. Edit the marketplace checkout, or fork the file to your own scope.',
  },
  readonly: {
    title: 'Read-only',
    text: 'Nothing here is yours to write. Managed policy is deployed by your organisation; a marketplace checkout is managed by the plugin commands.',
  },
  guarded: {
    title: 'Guarded — not editable from here',
    text: 'Hand-editing this breaks things that depend on it: a transcript stops resuming, and ~/.claude.json holds your sign-in session. View only in Phase 1.',
  },
}

const READ_ERROR = {
  'not-a-file': 'This artifact is a directory, not a file — there is no text to show. Its details are above.',
  missing: 'This file has disappeared since the inventory was scanned. Reload to rescan.',
  'unknown id': 'This artifact is no longer in the inventory. Reload to rescan.',
}

// `doc` is the live read; prefer it over the inventory snapshot, which goes
// stale the moment a save lands.
function factsFor(item, doc) {
  if (item.kind === 'plugin') {
    return [
      ['marketplace', item.marketplace],
      ['scope', item.scope],
      ['recorded', item.recordedVersion],
      ['manifest', item.manifestVersion ?? `— (${item.manifestState})`],
      ['enabled', String(item.enabled)],
      ['repository', item.repository],
      ['installed at', item.installPath],
    ].filter(([, v]) => v !== null && v !== undefined)
  }
  if (item.kind === 'skill') {
    return [
      ['origin', item.origin],
      ['plugin', item.plugin],
      ['description', item.description],
    ].filter(([, v]) => v)
  }
  if (item.kind === 'hookScript' || item.kind === 'statusLineScript') {
    return [['bound to', item.keyPath], ['command', item.command]].filter(([, v]) => v)
  }
  if (item.kind === 'memory') {
    const bytes = doc ? new TextEncoder().encode(doc.content).length : item.bytes
    return [['size', `${bytes} bytes`], ['state', item.state]].filter(([, v]) => v)
  }
  return []
}

export default function Editor({ item, post, onClose, onSaved }) {
  const [doc, setDoc] = useState(null)
  const [readErr, setReadErr] = useState(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const cls = item.writability.class
  const editable = cls === 'free' || cls === 'exec'
  const openable = item.openable !== false

  useEffect(() => {
    if (!openable) return
    let live = true
    post('/api/read', { id: item.id }).then((d) => {
      if (!live) return
      if (d.error) setReadErr(d)
      else { setDoc(d); setText(d.content) }
    })
    return () => { live = false }
  }, [item.id, openable, post])

  const save = async (confirmToken) => {
    setBusy(true)
    setStatus(null)
    const r = await post('/api/write', { id: item.id, content: text, etag: doc.etag, confirmToken })
    setBusy(false)
    if (r.ok) {
      setConfirm(null)
      setStatus({ tone: 'good', text: `Saved. Backup: ${r.backup.split('/').pop()}` })
      const fresh = await post('/api/read', { id: item.id })
      if (!fresh.error) setDoc(fresh)
      onSaved?.()
      return
    }
    if (r.error === 'confirmation_required') { setConfirm(r); return }
    if (r.error === 'conflict') {
      setStatus({ tone: 'bad', text: 'Changed on disk since you opened it. Reload to see the current version.' })
      return
    }
    setStatus({ tone: 'bad', text: `${r.error}${r.reason ? ` — ${r.reason}` : ''}` })
  }

  const facts = factsFor(item, doc)
  const why = WHY[cls]
  const dirty = doc && text !== doc.content

  return (
    <aside className={s.detail}>
      <div className={s.detailHead}>
        <span className={s.detailTitle}>{item.label}</span>
        <span className={`${s.chip} ${cls === 'free' ? s.free : cls === 'exec' ? s.exec : s.locked}`}>
          {cls}
        </span>
        <button className={s.close} onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className={s.detailBody}>
        <p className={s.path}>{item.path}</p>

        {facts.length > 0 && (
          <dl className={s.facts}>
            {facts.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className={s.factKey}>{k}</dt>
                <dd className={s.factVal}>{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}

        {cls === 'exec' && (
          <div className={s.why}>
            <p className={s.whyTitle}>Claude Code executes this file</p>
            <p className={s.whyText}>
              Its entire contents run as shell. Saving requires a second confirmation showing
              exactly what you are installing.
            </p>
          </div>
        )}

        {why && (
          <div className={`${s.why} ${s.flat}`}>
            <p className={s.whyTitle}>{why.title}</p>
            <p className={s.whyText}>{why.text}</p>
            {item.writability.redirectTo && (
              <code className={s.cmd}>{item.writability.redirectTo}</code>
            )}
            {item.kind === 'plugin' && (
              <code className={s.cmd}>claude plugin update {item.label}</code>
            )}
          </div>
        )}

        {!openable && (
          <p className={s.hint}>
            No readable manifest for this plugin, so there is no file to open. The facts above come
            from the install record.
          </p>
        )}

        {openable && readErr && (
          <p className={s.hint}>{READ_ERROR[readErr.error] ?? `Could not read: ${readErr.error}`}</p>
        )}

        {openable && !readErr && !doc && <p className={s.loading}>Reading…</p>}

        {openable && doc && (
          <div className={s.editor}>
            <textarea
              className={s.textarea}
              value={text}
              readOnly={!editable}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              aria-label={`Contents of ${item.label}`}
            />

            {confirm && (
              <div className={s.confirm}>
                <p className={s.confirmTitle}>Confirm — this installs something that runs</p>
                <ul className={s.changes}>
                  {confirm.changes.map((c) => (
                    <li key={c.keyPath}>
                      <div className={s.changeKey}>{c.keyPath} · {c.reason}</div>
                      {c.before != null && <p className={`${s.diffLine} ${s.diffBefore}`}>{String(c.before)}</p>}
                      <p className={`${s.diffLine} ${s.diffAfter}`}>{String(c.after ?? '(removed)')}</p>
                    </li>
                  ))}
                </ul>
                <div className={s.actions}>
                  <button className={`${s.btn} ${s.btnDanger}`} disabled={busy}
                    onClick={() => save(confirm.confirmToken)}>
                    Install it
                  </button>
                  <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {editable && !confirm && (
              <div className={s.actions}>
                <button className={s.btn} onClick={() => save()} disabled={busy || !dirty}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                {dirty && (
                  <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => setText(doc.content)}>
                    Revert
                  </button>
                )}
              </div>
            )}

            {status && <p className={`${s.status} ${status.tone === 'good' ? s.good : s.bad}`}>{status.text}</p>}
          </div>
        )}
      </div>
    </aside>
  )
}
