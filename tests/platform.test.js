import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { trashMechanism, moveToTrash } from '../src/server/trash.js'
import { createVersion, deleteVersion, listVersions } from '../src/server/versions.js'

const runWithPlatform = (platform) => {
  try {
    execFileSync(process.execPath, ['-e',
      `Object.defineProperty(process,'platform',{value:'${platform}'});import('./bin/claudescope.js')`,
    ], { encoding: 'utf8', stdio: 'pipe', timeout: 10000 })
    return ''
  } catch (err) {
    return `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
}

describe('macOS only, and says so', () => {
  it('refuses to start on another platform rather than half-working', () => {
    const out = runWithPlatform('linux')
    expect(out).toContain('macOS only')
    expect(out).toContain('linux')
  })

  it('points somewhere, rather than just saying no', () => {
    expect(runWithPlatform('win32')).toContain('github.com/8ballbb/claudescope/issues')
  })
})

describe('trash is macOS only', () => {
  it('claims a mechanism only on darwin', () => {
    expect(trashMechanism('linux')).toBeNull()
    expect(trashMechanism('win32')).toBeNull()
    expect(trashMechanism('freebsd')).toBeNull()
  })

  it('no longer pretends to implement XDG on Linux', () => {
    // It returned 'xdg' here, for a code path that had never run outside the
    // test suite. An untested branch presented as platform support is exactly
    // the kind of claim this project refuses to make.
    expect(trashMechanism('linux')).not.toBe('xdg')
  })

  it('refuses an unknown mechanism instead of falling through to a real delete', () => {
    const r = moveToTrash('/tmp/whatever', '/tmp', 'xdg')
    expect(r).toMatchObject({ ok: false, error: 'no-trash' })
  })

  it('still refuses when asked for nothing at all', () => {
    expect(moveToTrash('/tmp/whatever', '/tmp', 'none')).toMatchObject({ ok: false, error: 'no-trash' })
  })
})

// The gap that let a broken deletion ship: every existing test forces the
// 'folder' mechanism so the suite never touches the real Trash. The only path
// that runs in production was therefore the only one never exercised — it
// reported failure on every delete while having actually trashed the file.
describe('the macOS mechanism, exercised for real', () => {
  const available = trashMechanism() === 'macos-cli'

  it('reports success when it succeeded', () => {
    if (!available) return
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-trash-'))
    const victim = path.join(dir, 'claudescope-test-victim.txt')
    fs.writeFileSync(victim, 'delete me')

    const r = moveToTrash(victim)
    expect(r).toMatchObject({ ok: true, mechanism: 'macos-cli' })
    expect(fs.existsSync(victim)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a relative path rather than letting a leading dash become a flag', () => {
    expect(moveToTrash('relative/file.txt')).toMatchObject({ ok: false, error: 'not-absolute' })
    expect(moveToTrash('-rf')).toMatchObject({ ok: false, error: 'not-absolute' })
  })

  it('deleteVersion reports the truth end to end on the real mechanism', () => {
    if (!available) return
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-dv-'))
    const target = path.join(home, 'NOTES.md')
    fs.writeFileSync(target, 'v1\n')
    const made = createVersion(target, 'before', home)
    const r = deleteVersion(target, made.version.id, home)
    expect(r.ok).toBe(true)
    // The version is really gone from the store, not merely reported gone.
    expect(listVersions(target, home)).toHaveLength(0)
    fs.rmSync(home, { recursive: true, force: true })
  })
})
