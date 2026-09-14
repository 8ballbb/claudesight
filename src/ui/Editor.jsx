import React, { useCallback, useEffect, useState } from 'react'
import s from './app.module.css'

// State what the app DOES, not what would hypothetically happen. Saving is
// refused outright for all three of these — the text below the box is view-only.
const WHY = {
  redirect: {
    title: 'Read-only — saving is refused',
    text: 'An edit here would be reverted, which is why the app refuses the save rather than letting you lose the work later.',
  },
  readonly: {
    title: 'Read-only — saving is refused',
    text: 'Nothing here is yours to write. Managed policy is deployed by your organisation and is root-owned; a marketplace checkout is managed by the plugin commands.',
  },
  guarded: {
    title: 'Protected — saving is refused',
    text: 'Hand-editing this breaks whatever depends on it: an edited transcript stops resuming, and ~/.claude.json holds your sign-in session. Viewing only, in Phase 1.',
  },
}

// The class says saving is refused; the item's own reason says by what, and
// those differ — a plugin update and a claude.ai sync are not the same thing.
export function whyFor(item) {
  const base = WHY[item.writability.class]
  if (!base) return null
  const reason = item.writability.class === 'redirect' && item.writability.reason
  return reason ? { ...base, text: `${reason}. ${base.text}` } : base
}

const READ_ERROR = {
  'not-a-file': 'This artifact is a directory, not a file — there is no text to show. Its details are above.',
  missing: 'This file has disappeared since the inventory was scanned. Reload to rescan.',
  // Distinct from the above: this file was already known to be missing when the
  // inventory was built. Saying it "disappeared" would invent a race that never
  // happened and send the reader looking for the wrong cause.
  'missing-declared': 'There is no file at this path. The command above names it, so Claude Code runs this hook and it fails every time. Create the file to fix it.',
  'unknown id': 'This artifact is no longer in the inventory. Reload to rescan.',
}

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
    return [['origin', item.origin], ['plugin', item.plugin], ['description', item.description]]
      .filter(([, v]) => v)
  }
  if (item.kind === 'agent' || item.kind === 'command') {
    return [
      // The handle you actually type. Plugin artifacts are namespaced by their
      // plugin, so the file's own name is not what invokes it.
      ['invoke as', item.invocable && (item.kind === 'command' ? `/${item.invocable}` : item.invocable)],
      ['origin', item.origin],
      ['plugin', item.plugin],
      ['model', item.model],
      ['description', item.description],
    ].filter(([, v]) => v)
  }
  if (item.kind === 'hookScript' || item.kind === 'statusLineScript') {
    return [
      ['bound to', item.keyPath],
      ['command', item.command],
      // Named only when it is the problem — Claude Code runs this command
      // regardless, so a missing file is a hook that fails on every trigger.
      ['script', item.state === 'absent' ? 'missing — this hook fails every time it fires'
        : item.state === 'denied' ? 'cannot be read — this hook fails every time it fires'
          : null],
    ].filter(([, v]) => v)
  }
  if (item.kind === 'memory') {
    const bytes = doc ? new TextEncoder().encode(doc.content).length : item.bytes
    return [['size', `${bytes} bytes`], ['state', item.state]].filter(([, v]) => v)
  }
  return []
}

