import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createArtifact, validateName } from '../src/server/create.js'
import { readSkills } from '../src/server/readers/skills.js'

let root

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-create-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('validateName', () => {
  it('accepts kebab-case', () => {
    expect(validateName('my-skill')).toBeNull()
    expect(validateName('a1')).toBeNull()
  })

  it('rejects rather than sanitises', () => {
    for (const bad of ['', 'Has Caps', 'with space', '-leading', '../escape', 'a/b', 'ünïcode', 'x'.repeat(65)]) {
      expect(validateName(bad), bad).toBeTruthy()
    }
  })
})

describe('creating a skill', () => {
  it('creates the directory and a SKILL.md', () => {
    const r = createArtifact({ root, kind: 'skill', name: 'my-skill', description: 'Use when testing things.' })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'skills', 'my-skill', 'SKILL.md'))).toBe(true)
  })

  it('produces a skill our own reader accepts as well-formed', () => {
    createArtifact({ root, kind: 'skill', name: 'round-trip', description: 'Use when checking the round trip.' })
    const found = readSkills(root).skills.find((s) => s.name === 'round-trip')
    expect(found).toBeTruthy()
    expect(found.malformed).toBe(false)
    expect(found.unreadable).toBeNull()
    expect(found.description).toBe('Use when checking the round trip.')
    expect(found.origin).toBe('user')
  })

  it('requires a description, because an undescribed skill is invisible', () => {
    const r = createArtifact({ root, kind: 'skill', name: 'nodesc', description: '   ' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid-description')
    expect(fs.existsSync(path.join(root, 'skills', 'nodesc'))).toBe(false)
  })

  it('keeps a multi-line description from breaking the frontmatter', () => {
    createArtifact({ root, kind: 'skill', name: 'multi', description: 'first line\nsecond line\n\nthird' })
    const found = readSkills(root).skills.find((s) => s.name === 'multi')
    expect(found.malformed).toBe(false)
    expect(found.description).toBe('first line second line third')
  })

  it('caps a very long description', () => {
    createArtifact({ root, kind: 'skill', name: 'long', description: 'x'.repeat(900) })
    expect(readSkills(root).skills.find((s) => s.name === 'long').description).toHaveLength(400)
  })

  it('refuses to overwrite an existing skill', () => {
    createArtifact({ root, kind: 'skill', name: 'twice', description: 'first' })
    const second = createArtifact({ root, kind: 'skill', name: 'twice', description: 'second' })
    expect(second.ok).toBe(false)
    expect(second.error).toBe('exists')
    expect(readSkills(root).skills.find((s) => s.name === 'twice').description).toBe('first')
  })

  it('completes a half-made skill directory rather than refusing', () => {
    fs.mkdirSync(path.join(root, 'skills', 'partial'), { recursive: true })
    fs.writeFileSync(path.join(root, 'skills', 'partial', 'notes.md'), 'scratch')
    expect(createArtifact({ root, kind: 'skill', name: 'partial', description: 'finish me' }).ok).toBe(true)
  })

  it('warns about a plugin skill of the same name instead of refusing', () => {
    const pluginSkill = path.join(root, 'plugins/cache/mk/superpowers/1.0.0/skills/brainstorming')
    fs.mkdirSync(pluginSkill, { recursive: true })
    fs.writeFileSync(path.join(pluginSkill, 'SKILL.md'), '---\nname: brainstorming\ndescription: theirs\n---\n')

    const r = createArtifact({ root, kind: 'skill', name: 'brainstorming', description: 'mine' })
    expect(r.ok).toBe(true)
    expect(r.warning).toMatch(/both will load/i)
    expect(r.warning).toContain('/brainstorming')
  })

  it('reports a name that fails validation without touching the filesystem', () => {
    const r = createArtifact({ root, kind: 'skill', name: '../escape', description: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid-name')
    expect(fs.existsSync(path.join(root, 'skills'))).toBe(false)
  })

  it('reports a skills path that is a file rather than a directory', () => {
    fs.writeFileSync(path.join(root, 'skills'), 'not a directory')
    const r = createArtifact({ root, kind: 'skill', name: 'blocked', description: 'x' })
    expect(r.ok).toBe(false)
    expect(['not-a-directory', 'exists', 'denied']).toContain(r.error)
  })
})
