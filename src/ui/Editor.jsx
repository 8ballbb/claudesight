import React, { useEffect, useState } from 'react'
import s from './app.module.css'

export default function Editor({ item, post, onClose }) {
  const [doc, setDoc] = useState(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState(null)
  const [confirm, setConfirm] = useState(null)

  useEffect(() => {
    post('/api/read', { id: item.id }).then((d) => { setDoc(d); setText(d.content) })
  }, [item.id])

  const save = async (confirmToken) => {
    const r = await post('/api/write', { id: item.id, content: text, etag: doc.etag, confirmToken })
    if (r.ok) { setStatus(`Saved. Backup: ${r.backup}`); setConfirm(null); return }
    if (r.error === 'confirmation_required') { setConfirm(r); return }
    setStatus(`${r.error}: ${r.reason ?? ''}`)
  }

  const cls = item.writability.class
  const editable = cls === 'free' || cls === 'exec'

  return (
    <div className={s.editor}>
      <div className={s.editorHead}>
        <strong>{item.label}</strong>
        <button onClick={onClose}>close</button>
      </div>
      <p className={s.note}>{item.writability.reason}</p>

      {!doc && <p className={s.note}>Loading…</p>}
      {doc && (
        <textarea
          className={s.textarea}
          value={text}
          readOnly={!editable}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      )}

      {confirm && (
        <div className={s.warn}>
          <p>This change installs a command that Claude Code will execute:</p>
          <ul>
            {confirm.changes.map((c) => (
              <li key={c.keyPath}><code>{c.keyPath}</code>: {String(c.before)} → {String(c.after)}</li>
            ))}
          </ul>
          <button onClick={() => save(confirm.confirmToken)}>I understand — install it</button>
        </div>
      )}

      {editable && !confirm && doc && <button onClick={() => save()}>Save</button>}
      {status && <p className={s.note}>{status}</p>}
    </div>
  )
}
