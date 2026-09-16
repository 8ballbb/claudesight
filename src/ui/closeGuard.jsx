import { useCallback, useEffect, useRef, useState } from 'react'
import s from './app.module.css'

// Every way of leaving an open artifact used to discard unsaved edits without
// asking. There were five: the close button, Escape, clicking another row
// (a remount, because Editor is keyed on the item id), and each of the two
// nav tabs. `dirty` was computed in Editor and used only to disable buttons.
//
// This hook owns the open item so that all five paths funnel through one
// `request()`. The file-writing side of this app is careful — lockfile,
// compare-and-swap, backups — and none of that protected the buffer.
export function useCloseGuard() {
  const [open, setOpen] = useState(null)
  const [pending, setPending] = useState(null)
  // A ref, not state: `request` must read the current value without being
  // rebuilt on every keystroke, or every caller's identity churns with it.
  const dirty = useRef(false)

  const onDirtyChange = useCallback((d) => { dirty.current = d }, [])

  // `next` is the item to open, or null to close. `after` runs only if the
  // transition actually happens — that is what makes page switches guardable.
  const request = useCallback((next, after) => {
    const sameItem = next && open && next.id === open.id
    if (!dirty.current || sameItem) {
      setOpen(next ?? null)
      after?.()
      return
    }
    setPending({ next: next ?? null, after, label: open?.label })
  }, [open])

  const keepEditing = useCallback(() => setPending(null), [])

  const discard = useCallback(() => {
    if (!pending) return
    dirty.current = false
    setOpen(pending.next)
    pending.after?.()
    setPending(null)
  }, [pending])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Escape resolves the prompt the safe way rather than dismissing it into
      // a discard, which would defeat the guard with the same reflex it exists
      // to catch.
      if (pending) { setPending(null); return }
      if (open) request(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending, request])

  return { open, pending, request, keepEditing, discard, onDirtyChange }
}

export function CloseGuard({ pending, onKeep, onDiscard }) {
  const keep = useRef(null)
  useEffect(() => { if (pending) keep.current?.focus() }, [pending])
  if (!pending) return null

  return (
    <div className={s.guardBackdrop} role="dialog" aria-modal="true" aria-labelledby="guard-title">
      <div className={`${s.confirm} ${s.guardBox}`}>
        <p className={s.confirmTitle} id="guard-title">Unsaved edits</p>
        <p className={s.whyText}>
          {pending.label ? <><b>{pending.label}</b> has</> : 'This file has'} changes you have not
          saved. Closing discards them — the version button only helps if you pressed it first.
        </p>
        <div className={s.actions}>
          <button ref={keep} className={s.btn} onClick={onKeep}>Keep editing</button>
          <button className={`${s.btn} ${s.btnQuiet}`} onClick={onDiscard}>Discard and close</button>
        </div>
      </div>
    </div>
  )
}
