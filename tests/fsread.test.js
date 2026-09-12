import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readDirSafe, readJsonSafe, walkForSafe } from '../src/server/fsread.js'

let tmp
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-fsread-'))
  fs.mkdirSync(path.join(tmp, 'emptydir'))
  fs.mkdirSync(path.join(tmp, 'full'))
  fs.writeFileSync(path.join(tmp, 'full', 'a.txt'), 'hello')
  fs.writeFileSync(path.join(tmp, 'good.json'), '{"a":1}')
  fs.writeFileSync(path.join(tmp, 'bad.json'), '{\n  "a": 1,\n  oops\n}')
  fs.mkdirSync(path.join(tmp, 'locked'))
  fs.writeFileSync(path.join(tmp, 'locked', 'secret.txt'), 'x')
  fs.chmodSync(path.join(tmp, 'locked'), 0o000)
  fs.mkdirSync(path.join(tmp, 'deep', 'a', 'b'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'deep', 'a', 'b', 'TARGET.md'), 'found me')
})
afterAll(() => {
  fs.chmodSync(path.join(tmp, 'locked'), 0o755)
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('readDirSafe', () => {
  it('returns absent for a directory that does not exist', () => {
    expect(readDirSafe(path.join(tmp, 'nope')).state).toBe('absent')
  })
  it('returns empty for a directory with no entries', () => {
    expect(readDirSafe(path.join(tmp, 'emptydir')).state).toBe('empty')
  })
  it('returns ok with entries for a populated directory', () => {
    const r = readDirSafe(path.join(tmp, 'full'))
    expect(r.state).toBe('ok')
    expect(r.value.map((e) => e.name)).toEqual(['a.txt'])
  })
  it('returns denied — never empty — for an unreadable directory', () => {
    const r = readDirSafe(path.join(tmp, 'locked'))
    if (process.getuid && process.getuid() === 0) return // root bypasses perms
    expect(r.state).toBe('denied')
    expect(['EACCES', 'EPERM']).toContain(r.errno)
  })
})

describe('readJsonSafe', () => {
  it('parses valid JSON', () => {
    expect(readJsonSafe(path.join(tmp, 'good.json')).value).toEqual({ a: 1 })
  })
  it('returns malformed with a line number, not a throw', () => {
    const r = readJsonSafe(path.join(tmp, 'bad.json'))
    expect(r.state).toBe('malformed')
    expect(r.line).toBeGreaterThan(0)
  })
  it('returns absent for a missing file', () => {
    expect(readJsonSafe(path.join(tmp, 'gone.json')).state).toBe('absent')
  })
})

describe('walkForSafe', () => {
  it('finds nested targets within maxDepth', () => {
    const r = walkForSafe(path.join(tmp, 'deep'), 'TARGET.md', 5)
    expect(r.found).toHaveLength(1)
    expect(r.found[0]).toMatch(/TARGET\.md$/)
  })
  it('records denied directories instead of silently skipping them', () => {
    const r = walkForSafe(tmp, 'secret.txt', 5)
    if (process.getuid && process.getuid() === 0) return
    expect(r.denied.length).toBeGreaterThan(0)
    expect(r.denied.some((d) => d.includes('locked'))).toBe(true)
  })
  it('respects maxDepth', () => {
    expect(walkForSafe(path.join(tmp, 'deep'), 'TARGET.md', 1).found).toHaveLength(0)
  })
  it('finds a target reachable only through a symlink pointing outside the walked tree', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-symtarget-'))
    try {
      fs.mkdirSync(path.join(outside, 'nested'), { recursive: true })
      fs.writeFileSync(path.join(outside, 'nested', 'TARGET.md'), 'via symlink')
      const walked = path.join(tmp, 'symroot')
      fs.mkdirSync(walked, { recursive: true })
      fs.symlinkSync(outside, path.join(walked, 'skills'))

      const r = walkForSafe(walked, 'TARGET.md', 5)
      expect(r.found).toHaveLength(1)
      expect(r.denied).toEqual([])
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
  it('terminates on a symlink cycle', () => {
    const cyc = path.join(tmp, 'cyc')
    fs.mkdirSync(cyc, { recursive: true })
    fs.symlinkSync(cyc, path.join(cyc, 'self'))
    expect(() => walkForSafe(cyc, 'TARGET.md', 20)).not.toThrow()
  })
  it('does not throw or lose siblings on a broken symlink', () => {
    const brk = path.join(tmp, 'broken')
    fs.mkdirSync(brk, { recursive: true })
    fs.symlinkSync(path.join(tmp, 'does-not-exist'), path.join(brk, 'dangling'))
    fs.writeFileSync(path.join(brk, 'TARGET.md'), 'sibling survives')
    const r = walkForSafe(brk, 'TARGET.md', 5)
    expect(r.found).toHaveLength(1)
    expect(r.errors).toEqual([])
  })
})
