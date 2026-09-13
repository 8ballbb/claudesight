import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverProjects, projectMarkers } from '../src/server/discover.js'

let home, root

const transcript = (dirName, file, cwd) => {
  const dir = path.join(root, 'projects', dirName, path.dirname(file))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(root, 'projects', dirName, file),
    `${JSON.stringify({ type: 'x' })}\n${JSON.stringify({ type: 'user', cwd })}\n`)
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-disc-'))
  root = path.join(home, '.claude')
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true })
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: {} }))
})
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const mkProject = (name) => {
  const p = path.join(home, name)
  fs.mkdirSync(p, { recursive: true })
  return p
}

describe('discoverProjects', () => {
  it('finds a project only the registry knows about', () => {
    const p = mkProject('from-registry')
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [p]: {} } }))
    expect(discoverProjects(root, home).projects.map((x) => x.path)).toContain(p)
  })

  it('finds a project only history.jsonl knows about', () => {
    const p = mkProject('from-history')
    fs.writeFileSync(path.join(root, 'history.jsonl'),
      `${JSON.stringify({ display: 'hi', project: p })}\n`)
    expect(discoverProjects(root, home).projects.map((x) => x.path)).toContain(p)
  })

  it('finds a project only a transcript cwd knows about', () => {
    const p = mkProject('from-transcript')
    transcript('-mangled-name', 'a.jsonl', p)
    expect(discoverProjects(root, home).projects.map((x) => x.path)).toContain(p)
  })

  it('finds a project known only from a NESTED subagent transcript', () => {
    // This is how the app's own repo was discovered: subagents ran there
    // without ever triggering the trust decision that registers a project.
    const p = mkProject('only-subagents')
    transcript('-mangled', 'sess/subagents/agent-1.jsonl', p)
    expect(discoverProjects(root, home).projects.map((x) => x.path)).toContain(p)
  })

  it('counts one session per transcript, not one per cwd line', () => {
    const p = mkProject('counted')
    transcript('-m', 'a.jsonl', p)
    transcript('-m', 'b.jsonl', p)
    expect(discoverProjects(root, home).projects.find((x) => x.path === p).sessions).toBe(2)
  })

  it('ranks by session count', () => {
    const quiet = mkProject('quiet')
    const busy = mkProject('busy')
    transcript('-m', 'a.jsonl', quiet)
    for (const n of ['b', 'c', 'd']) transcript('-m', `${n}.jsonl`, busy)
    expect(discoverProjects(root, home).projects[0].path).toBe(busy)
  })

  it('filters temp directories, the home directory and the config root', () => {
    transcript('-m', 'a.jsonl', '/private/tmp/scratch')
    transcript('-m', 'b.jsonl', home)
    transcript('-m', 'c.jsonl', path.join(root, 'plugins'))
    const r = discoverProjects(root, home)
    expect(r.projects).toHaveLength(0)
    expect(r.filtered).toBe(3)
  })

  it('marks a directory that no longer exists rather than dropping it', () => {
    const gone = path.join(home, 'deleted-since')
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [gone]: {} } }))
    const found = discoverProjects(root, home).projects.find((x) => x.path === gone)
    expect(found.exists).toBe(false)
    expect(found.markers).toBeNull()
  })

  it('accepts extra directories the user added by hand', () => {
    const p = mkProject('added-by-hand')
    expect(discoverProjects(root, home, [p]).projects.map((x) => x.path)).toContain(p)
  })

  it('does not fall over on an unparseable transcript', () => {
    fs.mkdirSync(path.join(root, 'projects', '-bad'), { recursive: true })
    fs.writeFileSync(path.join(root, 'projects', '-bad', 'x.jsonl'), '{ not json\n')
    expect(() => discoverProjects(root, home)).not.toThrow()
  })
})

describe('projectMarkers', () => {
  it('reports which Claude files a directory actually holds', () => {
    const p = mkProject('marked')
    fs.writeFileSync(path.join(p, 'CLAUDE.md'), '# hi')
    fs.mkdirSync(path.join(p, '.claude', 'skills'), { recursive: true })
    fs.writeFileSync(path.join(p, '.mcp.json'), '{}')
    const m = projectMarkers(p)
    expect(m).toMatchObject({ memory: true, skills: true, mcp: true, claudeDir: true, git: false })
  })

  it('reports nothing for a directory Claude merely ran in', () => {
    const m = projectMarkers(mkProject('bare'))
    expect(Object.values(m).every((v) => v === false)).toBe(true)
  })
})
