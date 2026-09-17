import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  storeRoot, listVersions, createVersion, readVersion, deleteVersion, refreshIndex,
} from '../src/server/versions.js'

let home, target

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-vhome-'))
  target = path.join(home, 'NOTES.md')
  fs.writeFileSync(target, 'original\n')
})
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

// createVersion now declines to write a byte-identical twin, so any test that
// wants several versions has to change the file between them. A user does the
// same thing; back-to-back identical snapshots were only ever scaffolding.
let edits = 0
const edit = () => fs.writeFileSync(target, `original\nedit ${++edits}\n`)

describe('saving a version that already exists', () => {
  it('declines to write a byte-identical twin, and says which one holds it', () => {
    const first = createVersion(target, 'before rewrite', home)
    const again = createVersion(target, 'second thoughts', home)
    expect(again.ok).toBe(true)
    expect(again.duplicate).toBe(true)
    expect(again.version.id).toBe(first.version.id)
    expect(again.version.label).toBe('before rewrite')
  })

  it('leaves the store with one version, not two', () => {
    createVersion(target, 'a', home)
    createVersion(target, 'b', home)
    expect(listVersions(target, home)).toHaveLength(1)
  })

  it('saves normally once the content actually differs', () => {
    createVersion(target, 'a', home)
    fs.writeFileSync(target, 'changed\n')
    const r = createVersion(target, 'b', home)
    expect(r.duplicate).toBeUndefined()
    expect(listVersions(target, home)).toHaveLength(2)
  })

  it('compares against the newest version, not any older one', () => {
    // Save A, change to B, save B, change back to A. The newest version holds
    // B, so saving A again is a real save even though an older twin exists.
    createVersion(target, 'a', home)
    fs.writeFileSync(target, 'changed\n')
    createVersion(target, 'b', home)
    fs.writeFileSync(target, 'original\n')
    const r = createVersion(target, 'a again', home)
    expect(r.duplicate).toBeUndefined()
    expect(listVersions(target, home)).toHaveLength(3)
  })
})

describe('createVersion', () => {
  it('snapshots what is on disk and returns its metadata', () => {
    const r = createVersion(target, 'before rewrite', home)
    expect(r.ok).toBe(true)
    expect(r.version.label).toBe('before rewrite')
    expect(r.version.bytes).toBe(9)
    expect(r.version.path).toBe(target)
  })

  it('stores the snapshot 0600 inside a 0700 directory', () => {
    if (process.getuid && process.getuid() === 0) return
    const r = createVersion(target, null, home)
    const dir = path.join(storeRoot(home), fs.readdirSync(storeRoot(home)).find((d) => d !== 'index.json'))
    const snap = path.join(dir, `${r.version.id}.snap`)
    expect(fs.statSync(snap).mode & 0o777).toBe(0o600)
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    expect(fs.statSync(path.dirname(storeRoot(home))).mode & 0o777).toBe(0o700)
  })

  it('reports a missing source file rather than throwing', () => {
    expect(createVersion(path.join(home, 'gone.md'), null, home)).toEqual({ ok: false, error: 'missing' })
  })

  it('gives two snapshots taken in the same millisecond distinct ids', () => {
    const a = createVersion(target, 'a', home)
    edit()
    const b = createVersion(target, 'b', home)
    expect(a.version.id).not.toBe(b.version.id)
    expect(listVersions(target, home)).toHaveLength(2)
  })

  it('trims and caps a label, and treats blank as none', () => {
    expect(createVersion(target, '   ', home).version.label).toBeNull()
    edit()
    expect(createVersion(target, '  spaced  ', home).version.label).toBe('spaced')
    edit()
    expect(createVersion(target, 'x'.repeat(500), home).version.label).toHaveLength(200)
  })
})

describe('listVersions', () => {
  it('returns nothing for a file that has never been versioned', () => {
    expect(listVersions(target, home)).toEqual([])
  })

  it('returns newest first', async () => {
    const first = createVersion(target, 'first', home)
    await new Promise((r) => setTimeout(r, 5))
    edit()
    const second = createVersion(target, 'second', home)
    expect(listVersions(target, home).map((v) => v.id)).toEqual([second.version.id, first.version.id])
  })

  it('never lists content, only metadata', () => {
    createVersion(target, null, home)
    expect(Object.keys(listVersions(target, home)[0]).sort())
      .toEqual(['at', 'bytes', 'hash', 'id', 'label', 'path'])
  })

  it('a damaged sidecar hides one version, not the whole list', () => {
    const good = createVersion(target, 'good', home)
    edit()
    const bad = createVersion(target, 'bad', home)
    const dir = path.join(storeRoot(home), fs.readdirSync(storeRoot(home)).find((d) => d !== 'index.json'))
    fs.writeFileSync(path.join(dir, `${bad.version.id}.json`), '{ corrupt')
    const listed = listVersions(target, home)
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(good.version.id)
  })

  it('orders correctly even when snapshots land in the same millisecond', () => {
    // The ids used to end in a random suffix, so within one millisecond the
    // "newest first" sort was decided by chance. Twelve rapid saves makes that
    // collision near-certain, and also crosses the 9->10 boundary where a
    // naive counter would sort wrongly as a string.
    const made = []
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(target, `content ${i}\n`)
      made.push(createVersion(target, `v${i}`, home).version.id)
    }
    const listed = listVersions(target, home).map((v) => v.id)
    expect(listed).toEqual([...made].reverse())
  })

  it('keys on the absolute path, so two roots do not collide', () => {
    const other = path.join(home, 'other')
    fs.mkdirSync(other)
    const twin = path.join(other, 'NOTES.md')
    fs.writeFileSync(twin, 'different\n')
    createVersion(target, 'a', home)
    createVersion(twin, 'b', home)
    expect(listVersions(target, home)).toHaveLength(1)
    expect(listVersions(twin, home)).toHaveLength(1)
    expect(listVersions(target, home)[0].label).toBe('a')
  })
})

