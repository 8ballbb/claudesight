import React from 'react'
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

function meta(item) {
  if (item.kind === 'memory') return `${item.bytes} bytes`
  if (item.kind === 'settings') return `${item.keys} keys`
  if (item.kind === 'mcp') return `${item.servers} servers`
  if (item.kind === 'hookScript' || item.kind === 'statusLineScript') return item.keyPath
  if (item.kind === 'skill') return [item.plugin, item.description].filter(Boolean).join(' · ')
  if (item.kind === 'plugin') return [item.recordedVersion, item.scope].filter(Boolean).join(' · ')
  if (item.kind === 'other') {
    return item.entryType === 'directory'
      ? 'directory — no reader for this yet'
      : `${item.bytes ?? '?'} bytes — no reader for this yet`
  }
  return item.path
}

function Chips({ item }) {
  const out = []
  if (item.state && item.state !== 'ok') out.push([item.state, s.caution])
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

export default function Inventory({ inv, openId, onOpen, extras }) {
  const empty = inv.groups.every((g) => g.items.length === 0)
  return (
    <div>
      {inv.groups.filter((g) => g.items.length > 0 || extras?.[g.kind]).map((g) => (
        <section key={g.kind} className={s.group}>
          <div className={s.groupHead}>
            <h2 className={s.groupName}>{g.kind}</h2>
            <span className={s.groupCount}>{g.items.length}</span>
            <span className={s.groupRule} />
            {extras?.[g.kind]}
          </div>
          <ul className={s.rows}>
            {g.items.map((item, i) => (
              <li key={item.id} className={`${s.row} ${openId === item.id ? s.active : ''}`}>
                <span className={s.index}>{String(i + 1).padStart(2, '0')}</span>
                <button className={s.rowName} onClick={() => onOpen(item)}>{item.label}</button>
                <span className={s.rowMeta}>{meta(item)}</span>
                <Chips item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {empty && <p className={s.hint}>No Claude files here. Claude has run in this directory, but nothing is configured.</p>}
    </div>
  )
}
