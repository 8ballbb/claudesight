// Adding the four artifact kinds that are user-authored, already visible in
// the app, safe to create, and not deprecated. Commands are deliberately
// absent: the docs mark them deprecated in favour of skills, and a creator
// that steers people onto a deprecated mechanism is worse than none.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createArtifact, targetFor, CREATABLE } from '../src/server/create.js'

let home, root, project
beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-create-')))
  root = path.join(home, '.claude')
  fs.mkdirSync(root, { recursive: true })
  project = path.join(home, 'proj')
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true })
})
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const make = (over) => createArtifact({ root, name: 'thing', description: 'what it does', ...over })
const read = (p) => fs.readFileSync(p, 'utf8')

describe('which kinds can be created', () => {
  it('offers exactly the four Tier 1 kinds', () => {
    expect([...CREATABLE].sort()).toEqual(['agent', 'memory', 'rule', 'skill'])
  })

  it('refuses a kind that is not creatable, naming it', () => {
    const r = make({ kind: 'command' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('unsupported-kind')
  })

  it('refuses commands specifically, because they are deprecated', () => {
    expect(make({ kind: 'command' }).reason).toMatch(/deprecated|skill/i)
  })
})

describe('where each kind lands', () => {
  it('puts a skill at skills/<name>/SKILL.md', () => {
    expect(targetFor({ kind: 'skill', root, name: 'a' })).toBe(path.join(root, 'skills', 'a', 'SKILL.md'))
  })

  it('puts an agent at agents/<name>.md', () => {
    expect(targetFor({ kind: 'agent', root, name: 'a' })).toBe(path.join(root, 'agents', 'a.md'))
  })

  it('puts a rule at rules/<name>.md', () => {
    expect(targetFor({ kind: 'rule', root, name: 'a' })).toBe(path.join(root, 'rules', 'a.md'))
  })

  it('puts global memory in the config root', () => {
    expect(targetFor({ kind: 'memory', root })).toBe(path.join(root, 'CLAUDE.md'))
  })

  it('puts project memory at the project root, not inside .claude', () => {
    // Both locations are valid; ./CLAUDE.md is the one /init writes and the
    // one a reader expects to find at the top of a repository.
    expect(targetFor({ kind: 'memory', root: path.join(project, '.claude'), projectPath: project }))
      .toBe(path.join(project, 'CLAUDE.md'))
  })
})

describe('creating an agent', () => {
  it('writes valid frontmatter with the two required fields', () => {
    const r = make({ kind: 'agent' })
    expect(r.ok).toBe(true)
    const text = read(r.path)
    expect(text).toMatch(/^---\nname: thing\n/)
    expect(text).toContain('description:')
  })

  it('requires a description, because it is how Claude decides to delegate', () => {
    expect(make({ kind: 'agent', description: '  ' }).error).toBe('invalid-description')
  })

  it('creates nothing that turns off the approval prompt', () => {
    const r = make({ kind: 'agent' })
    expect(read(r.path)).not.toMatch(/permissionMode|bypassPermissions|hooks:/)
  })
})

describe('creating a rule', () => {
  it('needs no description — a rule is just instructions', () => {
    const r = make({ kind: 'rule', description: '' })
    expect(r.ok).toBe(true)
  })

  it('does not invent a paths: filter, which would silently scope it', () => {
    const r = make({ kind: 'rule', description: '' })
    expect(read(r.path)).not.toMatch(/^paths:/m)
  })
})

describe('creating memory', () => {
  it('needs no name, because the filename is fixed', () => {
    const r = createArtifact({ root, kind: 'memory' })
    expect(r.ok).toBe(true)
    expect(r.path).toBe(path.join(root, 'CLAUDE.md'))
  })

  it('refuses to clobber a CLAUDE.md that already exists', () => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'mine\n')
    const r = createArtifact({ root, kind: 'memory' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('exists')
    expect(read(path.join(root, 'CLAUDE.md'))).toBe('mine\n')
  })
})

describe('rules that apply to every kind', () => {
  it('rejects a name that would escape the directory', () => {
    expect(make({ kind: 'agent', name: '../escape' }).error).toBe('invalid-name')
    expect(make({ kind: 'rule', name: 'a/b' }).error).toBe('invalid-name')
  })

  it('refuses rather than overwriting an existing file', () => {
    expect(make({ kind: 'agent' }).ok).toBe(true)
    expect(make({ kind: 'agent' }).error).toBe('exists')
  })

  it('works at project scope too', () => {
    const r = createArtifact({
      root: path.join(project, '.claude'), projectPath: project,
      kind: 'agent', name: 'proj-agent', description: 'd',
    })
    expect(r.ok).toBe(true)
    expect(r.path).toBe(path.join(project, '.claude', 'agents', 'proj-agent.md'))
  })

  it('creates a skill at project scope, which was global-only before', () => {
    const r = createArtifact({
      root: path.join(project, '.claude'), projectPath: project,
      kind: 'skill', name: 'proj-skill', description: 'd',
    })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(project, '.claude', 'skills', 'proj-skill', 'SKILL.md'))).toBe(true)
  })
})
