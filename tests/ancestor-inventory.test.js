// A project's inventory must include what Claude Code actually loads for that
// project, which includes configuration in parent directories. Reading only
// the launch directory meant a CLAUDE.md one level up — genuinely in every
// session's context — was absent from the page whose whole purpose is to list
// what is loaded.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildProjectInventory } from '../src/server/api.js'

let tmp, repo, deep
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-ai-')))
  repo = path.join(tmp, 'repo')
  deep = path.join(repo, 'packages', 'frontend')
  fs.mkdirSync(deep, { recursive: true })
  fs.mkdirSync(path.join(repo, '.git'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const write = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
const skill = (dir, name) => write(path.join(dir, '.claude/skills', name, 'SKILL.md'),
  `---\nname: ${name}\ndescription: d\n---\nbody\n`)
const items = (inv, kind) => inv.groups.find((g) => g.kind === kind)?.items ?? []

describe('memory from parent directories', () => {
  it('lists a CLAUDE.md above the project, which every session loads', () => {
    write(path.join(repo, 'CLAUDE.md'), '# repo root\n')
    write(path.join(deep, 'CLAUDE.md'), '# here\n')
    const labels = items(buildProjectInventory(deep), 'memory').map((i) => i.label)
    expect(labels.some((l) => l.includes('CLAUDE.md'))).toBe(true)
    expect(labels.length).toBe(2)
  })

  it('marks which ones came from above, so the path is not a surprise', () => {
    write(path.join(repo, 'CLAUDE.md'), '# up\n')
    const up = items(buildProjectInventory(deep), 'memory').find((i) => i.path.startsWith(repo + path.sep) && !i.path.startsWith(deep))
    expect(up.fromAncestor).toBe(true)
    expect(up.declaredIn).toBe(repo)
  })

  it('climbs past the repository root, because CLAUDE.md does', () => {
    write(path.join(tmp, 'CLAUDE.md'), '# above the repo\n')
    const found = items(buildProjectInventory(deep), 'memory').map((i) => i.path)
    expect(found).toContain(path.join(tmp, 'CLAUDE.md'))
  })
})

describe('skills from parent directories', () => {
  it('picks up a skill defined at the repository root', () => {
    skill(repo, 'shared')
    skill(deep, 'local')
    const names = items(buildProjectInventory(deep), 'skill').map((i) => i.label).sort()
    expect(names).toEqual(['local', 'shared'])
  })

  it('stops at the repository root and ignores anything above it', () => {
    skill(tmp, 'outside')
    const names = items(buildProjectInventory(deep), 'skill').map((i) => i.label)
    expect(names).not.toContain('outside')
  })

  it('when a name collides the closest one wins, and says what it shadows', () => {
    skill(repo, 'dup')
    skill(deep, 'dup')
    const found = items(buildProjectInventory(deep), 'skill').filter((i) => i.label === 'dup')
    expect(found.length).toBe(1)
    expect(found[0].path.startsWith(deep)).toBe(true)
    expect(found[0].shadows).toEqual([path.join(repo, '.claude/skills/dup/SKILL.md')])
  })
})

describe('agents and commands from parent directories', () => {
  it('finds an agent declared at the repository root', () => {
    write(path.join(repo, '.claude/agents/helper.md'), '---\nname: helper\n---\nx\n')
    expect(items(buildProjectInventory(deep), 'agent').map((i) => i.label)).toContain('helper')
  })

  it('finds a command declared at the repository root', () => {
    write(path.join(repo, '.claude/commands/ship.md'), 'do it\n')
    expect(items(buildProjectInventory(deep), 'command').map((i) => i.label)).toContain('ship')
  })
})
