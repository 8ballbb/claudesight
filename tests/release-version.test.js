import { describe, it, expect } from 'vitest'
import {
  bumpFrom, isBreaking, manifestShips, nextVersion, plan, releaseNotes, shipsChanged, typeOf,
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
    expect(shipsChanged(['bin/claudesight.js'])).toBe(true)
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

describe('judging a package.json change by what it actually alters', () => {
  const base = {
    name: 'claudesight', version: '0.2.0',
    dependencies: { react: '^19.3.0' },
    devDependencies: { eslint: '^10.10.0', vite: '^8.3.0', vitest: '^5.0.0' },
  }
  const with_ = (patch) => ({ ...base, ...patch })

  it('ships when a runtime dependency moves', () => {
    expect(manifestShips(base, with_({ dependencies: { react: '^19.4.0' } }))).toBe(true)
  })

  it('does NOT ship when only the linter moves', () => {
    // This is the whole point: Dependabot bumping eslint must not publish a
    // version to people who will receive exactly what they already have.
    expect(manifestShips(base, with_({
      devDependencies: { ...base.devDependencies, eslint: '^10.11.0' },
    }))).toBe(false)
  })

  it('DOES ship when vite moves, because vite builds the bundle', () => {
    // vite is a devDependency, but the bundle users download is its output.
    expect(manifestShips(base, with_({
      devDependencies: { ...base.devDependencies, vite: '^8.4.0' },
    }))).toBe(true)
  })

  it('ships for an unrecognised devDependency, rather than guessing', () => {
    expect(manifestShips(base, with_({
      devDependencies: { ...base.devDependencies, 'some-new-tool': '^1.0.0' },
    }))).toBe(true)
  })

  it('ships when bin, files or engines change', () => {
    expect(manifestShips(base, with_({ bin: { claudesight: 'bin/x.js' } }))).toBe(true)
    expect(manifestShips(base, with_({ engines: { node: '>=22' } }))).toBe(true)
  })

  it('ignores the version field, which the release writes itself', () => {
    expect(manifestShips(base, with_({ version: '0.3.0' }))).toBe(false)
  })

  it('assumes it ships when it cannot compare', () => {
    expect(manifestShips(null, base)).toBe(true)
  })
})

describe('what counts as a shipping change', () => {
  const manifest = {
    before: { devDependencies: { eslint: '^10.10.0' } },
    after: { devDependencies: { eslint: '^10.11.0' } },
  }

  it('lets a linter-only bump through without releasing', () => {
    expect(shipsChanged(['package.json', 'package-lock.json'], manifest)).toBe(false)
  })

  it('still releases when source changed in the same push', () => {
    expect(shipsChanged(['package.json', 'package-lock.json', 'src/a.js'], manifest)).toBe(true)
  })

  it('releases on a lockfile-only change, which package.json cannot explain', () => {
    // A transitive bump. Reading the tree to find out whether it reaches the
    // bundle is not worth it; assume it does.
    expect(shipsChanged(['package-lock.json'], {})).toBe(true)
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

  it('lets a forced bump through the ships-changed gate', () => {
    // Choosing a bump by hand in the Actions tab is deliberate; the gate is
    // there to catch accidents, and this is not one.
    const r = plan({ ...base, commits: [c('docs: only prose')], files: ['README.md'], forced: 'patch' })
    expect(r).toMatchObject({ release: true, version: '0.1.1', bump: 'patch' })
  })

  it('still refuses a forced bump when there are no commits at all', () => {
    expect(plan({ ...base, commits: [], forced: 'major' }).release).toBe(false)
  })

  it('does nothing when the version it computed is already tagged', () => {
    // Two runs for one push: the second recomputes the same version because
    // the new tag is not an ancestor of the commit it checked out. Without
    // this it dies at `git tag` with "already exists".
    const r = plan({ ...base, commits: [c('feat: a thing')], tags: ['v0.1.0', 'v0.2.0'] })
    expect(r.release).toBe(false)
    expect(r.reason).toMatch(/already tagged/)
  })

  it('still releases when the tag list holds only older versions', () => {
    const r = plan({ ...base, commits: [c('feat: a thing')], tags: ['v0.1.0'] })
    expect(r).toMatchObject({ release: true, version: '0.2.0' })
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
