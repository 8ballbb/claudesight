import React, { useCallback, useState } from 'react'
import s from './app.module.css'

// A reader can fail four distinguishable ways, and the whole point of this
// tool is that they never collapse into a bare zero.
export const SOURCE_NOTE = {
  absent: (dir) => `${dir} does not exist — nothing is configured there`,
  empty: (dir) => `${dir} exists but is empty`,
  denied: (dir) => `${dir} exists but could not be read (permission denied)`,
  malformed: (dir) => `${dir} could not be parsed`,
}

// The internal class names are precise but they are not English. Show the
// consequence; the detail panel explains the distinction.
const CLASS_LABEL = {
  free: 'editable',
  exec: 'executable',
  redirect: 'read-only',
  readonly: 'read-only',
  guarded: 'protected',
}

const CLASS_CHIP = {
  free: s.free,
  exec: s.exec,
  redirect: s.locked,
  readonly: s.locked,
  guarded: s.caution,
}

// The server's `kind` is a field name; these are the words a person uses.
const GROUP_LABEL = {
  memory: 'memory',
  settings: 'settings',
  scripts: 'hook & status scripts',
  skill: 'skills',
  agent: 'agents',
  command: 'commands',
  plugin: 'plugins',
  mcp: 'mcp servers',
  rule: 'rules',
  manifest: 'plugin manifest',
  other: 'not recognised',
}

const EDITABLE = new Set(['free', 'exec'])

function meta(item) {
  if (item.kind === 'memory') return `${item.bytes} bytes`
  if (item.kind === 'settings') return `${item.keys} keys`
  if (item.kind === 'mcp') return `${item.servers} servers`
  if (item.kind === 'hookScript' || item.kind === 'statusLineScript') {
    if (item.state === 'absent') return `${item.keyPath} — no file at this path`
    if (item.state === 'denied') return `${item.keyPath} — file cannot be read`
    return item.keyPath
  }
  // The band header already names the plugin, so the description is all that
  // is left worth showing on the row.
  if (item.kind === 'skill' || item.kind === 'agent' || item.kind === 'command') {
    return item.description ?? ''
  }
  if (item.kind === 'plugin') return [item.recordedVersion, item.scope].filter(Boolean).join(' · ')
  if (item.kind === 'other') {
    return item.entryType === 'directory'
      ? 'directory — no reader for this yet'
      : `${item.bytes ?? '?'} bytes — no reader for this yet`
  }
  return item.path
}

// Items split by who owns them, because ownership is what decides whether you
// can change them: yours first, then one band per plugin that installed the
// rest. Sorted by size so the bulk is obvious at a glance.
export function bandsFor(items) {
  const yours = []
  const owned = new Map()

  for (const item of items) {
    if (EDITABLE.has(item.writability.class)) { yours.push(item); continue }
    const owner = item.plugin ?? item.marketplace ?? null
    const key = owner ?? 'unowned'
    if (!owned.has(key)) {
      owned.set(key, {
        key,
        label: owner ?? 'read-only',
        // The label already names the owner; repeating it in the note just
        // filled the row with the same word twice.
        note: owner ? null : 'read-only',
        items: [],
      })
    }
    owned.get(key).items.push(item)
  }

  const bands = [...owned.values()]
    .sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label))

  if (yours.length) {
    bands.unshift({ key: 'yours', label: 'yours', note: 'you can edit these', items: yours })
  }
  return bands
}

const OPEN_KEY = 'atlas.open'

function loadOpen() {
  try { return JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? '{}') } catch { return {} }
}

// Fold state outlives a reload, so a layout you arranged once stays arranged.
function useOpen(key, fallback) {
  const [open, setOpen] = useState(() => {
    const saved = loadOpen()[key]
    return typeof saved === 'boolean' ? saved : fallback
  })
  const toggle = useCallback(() => {
    setOpen((was) => {
      const next = !was
      try {
        const all = loadOpen()
        all[key] = next
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(all))
      } catch { /* storage blocked — the fold still works for this session */ }
      return next
    })
  }, [key])
  return [open, toggle]
}

function Chips({ item }) {
  const out = []
  if (item.broken) out.push(['broken', s.alarm])
  else if (item.state && item.state !== 'ok') out.push([item.state, s.caution])
  if (item.malformed) out.push(['malformed', s.alarm])
  if (item.unreadable) out.push([item.unreadable, s.alarm])
  if (item.drift === 'drifted') out.push(['drift', s.alarm])
  if (item.drift === 'unknown-version') out.push(['no version', s.caution])
  if (item.manifestState && item.manifestState !== 'ok') {
    out.push([`manifest ${item.manifestState}`, s.alarm])
  }
  if (item.enabled === false) out.push(['disabled', s.locked])
  const cls = item.writability.class
  out.push([CLASS_LABEL[cls] ?? cls, CLASS_CHIP[cls] ?? s.locked])
  return (
    <span className={s.rowTail}>
      {out.map(([text, tone], i) => (
        <span key={`${text}-${i}`} className={`${s.chip} ${tone}`}>{text}</span>
      ))}
    </span>
  )
}

