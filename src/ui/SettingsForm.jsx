import { useEffect, useState } from 'react'
import s from './app.module.css'
import { bandsFor, enumAdvice, setValue, removeKey, addKey, coerce, listAdd, listSetAt, listRemoveAt, pairsToObject, objectToPairs } from './settingsForm.js'

// The form view over a settings file. It edits the same JSON the raw view
// edits — every change serialises straight back into the editor's text buffer
// through onChange — so the two views cannot drift and both go through the one
// gated write. Anything the catalogue does not model stays editable in the raw
// view; the form never becomes a ceiling.

function Control({ entry, value, onChange, disabled }) {
  if (entry.control === 'boolean') {
    return (
      <input type="checkbox" checked={value === true} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} aria-label={entry.key} />
    )
  }
  if (entry.control === 'enum') {
    return (
      <select className={s.labelInput} value={value ?? ''} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} aria-label={entry.key}>
        {(value === undefined || value === null || value === '') && <option value="">— not set —</option>}
        {value != null && value !== '' && !entry.enum.includes(value) && <option value={value}>{String(value)} (not listed)</option>}
        {entry.enum.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    )
  }
  if (entry.control === 'number') {
    return (
      <input type="number" className={s.labelInput} value={value ?? ''} disabled={disabled}
        min={entry.min ?? undefined} max={entry.max ?? undefined}
        onChange={(e) => onChange(coerce('number', e.target.value))} aria-label={entry.key} />
    )
  }
  if (entry.control === 'string') {
    return (
      <input type="text" className={s.labelInput} value={value ?? ''} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} aria-label={entry.key} />
    )
  }
  // A list of scalars: rows of the item control, plus an add. Editing the list
  // hands back a whole new array, so it flows through the same onChange as any
  // other value.
  if (entry.control === 'list') {
    const arr = Array.isArray(value) ? value : []
    const itemEntry = { key: entry.key, control: entry.item?.control ?? 'string', enum: entry.item?.enum }
    const blank = entry.item?.control === 'enum' ? (entry.item.enum?.[0] ?? '') : ''
    return (
      <div className={s.listCtl}>
        {arr.map((v, i) => (
          <div key={i} className={s.listRow}>
            <Control entry={itemEntry} value={v} disabled={disabled}
              onChange={(nv) => onChange(listSetAt(arr, i, nv))} />
            {!disabled && <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => onChange(listRemoveAt(arr, i))}>×</button>}
          </div>
        ))}
        {!disabled && <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => onChange(listAdd(arr, blank))}>+ add item</button>}
        {arr.length === 0 && <span className={s.hint}>empty</span>}
      </div>
    )
  }

  // A string→string map: key/value rows rebuilt from the pairs on each edit.
  if (entry.control === 'map') {
    const pairs = objectToPairs(value)
    const emit = (next) => onChange(pairsToObject(next))
    return (
      <div className={s.listCtl}>
        {pairs.map(([k, v], i) => (
          <div key={i} className={s.mapRow}>
            <input className={s.labelInput} value={k} placeholder="key" disabled={disabled}
              onChange={(e) => emit(pairs.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
            <input className={s.labelInput} value={v} placeholder="value" disabled={disabled}
              onChange={(e) => emit(pairs.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
            {!disabled && <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => emit(pairs.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
        {!disabled && <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => emit([...pairs, ['', '']])}>+ add pair</button>}
        {pairs.length === 0 && <span className={s.hint}>empty</span>}
      </div>
    )
  }

  // A one-level object: each field rendered by its own control, editing the
  // nested object immutably. Fields are leaves, lists or maps — never another
  // object — so this does not recurse without bound.
  if (entry.control === 'object') {
    const obj = value && typeof value === 'object' ? value : {}
    return (
      <div className={s.objectCtl}>
        {entry.fields.map((f) => (
          <div key={f.key} className={s.objectField}>
            <span className={s.fieldKey}>{f.key}</span>
            <Control entry={f} value={obj[f.key]} disabled={disabled}
              onChange={(nv) => onChange(setValue(obj, f.key, nv))} />
            {f.description && <p className={s.hint}>{f.description}</p>}
          </div>
        ))}
      </div>
    )
  }

  // Anything deeper — nested objects, arrays of objects, unions. Shown as its
  // current value; the raw view is where these are edited, deliberately: a
  // fabricated form for a nested shape would promise more than it can keep.
  return <code className={s.cmd}>{JSON.stringify(value)} — edit in JSON view</code>
}

function SetRow({ entry, value, onChange, onRemove, disabled }) {
  const advice = enumAdvice(entry, value)
  return (
    <li className={s.setRow}>
      <div className={s.setHead}>
        <span className={s.setKey}>{entry.key}</span>
        {entry.deprecated && <span className={`${s.chip} ${s.caution}`}>deprecated</span>}
        <Control entry={entry} value={value} onChange={(v) => onChange(entry.key, v)} disabled={disabled} />
        {!disabled && <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => onRemove(entry.key)}>remove</button>}
      </div>
      {entry.description && <p className={s.hint}>{entry.description}</p>}
      {advice && (
        <p className={`${s.hint} ${s.bad}`}>
          Not in the documented set ({advice.allowed.join(', ')}) — may be newer than this catalogue, or a typo.
        </p>
      )}
    </li>
  )
}

export function SettingsForm({ text, onChange, editable, post }) {
  const [catalog, setCatalog] = useState(null)

  useEffect(() => {
    let live = true
    post('/api/settings-catalog').then((c) => { if (live) setCatalog(c) })
    return () => { live = false }
  }, [post])

  let value
  let parseError = null
  try { value = text.trim() ? JSON.parse(text) : {} } catch { parseError = true }

  if (parseError) {
    return <p className={`${s.hint} ${s.bad}`}>This file is not valid JSON — fix it in the JSON view, then the form returns.</p>
  }
  if (!catalog) return <p className={s.loading}>Reading the settings catalogue…</p>
  if (catalog.state !== 'ok') {
    return <p className={`${s.hint} ${s.bad}`}>The settings catalogue is unavailable ({catalog.state}) — edit in the JSON view.</p>
  }

  const emit = (next) => onChange(JSON.stringify(next, null, 2) + '\n')
  const { set, available, unknown } = bandsFor(value, catalog.entries)
  const prov = catalog.provenance

  return (
    <div className={s.settingsForm}>
      {prov && (
        <p className={s.hint}>
          Catalogue reflects Claude Code {prov.syncedTo ?? '(unknown)'}
          {prov.fetchedAt ? `, fetched ${new Date(prov.fetchedAt).toLocaleDateString()}` : ''}.
          A newer Claude Code may accept settings not shown here.
        </p>
      )}

      <h3 className={s.bandHead}>set here <span className={s.groupCount}>{set.length}</span></h3>
      {set.length === 0 && <p className={s.hint}>Nothing set in this file yet.</p>}
      <ul className={s.bandList}>
        {set.map((e) => (
          <SetRow key={e.key} entry={e} value={e.value} disabled={!editable}
            onChange={(k, v) => emit(setValue(value, k, v))}
            onRemove={(k) => emit(removeKey(value, k))} />
        ))}
      </ul>

      {unknown.length > 0 && (
        <>
          <h3 className={s.bandHead}>not in this catalogue <span className={s.groupCount}>{unknown.length}</span></h3>
          <p className={s.hint}>
            Here in the file but not documented in this catalogue — kept untouched. May be newer than {prov?.syncedTo ?? 'it'}, or a typo. Edit in the JSON view.
          </p>
          <ul className={s.bandList}>
            {unknown.map((u) => (
              <li key={u.key} className={s.setRow}>
                <span className={s.setKey}>{u.key}</span>
                <code className={s.cmd}>{JSON.stringify(u.value)}</code>
              </li>
            ))}
          </ul>
        </>
      )}

      {editable && (
        <details className={s.available}>
          <summary className={s.bandHead}>available to add <span className={s.groupCount}>{available.length}</span></summary>
          <ul className={s.bandList}>
            {available.map((e) => (
              <li key={e.key} className={s.availRow}>
                <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => emit(addKey(value, e))}>+ add</button>
                <span className={s.setKey}>{e.key}</span>
                {e.deprecated && <span className={`${s.chip} ${s.caution}`}>deprecated</span>}
                <span className={s.availType}>{e.control === 'enum' ? e.enum.join(' | ') : e.type}</span>
                {e.description && <p className={s.hint}>{e.description}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
