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
    const b = createVersion(target, 'b', home)
    expect(a.version.id).not.toBe(b.version.id)
    expect(listVersions(target, home)).toHaveLength(2)
  })

  it('trims and caps a label, and treats blank as none', () => {
    expect(createVersion(target, '   ', home).version.label).toBeNull()
    expect(createVersion(target, '  spaced  ', home).version.label).toBe('spaced')
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
    const bad = createVersion(target, 'bad', home)
    const dir = path.join(storeRoot(home), fs.readdirSync(storeRoot(home)).find((d) => d !== 'index.json'))
    fs.writeFileSync(path.join(dir, `${bad.version.id}.json`), '{ corrupt')
    const listed = listVersions(target, home)
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(good.version.id)
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
    expect(deleteVersion(target, r.version.id, home)).toEqual({ ok: true })
    expect(listVersions(target, home)).toEqual([])
    expect(readVersion(target, r.version.id, home)).toBeNull()
  })

  it('removes the directory once the last version is gone', () => {
    const r = createVersion(target, null, home)
    const dirs = () => fs.readdirSync(storeRoot(home)).filter((d) => d !== 'index.json')
    expect(dirs()).toHaveLength(1)
    deleteVersion(target, r.version.id, home)
    expect(dirs()).toHaveLength(0)
  })

  it('reports an unknown version rather than silently succeeding', () => {
    expect(deleteVersion(target, 'nope', home)).toEqual({ ok: false, error: 'unknown-version' })
  })

  it('refuses an id containing path separators', () => {
    expect(deleteVersion(target, '../../x', home)).toEqual({ ok: false, error: 'bad-id' })
  })

  it('leaves sibling versions untouched', () => {
    createVersion(target, 'keep', home)
    const drop = createVersion(target, 'drop', home)
    deleteVersion(target, drop.version.id, home)
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
