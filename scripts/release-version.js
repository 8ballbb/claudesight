#!/usr/bin/env node
// Decides whether a push to main becomes a release, and which version it gets.
//
// The logic lives here rather than inside the workflow YAML so it can be
// tested. A release script that has never been run against a fixture is a
// script that runs for the first time on the day it matters.
//
// The pure functions take plain data; only `plan()` touches git.

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

// Files whose contents reach a user who installs the package. `dist/` is not
// listed because it is generated — but the lockfile IS, because the UI bundle
// has React compiled into it, so a dependency bump changes what ships even
// when no source file moved.
const SHIPPING = [
  (f) => f.startsWith('bin/'),
  (f) => f.startsWith('src/'),
  (f) => f === 'vite.config.js',
]

// devDependencies that cannot reach the published tarball. Note what is NOT
// here: vite and its react plugin are devDependencies that BUILD dist/, so
// bumping them genuinely changes what users receive. Anything unrecognised is
// treated as shipping — failing toward publishing a no-op version is cheaper
// than failing toward withholding a real fix.
const NEVER_IN_THE_TARBALL = [
  /^eslint$/, /^@eslint\//, /^eslint-plugin-/, /^eslint-config-/, /^globals$/,
  /^vitest$/, /^@vitest\//, /^jsdom$/, /^happy-dom$/, /^@testing-library\//,
]

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Does a package.json change alter what gets published? `version` is excluded
 * because the release itself writes it, and devDependencies are judged by name.
 */
export function manifestShips(before, after) {
  if (!before || !after) return true // cannot compare — assume it ships

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'devDependencies' || key === 'version') continue
    if (!same(before[key], after[key])) return true
  }

  const dev = (o) => o.devDependencies ?? {}
  for (const name of new Set([...Object.keys(dev(before)), ...Object.keys(dev(after))])) {
    if (dev(before)[name] === dev(after)[name]) continue
    if (!NEVER_IN_THE_TARBALL.some((re) => re.test(name))) return true
  }
  return false
}

export function shipsChanged(files, manifest = {}) {
  const others = files.filter((f) => f !== 'package.json' && f !== 'package-lock.json')
  if (others.some((f) => SHIPPING.some((match) => match(f)))) return true

  // package.json is the authority when it moved: it says which dependency
  // changed, which the lockfile alone does not.
  if (files.includes('package.json')) return manifestShips(manifest.before, manifest.after)

  // Lockfile alone means a transitive bump. Working out whether it reaches the
  // bundle would mean walking the dependency tree; assume it does.
  if (files.includes('package-lock.json')) return true

  return false
}

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:/

// A commit that announces a break either marks its subject with `!` or says so
// in a footer. Both spellings of the footer are accepted in the wild.
export function isBreaking({ subject = '', body = '' }) {
  return CONVENTIONAL.exec(subject)?.groups.breaking === '!' ||
    /^BREAKING[ -]CHANGE:/m.test(body)
}

export function typeOf({ subject = '' }) {
  return CONVENTIONAL.exec(subject)?.groups.type ?? null
}

// Commits that do not follow the convention fall through to `patch` rather
// than to "no release". Failing toward shipping a fix is recoverable; failing
// toward silence means a fix sits unreleased and nobody is told why.
export function bumpFrom(commits) {
  if (commits.some(isBreaking)) return 'major'
  if (commits.some((c) => typeOf(c) === 'feat')) return 'minor'
  return 'patch'
}

// Below 1.0.0 a breaking change is a minor bump, not a major one: reaching
// 1.0.0 is a deliberate statement about stability, and it should never happen
// as a side effect of a commit message.
export function nextVersion(current, bump) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!m) throw new Error(`package.json version is not a plain semver triple: ${current}`)
  const [major, minor, patch] = m.slice(1).map(Number)

  if (major === 0) {
    return bump === 'patch' ? `0.${minor}.${patch + 1}` : `0.${minor + 1}.0`
  }
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const HEADINGS = [
  ['feat', 'Added'],
  ['fix', 'Fixed'],
  ['perf', 'Performance'],
  ['refactor', 'Changed'],
  ['docs', 'Documentation'],
]

