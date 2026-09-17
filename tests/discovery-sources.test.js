import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverProjects } from '../src/server/discover.js'
import { SOURCE_NOTE } from '../src/ui/Inventory.jsx'

// discoverProjects was the only builder in the codebase that computed a
// five-state reader result and threw it away: a denied or corrupt registry
// produced [], which is what a healthy registry listing zero projects also
// produces. "I found nothing" and "I could not look" were the same answer.

let home, root
const sourceFor = (label, res) => res.sources.find((s) => s.label === label)

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-src-'))
  root = path.join(home, '.claude')
  fs.mkdirSync(root, { recursive: true })
})
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

describe('the project registry', () => {
  it('reports ok when it reads cleanly', () => {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: {} }))
    expect(sourceFor('project registry', discoverProjects(root, home)).state).toBe('ok')
  })

  it('reports absent when there is no registry at all', () => {
    expect(sourceFor('project registry', discoverProjects(root, home)).state).toBe('absent')
  })

  it('reports malformed rather than pretending there are no projects', () => {
    fs.writeFileSync(path.join(home, '.claude.json'), '{ "projects": ')
    const src = sourceFor('project registry', discoverProjects(root, home))
    expect(src.state).toBe('malformed')
    // The distinction is the whole point: this must not read as "zero projects".
    expect(src.state).not.toBe('empty')
  })
})

describe('prompt history', () => {
  it('counts lines it could not parse instead of swallowing them', () => {
    fs.writeFileSync(path.join(root, 'history.jsonl'),
      `${JSON.stringify({ project: '/a' })}\n{"project": broken\n`)
    const src = sourceFor('prompt history', discoverProjects(root, home))
    expect(src.state).toBe('malformed')
    expect(src.badLines).toBe(1)
  })

  it('is absent, not empty, when the file was never written', () => {
    expect(sourceFor('prompt history', discoverProjects(root, home)).state).toBe('absent')
  })

  it('is empty when the file exists with nothing in it', () => {
    fs.writeFileSync(path.join(root, 'history.jsonl'), '')
    expect(sourceFor('prompt history', discoverProjects(root, home)).state).toBe('empty')
  })
})

describe('session transcripts', () => {
  it('is absent when no transcripts directory exists', () => {
    expect(sourceFor('session transcripts', discoverProjects(root, home)).state).toBe('absent')
  })

  it('reports partial, with a count, when a transcript cannot be read', () => {
    if (process.getuid && process.getuid() === 0) return // root reads anything
    const dir = path.join(root, 'projects', 'p')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.jsonl'), JSON.stringify({ cwd: '/x' }))
    const locked = path.join(dir, 'locked.jsonl')
    fs.writeFileSync(locked, JSON.stringify({ cwd: '/y' }))
    fs.chmodSync(locked, 0o000)
    try {
      const src = sourceFor('session transcripts', discoverProjects(root, home))
      expect(src.state).toBe('partial')
      expect(src.unreadable).toBe(1)
    } finally {
      fs.chmodSync(locked, 0o600)
    }
  })
})

describe('the copy that reaches the screen', () => {
  it('has a sentence for every state discovery can produce', () => {
    for (const state of ['ok', 'empty', 'absent', 'denied', 'malformed', 'partial']) {
      if (state === 'ok') continue // 'ok' is never rendered as a notice
      expect(SOURCE_NOTE[state], `no copy for "${state}"`).toBeTypeOf('function')
    }
  })

  it('says partial means read-but-incompletely, not read-and-empty', () => {
    expect(SOURCE_NOTE.partial('/p/projects')).toMatch(/some entries inside could not be/)
    expect(SOURCE_NOTE.partial('/p/projects')).not.toMatch(/empty|does not exist/)
  })
})