describe('readVersion', () => {
  it('returns the exact bytes that were snapshotted', () => {
    const r = createVersion(target, null, home)
    fs.writeFileSync(target, 'changed since\n')
    expect(readVersion(target, r.version.id, home)).toBe('original\n')
  })

  it('returns null for an unknown id', () => {
    expect(readVersion(target, 'nope', home)).toBeNull()
  })

  it('refuses an id containing path separators', () => {
    expect(readVersion(target, '../../etc/passwd', home)).toBeNull()
  })
})

describe('deleteVersion', () => {
  it('removes both the snapshot and its sidecar', () => {
    const r = createVersion(target, null, home)
    expect(deleteVersion(target, r.version.id, home, 'folder')).toMatchObject({ ok: true })
    expect(listVersions(target, home)).toEqual([])
    expect(readVersion(target, r.version.id, home)).toBeNull()
  })

  it('removes the directory once the last version is gone', () => {
    const r = createVersion(target, null, home)
    const dirs = () => fs.readdirSync(storeRoot(home)).filter((d) => d !== 'index.json')
    expect(dirs()).toHaveLength(1)
    deleteVersion(target, r.version.id, home, 'folder')
    expect(dirs()).toHaveLength(0)
  })

  it('reports an unknown version rather than silently succeeding', () => {
    expect(deleteVersion(target, 'nope', home, 'folder')).toEqual({ ok: false, error: 'unknown-version' })
  })

  it('refuses an id containing path separators', () => {
    expect(deleteVersion(target, '../../x', home, 'folder')).toEqual({ ok: false, error: 'bad-id' })
  })

  it('leaves sibling versions untouched', () => {
    createVersion(target, 'keep', home)
    edit()
    const drop = createVersion(target, 'drop', home)
    deleteVersion(target, drop.version.id, home, 'folder')
    expect(listVersions(target, home).map((v) => v.label)).toEqual(['keep'])
  })
})

describe('index.json', () => {
  it('maps path hashes back to real paths', () => {
    createVersion(target, 'one', home)
    const index = JSON.parse(fs.readFileSync(path.join(storeRoot(home), 'index.json'), 'utf8'))
    const entry = Object.values(index.files)[0]
    expect(entry.path).toBe(target)
    expect(entry.versions).toHaveLength(1)
  })

  it('is rebuilt from the sidecars when deleted', () => {
    createVersion(target, 'one', home)
    fs.rmSync(path.join(storeRoot(home), 'index.json'))
    const rebuilt = refreshIndex(home)
    expect(Object.values(rebuilt.files)[0].path).toBe(target)
  })

  it('is a view, not a dependency — listing works without it', () => {
    const r = createVersion(target, 'one', home)
    fs.rmSync(path.join(storeRoot(home), 'index.json'))
    expect(listVersions(target, home)[0].id).toBe(r.version.id)
  })
})

describe('deletion goes to the trash, not oblivion', () => {
  const trashFiles = () => path.join(home, '.local', 'share', 'Trash', 'files')
  const trashInfo = () => path.join(home, '.local', 'share', 'Trash', 'info')

  it('puts a recoverable copy in the trash', () => {
    fs.writeFileSync(target, 'the content I will want back\n')
    const r = createVersion(target, 'precious', home)
    deleteVersion(target, r.version.id, home, 'folder')

    const boxes = fs.readdirSync(trashFiles())
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toContain('NOTES.md')

    // The snapshot inside carries the ORIGINAL filename, not a hash.
    const recovered = fs.readFileSync(path.join(trashFiles(), boxes[0], 'NOTES.md'), 'utf8')
    expect(recovered).toBe('the content I will want back\n')
  })

  it('records where it came from, so it can be put back by hand', () => {
    const r = createVersion(target, 'labelled', home)
    deleteVersion(target, r.version.id, home, 'folder')
    const box = fs.readdirSync(trashFiles())[0]
    const meta = JSON.parse(fs.readFileSync(path.join(trashFiles(), box, 'metadata.json'), 'utf8'))
    expect(meta.restoreTo).toBe(target)
    expect(meta.label).toBe('labelled')
    expect(meta.deletedAt).toBeTruthy()
  })

  it('writes a trashinfo naming the original path', () => {
    const r = createVersion(target, null, home)
    deleteVersion(target, r.version.id, home, 'folder')
    const info = fs.readdirSync(trashInfo())[0]
    const body = fs.readFileSync(path.join(trashInfo(), info), 'utf8')
    expect(body).toContain('[Trash Info]')
    expect(body).toContain('Path=')
    expect(body).toContain('DeletionDate=')
  })

  it('keeps the version when there is no trash mechanism', () => {
    const r = createVersion(target, 'safe', home)
    const out = deleteVersion(target, r.version.id, home, 'none')
    expect(out.ok).toBe(false)
    expect(out.error).toBe('no-trash')
    expect(listVersions(target, home)).toHaveLength(1)
    expect(readVersion(target, r.version.id, home)).toBe('original\n')
  })

  it('leaves no staging directory behind', () => {
    const r = createVersion(target, null, home)
    deleteVersion(target, r.version.id, home, 'folder')
    const staging = path.join(home, '.claudesight', '.trashing')
    expect(fs.existsSync(staging) ? fs.readdirSync(staging) : []).toEqual([])
  })
})