export function releaseNotes(commits) {
  const used = new Set()
  const sections = []

  for (const [type, heading] of HEADINGS) {
    const lines = commits
      .filter((c) => typeOf(c) === type)
      .map((c) => {
        used.add(c.subject)
        return `- ${c.subject.replace(CONVENTIONAL, '').trim()}`
      })
    if (lines.length) sections.push(`### ${heading}\n\n${lines.join('\n')}`)
  }

  const rest = commits.filter((c) => !used.has(c.subject) && !['ci', 'test', 'style', 'chore', 'build'].includes(typeOf(c)))
  if (rest.length) {
    sections.push(`### Other\n\n${rest.map((c) => `- ${c.subject}`).join('\n')}`)
  }
  return sections.join('\n\n') || '_No user-facing changes recorded._'
}

// stderr is captured, not inherited: `git describe` with no tags is an
// expected state here, not something to print at the reader.
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// Commit subjects can contain anything, so records are split on bytes that
// cannot appear in a commit message rather than on newlines.
export function readCommits(range) {
  const raw = git('log', '--no-merges', '--format=%s%x1f%b%x1e', range)
  return raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((record) => {
    const [subject, body = ''] = record.split('\x1f')
    return { subject: subject.trim(), body: body.trim() }
  })
}

export function plan({ current, lastTag, commits, files, forced, tags = [], manifest = {} }) {
  if (!lastTag) {
    // Nothing has ever been released. Ship what package.json already declares
    // instead of inventing a number — 0.1.0 is the version the docs quote.
    return { release: true, version: current, bump: 'initial', commits }
  }
  if (!commits.length) return { release: false, reason: `no commits since ${lastTag}` }
  // The ships-changed gate exists to stop a docs push publishing by accident.
  // A forced bump is not an accident — it is someone opening the Actions tab
  // and choosing a size, which is how you re-publish after a failed publish or
  // cut a version deliberately. Let it through.
  if (!forced && !shipsChanged(files, manifest)) {
    return { release: false, reason: 'no change to anything the package ships' }
  }
  const bump = forced || bumpFrom(commits)
  const version = nextVersion(current, bump)

  // A push can produce more than one workflow run, and main runs queue rather
  // than cancel, so a second run can arrive after the first has already
  // published and pushed the tag. It checks out the same commit, so the new
  // tag is not an ancestor and `git describe` cannot see it — it recomputes
  // the same version and dies at `git tag` with "already exists". Releasing
  // has to be idempotent: if the tag is here, the work is done.
  if (tags.includes(`v${version}`)) {
    return { release: false, reason: `v${version} is already tagged — another run released it` }
  }

  return { release: true, version, bump, commits }
}

function main() {
  const current = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
  // No initialiser: both branches assign, and a dead store here is exactly
  // what ESLint 10 started flagging.
  let lastTag
  try {
    lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*')
  } catch {
    lastTag = null // no release has happened yet
  }

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  const commits = lastTag ? readCommits(range) : []
  const files = lastTag
    ? git('diff', '--name-only', `${lastTag}..HEAD`).split('\n').filter(Boolean)
    : []

  // fetch-depth: 0 means every tag is present, including one a concurrent
  // run pushed moments ago.
  let tags
  try { tags = git('tag', '--list', 'v[0-9]*').split('\n').filter(Boolean) } catch { tags = [] }

  // The manifest as it was at the last release, to compare against now.
  let manifest = {}
  if (lastTag) {
    try {
      manifest = {
        before: JSON.parse(git('show', `${lastTag}:package.json`)),
        after: JSON.parse(fs.readFileSync('package.json', 'utf8')),
      }
    } catch { manifest = {} } // unreadable either side — shipsChanged assumes it ships
  }

  const forced = process.env.FORCE_BUMP || null
  const result = plan({ current, lastTag, commits, files, forced, tags, manifest })

  if (!result.release) {
    process.stdout.write(`release=no\nreason=${result.reason}\n`)
    return
  }

  // Notes are written to a file, never emitted as a step output. They are
  // built from commit messages, and a commit message interpolated into a
  // workflow `run:` block is an arbitrary-command vector.
  const notes = result.bump === 'initial'
    ? 'First published release.'
    : releaseNotes(result.commits)
  fs.writeFileSync('release-notes.md', `${notes}\n`)

  process.stdout.write(`release=yes\nversion=${result.version}\nbump=${result.bump}\n`)
}

// Run only when invoked directly, never when a test imports the pure helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
