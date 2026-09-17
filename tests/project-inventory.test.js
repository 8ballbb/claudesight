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

  it('reads a plugin source repo, whose artifacts sit at the repo root', () => {
    write('.claude-plugin/plugin.json', '{"name":"spyglass","version":"0.3.3"}')
    write('agents/test-planner.md', '---\nname: test-planner\ndescription: d\n---\n')
    write('skills/spyglass/SKILL.md', '---\nname: spyglass\ndescription: d\n---\n')
    const c = counts(buildProjectInventory(project))
    expect(c).toMatchObject({ agent: 1, skill: 1, manifest: 1 })
  })

  it('does not read root-level agents when there is no plugin manifest', () => {
    // A plain project with an unrelated agents/ directory is not a plugin.
    write('agents/notes.md', '# not a Claude agent\n')
    expect(counts(buildProjectInventory(project)).agent).toBeUndefined()
  })

  it('surfaces scripts a project settings file tells Claude Code to execute', () => {
    write('scripts/guard.sh', '#!/bin/sh\necho guarding\n')
    write('.claude/settings.json', JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ command: 'bash ./scripts/guard.sh' }] }] },
    }))
    const scripts = buildProjectInventory(project).groups.find((g) => g.kind === 'scripts')
    expect(scripts.items).toHaveLength(1)
    expect(scripts.items[0]).toMatchObject({ label: 'guard.sh', kind: 'hookScript' })
    expect(scripts.items[0].keyPath).toContain('settings.json')
    // Executed as shell, so it must never be classified as plain text.
    expect(scripts.items[0].writability.class).toBe('exec')
  })

  it('shows a hook whose script is missing, rather than dropping it', () => {
    // Claude Code still fires this hook on every matching tool use; it just
    // fails. Silence here is the app lying about what is configured.
    write('.claude/settings.json', JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ command: 'bash ./scripts/deleted.sh' }] }] },
    }))
    const scripts = buildProjectInventory(project).groups.find((g) => g.kind === 'scripts')
    expect(scripts.items).toHaveLength(1)
    expect(scripts.items[0]).toMatchObject({ label: 'deleted.sh', state: 'absent', broken: true })
  })

  it('lists a hook that runs an inline command, without inventing a script for it', () => {
    // This used to assert zero rows. Not inventing a script was right; hiding
    // the hook was not — Claude Code runs it on every matching tool use, and a
    // page that exists to list what is configured omitted it entirely. The row
    // now exists, says it is inline, and claims no script path of its own.
    write('.claude/settings.json', JSON.stringify({
      hooks: { PreToolUse: [{ hooks: [{ command: 'echo checking' }] }] },
    }))
    const scripts = buildProjectInventory(project).groups.find((g) => g.kind === 'scripts')
    expect(scripts.items).toHaveLength(1)
    expect(scripts.items[0]).toMatchObject({ inline: true, state: 'not-declared', broken: false })
    expect(scripts.items[0].command).toBe('echo checking')
    // The row points at the file that declares it, which is what you would edit.
    expect(scripts.items[0].path).toBe(path.join(project, '.claude/settings.json'))
  })

  it('resolves a hook written against $CLAUDE_PROJECT_DIR', () => {
    write('scripts/fmt.sh', '#!/bin/sh\n')
    write('.claude/settings.json', JSON.stringify({
      hooks: { PostToolUse: [{ hooks: [{ command: '$CLAUDE_PROJECT_DIR/scripts/fmt.sh' }] }] },
    }))
    const scripts = buildProjectInventory(project).groups.find((g) => g.kind === 'scripts')
    expect(scripts.items.map((i) => i.label)).toEqual(['fmt.sh'])
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