function Rows({ items, openId, onOpen }) {
  return (
    <ul className={s.rows}>
      {items.map((item, i) => (
        <li key={item.id} className={`${s.row} ${openId === item.id ? s.active : ''}`}>
          <span className={s.index}>{String(i + 1).padStart(2, '0')}</span>
          <button className={s.rowName} onClick={() => onOpen(item)}>{item.label}</button>
          <span className={s.rowMeta}>{meta(item)}</span>
          <Chips item={item} />
        </li>
      ))}
    </ul>
  )
}

// Everything starts folded. The page opens as a table of contents; what you
// expand is remembered, so the layout you arrange is the one you come back to.
function Band({ band, stateKey, openId, onOpen }) {
  const [open, toggle] = useOpen(stateKey, false)
  const bodyId = `band-${stateKey.replace(/[^a-z0-9]+/gi, '-')}`
  return (
    <div className={s.band}>
      <button className={s.bandHead} onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
        <span className={s.caret} data-open={open ? 'yes' : undefined} aria-hidden="true">&#9656;</span>
        <span className={s.bandName}>{band.label}</span>
        <span className={s.bandCount}>{band.items.length}</span>
        {band.note && <span className={s.bandNote}>{band.note}</span>}
      </button>
      {open && <div id={bodyId}><Rows items={band.items} openId={openId} onOpen={onOpen} /></div>}
    </div>
  )
}

function Group({ scope, group, openId, onOpen, extras }) {
  const [open, toggle] = useOpen(`${scope}:${group.kind}`, false)
  const bands = bandsFor(group.items)
  const editable = group.items.filter((i) => EDITABLE.has(i.writability.class)).length
  const locked = group.items.length - editable
  const split = editable && locked
    ? `${editable} editable · ${locked} read-only`
    : (locked ? 'read-only' : 'editable')
  // A single band of your own files needs no banner over it.
  const plain = bands.length <= 1 && bands[0]?.key === 'yours'
  const bodyId = `group-${scope}-${group.kind}`

  return (
    <section className={s.group}>
      <h2 className={s.groupHead}>
        <button className={s.groupToggle} onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
          <span className={s.caret} data-open={open ? 'yes' : undefined} aria-hidden="true">&#9656;</span>
          <span className={s.groupName}>{GROUP_LABEL[group.kind] ?? group.kind}</span>
          <span className={s.groupCount}>{group.items.length}</span>
        </button>
        <span className={s.groupRule} />
        {group.items.length > 0 && <span className={s.groupSplit}>{split}</span>}
      </h2>
      {open && (
        <div id={bodyId}>
          {extras}
          {plain
            ? <Rows items={bands[0].items} openId={openId} onOpen={onOpen} />
            : bands.map((band) => (
              <Band
                key={band.key}
                band={band}
                stateKey={`${scope}:${group.kind}:${band.key}`}
                openId={openId}
                onOpen={onOpen}
              />
            ))}
        </div>
      )}
    </section>
  )
}

export function Notices({ inv }) {
  const notes = (inv.sources ?? [])
    .filter((r) => r.state !== 'ok')
    .map((r) => ({ tag: r.label, text: SOURCE_NOTE[r.state]?.(r.dir) ?? `${r.dir}: ${r.state}` }))

  if (inv.denied?.length) {
    notes.push({
      tag: 'unreadable',
      text: `${inv.denied.length} directories could not be read (permission denied)`,
      attn: true,
    })
  }
  if (inv.errors?.length) {
    notes.push({
      tag: 'errors',
      text: `${inv.errors.length} directories failed unexpectedly — some artifacts may be missing`,
      attn: true,
    })
  }
  if (notes.length === 0) return null

  return (
    <ul className={s.notices}>
      {notes.map((n) => (
        <li key={n.tag + n.text} className={`${s.notice} ${n.attn ? s.attn : ''}`}>
          <span className={s.noticeTag}>{n.tag}</span>
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  )
}

export default function Inventory({ inv, openId, onOpen, extras, scope = 'global' }) {
  const empty = inv.groups.every((g) => g.items.length === 0)
  return (
    <div>
      {inv.groups.filter((g) => g.items.length > 0 || extras?.[g.kind]).map((g) => (
        <Group
          key={g.kind}
          scope={scope}
          group={g}
          openId={openId}
          onOpen={onOpen}
          extras={extras?.[g.kind]}
        />
      ))}
      {empty && <p className={s.hint}>No Claude files here. Claude has run in this directory, but nothing is configured.</p>}
    </div>
  )
}
