import { useCallback, useState } from 'react'
import s from './app.module.css'

// A reader can fail four distinguishable ways, and the whole point of this
// tool is that they never collapse into a bare zero.
export const SOURCE_NOTE = {
  absent: (dir) => `${dir} does not exist — nothing is configured there`,
  empty: (dir) => `${dir} exists but is empty`,
  denied: (dir) => `${dir} exists but could not be read (permission denied)`,
  malformed: (dir) => `${dir} could not be parsed`,
  // Read, but not completely. The count is the point: each unreadable entry is
  // something this page may be missing, and a silent "ok" would hide that.
  partial: (dir) => `${dir} was read, but some entries inside could not be`,
  // The file parsed; something inside it was not the shape the reader expects.
  // "Could not be parsed" would send you looking for a syntax error there is none of.
  'unexpected-shape': (dir) =>
    `${dir} parsed, but an entry inside it is not the expected shape and was skipped`,
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
  if (item.kind === 'hookScript' || item.kind === 'statusLineScript') {
    if (item.reason) return `${item.keyPath} — ${item.reason}`
    if (item.state === 'absent') return `${item.keyPath} — no file at this path`
    if (item.state === 'denied') return `${item.keyPath} — file cannot be read`
    return item.keyPath
  }
  // A broken config file is the case worth reading from across the room, and
  // its position is worth more than its key count.
  if (item.state === 'malformed') return item.line
    ? `invalid JSON at line ${item.line}, column ${item.column}`
    : 'invalid JSON — the parser did not say where'
  if (item.kind === 'settings') return `${item.keys} keys`
  if (item.kind === 'mcp') return `${item.servers} servers`
  // The band header already names the plugin, so the description is all that
  // is left worth showing on the row.
  if (item.kind === 'skill' || item.kind === 'agent' || item.kind === 'command') {
    return item.description ?? ''
  }
  if (item.kind === 'plugin') {
    // The versions were already on the wire; the row showed only the word
    // "drift", which names a problem without naming its size.
    const version = item.drift === 'drifted'
      ? `${item.recordedVersion ?? '—'} installed, manifest says ${item.manifestVersion ?? '—'}`
      : item.recordedVersion
    return [version, item.scope].filter(Boolean).join(' · ')
  }
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
        // Stated exactly once per band: through the note when the label is an
        // owner's name, through the label itself when there is no owner. It
        // used to be repeated on every row inside as well; setting it
        // unconditionally here brought back a different duplication, where an
        // unowned band read "read-only  3  read-only".
        note: owner ? 'read-only' : null,
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

const OPEN_KEY = 'claudesight.open'

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

// `showWritability` is false inside an owner band. Every item in one is
// read-only by construction — the band is defined by not being yours — and the
// group header above already prints "0 editable · 44 read-only". Repeating the
// same word on all 44 rows is ink with no bit of information attached, on
// exactly the rows a plugin-heavy machine has the most of. Alarm chips still
// render: those are facts about one row, not a restatement of the band.
function Chips({ item, showWritability = true }) {
  const out = []
  if (item.inline) out.push(['inline', s.locked])
  else if (item.broken) out.push(['broken', s.alarm])
  else if (item.state === 'malformed') out.push(['malformed', s.alarm])
  else if (item.state && item.state !== 'ok') out.push([item.state, s.caution])
  if (item.malformed) out.push(['malformed', s.alarm])
  if (item.unreadable) out.push([item.unreadable, s.alarm])
  if (item.drift === 'drifted') out.push(['drift', s.alarm])
  if (item.drift === 'unknown-version') out.push(['no version', s.caution])
  if (item.manifestState && item.manifestState !== 'ok') {
    out.push([`manifest ${item.manifestState}`, s.alarm])
  }
  if (item.enabled === false) out.push(['disabled', s.locked])
  // Loaded from a parent directory, not this project. Without this the row
  // reads as a file that lives here, and the directory you would actually
  // edit is the one piece of information the reader needs.
  if (item.fromAncestor) {
    const from = String(item.declaredIn ?? '').split('/').filter(Boolean).pop()
    out.push([from ? `inherited from ${from}` : 'inherited', s.caution])
  }
  // A definition closer to the project wins, and the ones it beat would
  // otherwise vanish from the page entirely.
  if (item.shadows?.length) out.push([`shadows ${item.shadows.length}`, s.caution])
  // What a hook script CAN do to a tool call, read off its own body. The
  // wording stays in the conditional — "can" — because a text scan cannot know
  // what the script did, only what it is able to do.
  for (const c of item.capabilities ?? []) out.push([c.label, s.caution])
  if (showWritability && item.ownScript !== false) {
    const cls = item.writability.class
    out.push([CLASS_LABEL[cls] ?? cls, CLASS_CHIP[cls] ?? s.locked])
  }
  return (
    <span className={s.rowTail}>
      {out.map(([text, tone], i) => (
        <span key={`${text}-${i}`} className={`${s.chip} ${tone}`}>{text}</span>
      ))}
    </span>
  )
}

function Rows({ items, openId, onOpen, showWritability = true }) {
  return (
    <ul className={s.rows}>
      {items.map((item, i) => (
        <li key={item.id} className={`${s.row} ${openId === item.id ? s.active : ''}`}>
          <span className={s.index}>{String(i + 1).padStart(2, '0')}</span>
          <button className={s.rowName} onClick={() => onOpen(item)}>{item.label}</button>
          <span className={s.rowMeta}>{meta(item)}</span>
          <Chips item={item} showWritability={showWritability} />
        </li>
      ))}
    </ul>
  )
}

// Everything starts folded. The page opens as a table of contents; what you
// expand is remembered, so the layout you arrange is the one you come back to.
function Band({ band, stateKey, openId, onOpen, showNote = true }) {
  const mine = band.key === 'yours'
  const [open, toggle] = useOpen(stateKey, false)
  const bodyId = `band-${stateKey.replace(/[^a-z0-9]+/gi, '-')}`
  return (
    <div className={s.band}>
      <button className={s.bandHead} onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
        <span className={s.caret} data-open={open ? 'yes' : undefined} aria-hidden="true">&#9656;</span>
        <span className={s.bandName}>{band.label}</span>
        <span className={s.bandCount}>{band.items.length}</span>
        {showNote && band.note && <span className={s.bandNote}>{band.note}</span>}
      </button>
      {open && (
        <div id={bodyId}>
          <Rows items={band.items} openId={openId} onOpen={onOpen} showWritability={mine} />
        </div>
      )}
    </div>
  )
}

// What reading a hook cannot tell you. This renders whether or not anything is
// wrong, because the danger of a diagnostic is a clean list being read as a
// clean bill of health: the worst hook failures — a wrong output shape, a
// crash, a swallowed error that fails open — happen only when it runs, and
// nothing here executes anything.
const NOT_CHECKED = 'Not checked: exit code, output shape, whether the script actually runs. Nothing here is executed.'

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
  // When nothing in the group is editable the header already says "read-only"
  // for all of it, so each band repeating it added nothing — nine plugin bands
  // under one skills group stated the same fact ten times. A mixed group is
  // the opposite: the header says "1 editable · 2 read-only" and which band is
  // which becomes a real question, so there the notes stay.
  const headerSaysItAll = editable === 0 && locked > 0
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
          {group.kind === 'scripts' && <p className={s.hint}>{NOT_CHECKED}</p>}
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
                showNote={!headerSaysItAll}
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

  // The server already knows WHICH directories it could not read. Reducing
  // that to a count left the one question you actually have unanswered: which
  // path do I need unlocked? That matters most on a managed machine, where
  // the answer is something you have to ask an administrator for.
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
  if (inv.denied?.length) {
    notes.push({
      tag: 'unreadable',
      text: `${plural(inv.denied.length, 'directory', 'directories')} could not be read — anything inside is missing from this page`,
      paths: inv.denied,
      attn: true,
    })
  }
  if (inv.errors?.length) {
    notes.push({
      tag: 'errors',
      text: `${plural(inv.errors.length, 'directory', 'directories')} failed unexpectedly — some artifacts may be missing`,
      paths: inv.errors.map((e) => (e.errno ? `${e.path}  (${e.errno})` : String(e.path ?? e))),
      attn: true,
    })
  }
  if (notes.length === 0) return null

  return (
    <ul className={s.notices}>
      {notes.map((n) => <Notice key={n.tag + n.text} note={n} />)}
    </ul>
  )
}

// A short list of paths is worth more than the count that replaced it, so show
// it outright. A long one folds, because a wall of paths buries the notice it
// belongs to — but the count in the summary still tells you how many there are.
const PATHS_SHOWN_BY_DEFAULT = 3

function Notice({ note }) {
  const paths = note.paths ?? []
  const [show, setShow] = useState(paths.length > 0 && paths.length <= PATHS_SHOWN_BY_DEFAULT)

  return (
    <li className={`${s.notice} ${note.attn ? s.attn : ''}`}>
      <span className={s.noticeTag}>{note.tag}</span>
      <div className={s.noticeBody}>
        <span>
          {note.text}
          {paths.length > PATHS_SHOWN_BY_DEFAULT && (
            <button className={s.linkQuiet} onClick={() => setShow(!show)} aria-expanded={show}>
              {show ? 'hide paths' : `show ${paths.length} paths`}
            </button>
          )}
        </span>
        {show && (
          <ul className={s.noticePaths}>
            {paths.map((p) => <li key={p} title={p}>{p}</li>)}
          </ul>
        )}
      </div>
    </li>
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
