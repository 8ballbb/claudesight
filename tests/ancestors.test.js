// The boundaries here are taken from documented Claude Code behaviour, not
// from preference, because the app's only job is to say what is actually
// loaded. Artifact directories stop at the repository root; CLAUDE.md does not.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { repoRootOf, artifactDirs, memoryDirs } from '../src/server/ancestors.js'

let tmp
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-anc-'))) })
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const mk = (...parts) => {
  const p = path.join(tmp, ...parts)
  fs.mkdirSync(p, { recursive: true })
  return p
}

describe('repoRootOf', () => {
  it('finds the nearest directory holding .git', () => {
    const repo = mk('repo')
    fs.mkdirSync(path.join(repo, '.git'))
    const deep = mk('repo', 'packages', 'frontend')
    expect(repoRootOf(deep)).toBe(repo)
  })

  it('accepts a .git FILE, which is what a worktree and a submodule have', () => {
    const repo = mk('wt')
    fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /elsewhere\n')
    expect(repoRootOf(mk('wt', 'sub'))).toBe(repo)
  })

  it('is null outside a repository', () => {
    expect(repoRootOf(mk('loose'))).toBe(null)
  })
})

describe('artifactDirs — skills, agents, commands', () => {
  it('walks from the launch directory up to the repository root, nearest first', () => {
    const repo = mk('r')
    fs.mkdirSync(path.join(repo, '.git'))
    const deep = mk('r', 'packages', 'frontend')
    expect(artifactDirs(deep)).toEqual([
      deep,
      path.join(repo, 'packages'),
      repo,
    ])
  })

  it('stops AT the repository root and never climbs above it', () => {
    const repo = mk('r2')
    fs.mkdirSync(path.join(repo, '.git'))
    const dirs = artifactDirs(mk('r2', 'a', 'b'))
    expect(dirs[dirs.length - 1]).toBe(repo)
    expect(dirs).not.toContain(tmp)
  })

  it('is the project alone when there is no repository', () => {
    const loose = mk('nogit', 'x')
    expect(artifactDirs(loose)).toEqual([loose])
  })
})

describe('memoryDirs — CLAUDE.md', () => {
  it('does NOT stop at the repository root, because CLAUDE.md does not', () => {
    const repo = mk('r3')
    fs.mkdirSync(path.join(repo, '.git'))
    const deep = mk('r3', 'a')
    const dirs = memoryDirs(deep)
    expect(dirs).toContain(repo)
    expect(dirs).toContain(tmp)
    // and keeps going to the filesystem root
    expect(dirs[dirs.length - 1]).toBe(path.parse(tmp).root)
  })

  it('is ordered nearest first', () => {
    const deep = mk('r4', 'a', 'b')
    const dirs = memoryDirs(deep)
    expect(dirs[0]).toBe(deep)
    expect(dirs[1]).toBe(path.dirname(deep))
  })
})