const when = (iso) => {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

export default function Editor({ item, post, onClose, onSaved }) {
  const [doc, setDoc] = useState(null)
  const [readErr, setReadErr] = useState(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const [versions, setVersions] = useState(null)
  const [label, setLabel] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

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

  const loadVersions = useCallback(() => {
    if (!editable) return
    post('/api/versions', { id: item.id }).then((r) => setVersions(r.versions ?? []))
  }, [item.id, editable, post])

  useEffect(loadVersions, [loadVersions])

  const refreshDoc = async () => {
    const fresh = await post('/api/read', { id: item.id })
    if (!fresh.error) { setDoc(fresh); setText(fresh.content) }
  }

  const apply = async (result, okText) => {
    if (result.ok) {
      setConfirm(null)
      setStatus({ tone: 'good', text: okText(result) })
      await refreshDoc()
      onSaved?.()
      return
    }
    if (result.error === 'confirmation_required') { setConfirm(result); return }
    if (result.error === 'conflict') {
      setStatus({ tone: 'bad', text: 'Changed on disk since you opened it. Reload to see the current version.' })
      return
    }
    setStatus({ tone: 'bad', text: `${result.error}${result.reason ? ` — ${result.reason}` : ''}` })
  }

  const save = async (confirmToken) => {
    setBusy(true); setStatus(null)
    const r = await post('/api/write', { id: item.id, content: text, etag: doc.etag, confirmToken })
    setBusy(false)
    await apply(r, (x) => `Saved. Backup: ${x.backup.split('/').pop()}`)
  }

  const saveVersion = async () => {
    setBusy(true); setStatus(null)
    const r = await post('/api/versions/create', { id: item.id, label })
    setBusy(false)
    if (r.ok) {
      setLabel('')
      setStatus({ tone: 'good', text: 'Version saved.' })
      loadVersions()
    } else {
      setStatus({ tone: 'bad', text: `Could not save a version: ${r.error}` })
    }
  }

  const restore = async (versionId, confirmToken) => {
    setBusy(true); setStatus(null)
    const r = await post('/api/versions/restore', { id: item.id, versionId, confirmToken })
    setBusy(false)
    if (r.ok && r.unchanged) {
      setStatus({ tone: 'good', text: 'Already identical to that version — nothing written.' })
      return
    }
    // Carry the version id so the confirmation button knows to restore, not save.
    if (r.error === 'confirmation_required') { setConfirm({ ...r, versionId }); return }
    await apply(r, (x) => `Restored. Backup of the previous content: ${x.backup.split('/').pop()}`)
  }

  const removeVersion = async (versionId) => {
    setBusy(true)
    const r = await post('/api/versions/delete', { id: item.id, versionId })
    setBusy(false)
    setPendingDelete(null)
    if (r.ok) { setStatus({ tone: 'good', text: 'Moved to Trash.' }); loadVersions() }
    else setStatus({ tone: 'bad', text: `Nothing deleted — ${r.reason ?? r.error}` })
  }

  const facts = factsFor(item, doc)
  const why = whyFor(item)
  // A script the inventory already flagged as broken is not a stale-scan race.
  const readKey = readErr?.error === 'missing' && item.state === 'absent'
    ? 'missing-declared'
    : readErr?.error
  const dirty = doc && text !== doc.content

  return (
    <aside className={s.detail}>
      <div className={s.detailHead}>
        <span className={s.detailTitle}>{item.label}</span>
        <span className={`${s.chip} ${cls === 'free' ? s.free : cls === 'exec' ? s.exec : s.locked}`}>
          {cls === 'free' ? 'editable' : cls === 'exec' ? 'executable' : cls === 'guarded' ? 'protected' : 'read-only'}
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
            <p className={s.whyTitle}>Editable — Claude Code executes this file</p>
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
              <>
                {/* Not advice to edit — the app refuses writes there too. It is
                    where the copy came from, which is the useful fact. */}
                <p className={s.whyText}>Installed from:</p>
                <code className={s.cmd}>{item.writability.redirectTo}</code>
              </>
            )}
            {item.kind === 'plugin' && <code className={s.cmd}>claude plugin update {item.label}</code>}
          </div>
        )}

        {!openable && (
          <p className={s.hint}>
            No readable manifest for this plugin, so there is no file to open. The facts above come
            from the install record.
          </p>
        )}

        {openable && readErr && (
          <p className={s.hint}>{READ_ERROR[readKey] ?? `Could not read: ${readErr.error}`}</p>
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
                  <button
                    className={`${s.btn} ${s.btnDanger}`}
                    disabled={busy}
                    onClick={() => (confirm.versionId
                      ? restore(confirm.versionId, confirm.confirmToken)
                      : save(confirm.confirmToken))}
                  >
                    {confirm.versionId ? 'Restore it' : 'Install it'}
                  </button>
                  <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              </div>
            )}

            {editable && !confirm && (
              <div className={s.actions}>
                <button className={s.btn} onClick={() => save()} disabled={busy || !dirty}>
                  {busy ? 'Working…' : 'Save'}
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

        {editable && doc && (
          <section className={s.versions}>
            <div className={s.groupHead}>
              <h3 className={s.groupName}>versions</h3>
              <span className={s.groupCount}>{versions ? versions.length : '…'}</span>
              <span className={s.groupRule} />
            </div>

            <div className={s.versionNew}>
              <input
                className={s.labelInput}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="label (optional)"
                aria-label="Version label"
                maxLength={200}
              />
              <button
                className={`${s.btn} ${s.btnQuiet}`}
                onClick={saveVersion}
                disabled={busy || dirty}
                title={dirty ? 'Save your edits first — a version snapshots what is on disk' : undefined}
              >
                Save version
              </button>
            </div>
            {dirty && (
              <p className={s.hint}>
                Unsaved edits. A version snapshots what is on disk, so save first.
              </p>
            )}

            {versions && versions.length === 0 && (
              <p className={s.hint}>No versions yet. Saving one lets you roll back to this exact content later.</p>
            )}

            {versions && versions.length > 0 && (
              <ul className={s.versionList}>
                {versions.map((v) => (
                  <li key={v.id} className={s.versionRow}>
                    <div>
                      <span className={s.versionWhen}>{when(v.at)}</span>
                      {v.label && <span className={s.versionLabel}>{v.label}</span>}
                      <span className={s.versionBytes}>{v.bytes} B</span>
                    </div>
                    {pendingDelete === v.id ? (
                      <div className={s.actions}>
                        <span className={s.deleteWarn}>
                          Moves this version to your Trash. Recover it from there if you change your mind.
                        </span>
                        <button className={`${s.btn} ${s.btnDanger}`} disabled={busy}
                          onClick={() => removeVersion(v.id)}>Delete</button>
                        <button className={`${s.btn} ${s.btnQuiet}`}
                          onClick={() => setPendingDelete(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className={s.actions}>
                        <button className={`${s.btn} ${s.btnQuiet}`} disabled={busy}
                          onClick={() => restore(v.id)}>Restore</button>
                        <button className={s.linkDanger} disabled={busy}
                          onClick={() => setPendingDelete(v.id)}>Delete</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}
