import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSkills } from '../src/server/readers/skills.js'

let root
const writeSkill = (dir, name, desc) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\nBody text.\n`)
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-skills-'))
  // The author's real shape: NO ~/.claude/skills, everything under plugins/cache
  writeSkill(path.join(root, 'plugins/cache/spyglass/spyglass/0.1.0/skills/spyglass'),
    'spyglass', 'Design-first Python development')
  writeSkill(path.join(root, 'plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/brainstorming'),
    'brainstorming', 'Turn ideas into designs')
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('readSkills', () => {
  it('finds plugin-delivered skills when ~/.claude/skills does not exist', () => {
    const r = readSkills(root)
    expect(r.skills.map((s) => s.name).sort()).toEqual(['brainstorming', 'spyglass'])
  })

  it('attributes each skill to its plugin and marketplace', () => {
    const s = readSkills(root).skills.find((x) => x.name === 'spyglass')
    expect(s.origin).toBe('plugin')
    expect(s.plugin).toBe('spyglass')
    expect(s.marketplace).toBe('spyglass')
  })

  it('parses the description from frontmatter', () => {
    const s = readSkills(root).skills.find((x) => x.name === 'brainstorming')
    expect(s.description).toBe('Turn ideas into designs')
  })

  it('reports the missing user skills dir as absent, not as zero skills', () => {
    const report = readSkills(root).sources.find((s) => s.label === 'user')
    expect(report.state).toBe('absent')
  })

  it('classifies skills/synced as its own origin', () => {
    writeSkill(path.join(root, 'skills/synced/from-cloud'), 'from-cloud', 'Synced from claude.ai')
    expect(readSkills(root).skills.find((s) => s.name === 'from-cloud').origin).toBe('synced')
  })

  it('flags a SKILL.md whose frontmatter will not parse', () => {
    const dir = path.join(root, 'skills', 'broken')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: [unterminated\n---\n\nbody\n')
    const s = readSkills(root).skills.find((x) => x.path.includes('broken'))
    expect(s.malformed).toBe(true)
    expect(s.description).toBeNull()
  })

  it('does not flag a well-formed skill as malformed', () => {
    const s = readSkills(root).skills.find((x) => x.name === 'spyglass')
    expect(s.malformed).toBe(false)
    expect(s.unreadable).toBeNull()
  })

  it('reports an unreadable SKILL.md rather than presenting it as normal', () => {
    if (process.getuid && process.getuid() === 0) return
    const dir = path.join(root, 'skills', 'locked-skill')
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'SKILL.md')
    fs.writeFileSync(f, '---\nname: locked\n---\n')
    fs.chmodSync(f, 0o000)
    try {
      const s = readSkills(root).skills.find((x) => x.path === f)
      expect(s.unreadable).toBe('denied')
    } finally {
      fs.chmodSync(f, 0o644)
    }
  })
})

describe('vendored copies', () => {
  it('ignores skills inside hidden vendor directories', () => {
    // Plugin repos ship copies for other agents under .cursor/, .codex-plugin/
    // and similar. Claude Code does not load those.
    writeSkill(path.join(root, 'plugins/cache/mk/p/1.0.0/.cursor/skills/dupe'),
      'dupe', 'vendored copy for another agent')
    writeSkill(path.join(root, 'plugins/cache/mk/p/1.0.0/skills/dupe'),
      'dupe', 'the real one')
    const found = readSkills(root).skills.filter((s) => s.name === 'dupe')
    expect(found).toHaveLength(1)
    expect(found[0].description).toBe('the real one')
  })

  it('still finds skills whose plugin lives under a hidden root', () => {
    // ~/.claude is itself hidden; filtering must be relative to the walk root.
    expect(readSkills(root).skills.length).toBeGreaterThan(0)
  })
})
