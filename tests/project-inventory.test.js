import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildProjectInventory } from '../src/server/api.js'
import { projectMarkers } from '../src/server/discover.js'

let project

const write = (rel, body) => {
  const full = path.join(project, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
  return full
}

const counts = (inv) => Object.fromEntries(
  inv.groups.filter((g) => g.items.length).map((g) => [g.kind, g.items.length]))

beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-proj-')) })
afterEach(() => fs.rmSync(project, { recursive: true, force: true }))

describe('buildProjectInventory', () => {
  it('reads every documented project memory location', () => {
    write('CLAUDE.md', '# root')
    write('CLAUDE.local.md', '# local')
    write('.claude/CLAUDE.md', '# inside')
    expect(counts(buildProjectInventory(project)).memory).toBe(3)
  })

  it('resolves @-imports in project memory', () => {
    write('CLAUDE.md', '@shared.md\n')
    write('shared.md', '# shared')
    const memory = buildProjectInventory(project).groups.find((g) => g.kind === 'memory')
    expect(memory.items.map((i) => i.label)).toContain('shared.md')
  })

  it('reads both settings files and .mcp.json', () => {
    write('.claude/settings.json', '{"model":"opus"}')
    write('.claude/settings.local.json', '{"a":1,"b":2}')
    write('.mcp.json', '{"mcpServers":{"x":{},"y":{}}}')
    const c = counts(buildProjectInventory(project))
    expect(c.settings).toBe(2)
    expect(c.mcp).toBe(1)
  })

  it('reads agents, commands and nested rules', () => {
    write('.claude/agents/reviewer.md', '# reviewer')
    write('.claude/commands/deploy.md', '# deploy')
    write('.claude/rules/frontend/react.md', '# react')
    const c = counts(buildProjectInventory(project))
    expect(c.agent).toBe(1)
    expect(c.command).toBe(1)
    expect(c.rule).toBe(1)
  })

  it('never renders empty when .claude exists — the marker must not lie', () => {
    // A plugin's own working data. No reader knows this shape, and showing
    // nothing because of that is the failure this whole app exists to prevent.
    write('.claude/spyglass/plan/pseudocode.md', '# a plan')
    const inv = buildProjectInventory(project)
    expect(projectMarkers(project).claudeDir).toBe(true)
    const total = inv.groups.reduce((n, g) => n + g.items.length, 0)
    expect(total).toBeGreaterThan(0)
    const other = inv.groups.find((g) => g.kind === 'other')
    expect(other.items[0]).toMatchObject({ label: 'spyglass', entryType: 'directory' })
  })

  it('does not repeat a file under other that a reader already claimed', () => {
    write('.claude/settings.json', '{}')
    write('.claude/skills/mine/SKILL.md', '---\nname: mine\ndescription: d\n---\n')
    const other = buildProjectInventory(project).groups.find((g) => g.kind === 'other')
    expect(other.items.map((i) => i.label)).not.toContain('settings.json')
    expect(other.items.map((i) => i.label)).not.toContain('skills')
  })

  it('classifies project files as editable', () => {
    write('CLAUDE.md', '# hi')
    write('.claude/settings.json', '{}')
    const all = buildProjectInventory(project).groups.flatMap((g) => g.items)
    expect(all.every((i) => i.writability.class === 'free')).toBe(true)
  })

  it('reports an absent .claude through sources rather than silently', () => {
    write('CLAUDE.md', '# only memory')
    const inv = buildProjectInventory(project)
    expect(inv.sources[0].state).toBe('absent')
  })
})
