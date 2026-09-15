import { describe, it, expect } from 'vitest'
import {
  bumpFrom, isBreaking, nextVersion, plan, releaseNotes, shipsChanged, typeOf,
} from '../scripts/release-version.js'

const c = (subject, body = '') => ({ subject, body })

describe('reading what a commit claims to be', () => {
  it('reads the type off a conventional subject, with or without a scope', () => {
    expect(typeOf(c('feat: add a thing'))).toBe('feat')
    expect(typeOf(c('fix(server): stop the thing'))).toBe('fix')
  })

  it('returns null rather than guessing at a free-form subject', () => {
    // Four commits early in this repo's own history look like this.
    expect(typeOf(c('Revise spec to r3 after four adversarial reviews'))).toBeNull()
  })

  it('finds a break announced either way', () => {
    expect(isBreaking(c('feat!: drop the old flag'))).toBe(true)
    expect(isBreaking(c('fix(api)!: rename the field'))).toBe(true)
    expect(isBreaking(c('feat: x', 'BREAKING CHANGE: the port moved'))).toBe(true)
    expect(isBreaking(c('feat: x', 'BREAKING-CHANGE: the port moved'))).toBe(true)
  })

  it('does not mistake a mention of breakage for a declaration of it', () => {
    expect(isBreaking(c('fix: stop the parser breaking on empty files'))).toBe(false)
    expect(isBreaking(c('fix: x', 'This could have been a BREAKING CHANGE: but was not'))).toBe(false)
  })
})

describe('choosing the size of the bump', () => {
  it('takes the largest claim in the batch, not the last one', () => {
    expect(bumpFrom([c('fix: a'), c('feat!: b'), c('docs: c')])).toBe('major')
    expect(bumpFrom([c('fix: a'), c('feat: b')])).toBe('minor')
    expect(bumpFrom([c('fix: a'), c('docs: b')])).toBe('patch')
  })

  it('falls through to patch when nobody followed the convention', () => {
    // Failing toward shipping beats failing toward silence: an unconventional
    // subject should not strand a real fix.
    expect(bumpFrom([c('Merge phase-1-loaded-now')])).toBe('patch')
  })
})

describe('applying the bump', () => {
  it('moves the ordinary numbers', () => {
    expect(nextVersion('1.4.2', 'patch')).toBe('1.4.3')
    expect(nextVersion('1.4.2', 'minor')).toBe('1.5.0')
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0')
  })

  it('never reaches 1.0.0 by accident', () => {
    // Below 1.0.0, declaring stability is a decision, not a side effect of a
    // commit message. A break becomes a minor bump instead.
    expect(nextVersion('0.1.0', 'major')).toBe('0.2.0')
    expect(nextVersion('0.1.0', 'minor')).toBe('0.2.0')
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1')
  })

  it('refuses a version it cannot reason about', () => {
    expect(() => nextVersion('1.0.0-beta.1', 'patch')).toThrow(/plain semver/)
  })
})

describe('deciding whether anything shipped', () => {
  it('counts the code and the binary', () => {
    expect(shipsChanged(['src/server/api.js'])).toBe(true)
    expect(shipsChanged(['bin/claudescope.js'])).toBe(true)
  })

  it('counts a lockfile change, because React is compiled into the bundle', () => {
    expect(shipsChanged(['package-lock.json'])).toBe(true)
    expect(shipsChanged(['vite.config.js'])).toBe(true)
  })

  it('does not count docs, tests, or CI', () => {
    expect(shipsChanged(['README.md', 'docs/img/one.png'])).toBe(false)
    expect(shipsChanged(['tests/linediff.test.js'])).toBe(false)
    expect(shipsChanged(['.github/workflows/ci.yml'])).toBe(false)
    expect(shipsChanged(['scripts/release-version.js'])).toBe(false)
  })
})

describe('the release decision', () => {
  const base = { current: '0.1.0', lastTag: 'v0.1.0', files: ['src/a.js'] }

  it('publishes what package.json declares when nothing was ever released', () => {
    const r = plan({ ...base, lastTag: null, commits: [] })
    expect(r).toMatchObject({ release: true, version: '0.1.0', bump: 'initial' })
  })

  it('stays quiet when only docs moved', () => {
    const r = plan({ ...base, commits: [c('docs: fix a typo')], files: ['README.md'] })
    expect(r.release).toBe(false)
    expect(r.reason).toMatch(/no change to anything the package ships/)
  })

  it('stays quiet when there are no commits at all', () => {
    expect(plan({ ...base, commits: [] }).release).toBe(false)
  })

  it('releases a patch for a fix to shipped code', () => {
    const r = plan({ ...base, commits: [c('fix: stop the crash')] })
    expect(r).toMatchObject({ release: true, version: '0.1.1', bump: 'patch' })
  })

  it('honours a forced bump over the derived one', () => {
    const r = plan({ ...base, commits: [c('fix: small')], forced: 'minor' })
    expect(r.version).toBe('0.2.0')
  })
})

describe('the notes that reach the release page', () => {
  it('groups by kind and strips the prefix', () => {
    const notes = releaseNotes([c('feat: add search'), c('fix(ui): stop flicker')])
    expect(notes).toContain('### Added\n\n- add search')
    expect(notes).toContain('### Fixed\n\n- stop flicker')
  })

  it('leaves out the housekeeping nobody installs', () => {
    const notes = releaseNotes([c('feat: add search'), c('ci: bump actions'), c('test: cover it')])
    expect(notes).not.toMatch(/bump actions|cover it/)
  })

  it('still lists a commit that followed no convention', () => {
    expect(releaseNotes([c('Rename the thing')])).toContain('- Rename the thing')
  })

  it('says so plainly when there is nothing worth listing', () => {
    expect(releaseNotes([c('ci: bump actions')])).toMatch(/No user-facing changes/)
  })
})
