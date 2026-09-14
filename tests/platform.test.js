import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { trashMechanism, moveToTrash } from '../src/server/trash.js'

const runWithPlatform = (platform) => {
  try {
    execFileSync(process.execPath, ['-e',
      `Object.defineProperty(process,'platform',{value:'${platform}'});import('./bin/claude-atlas.js')`,
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
    expect(runWithPlatform('win32')).toContain('github.com/8ballbb/claude-atlas/issues')
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
