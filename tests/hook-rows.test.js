import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildInventory, buildProjectInventory } from '../src/server/api.js'

// These assert at the level the UI actually consumes — the item inside a
// group — not at the reader that produces it. The capability scan shipped once
// with its detector tested, its chip rendered, and nothing in between wiring
// the two together: every unit test passed and the feature did nothing.

let root, project
const scriptsOf = (inv) => inv.groups.find((g) => g.kind === 'scripts').items
const byLabel = (items, part) => items.find((i) => i.label.includes(part))

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-rows-'))
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-proj-'))
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true })
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(project, { recursive: true, force: true })
})

const writeGlobal = (settings) =>
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings))
const hook = (command) => ({
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] },
})

describe('what a hook row carries by the time the UI sees it', () => {
  it('attaches capabilities to the item, not only to the reader', () => {
    const script = path.join(root, 'rewrite.sh')
    fs.writeFileSync(script, '#!/bin/sh\necho \'{"permissionDecision":"allow","updatedInput":{}}\'\n')
    fs.chmodSync(script, 0o755)
    writeGlobal(hook(script))
    const row = byLabel(scriptsOf(buildInventory(root)), 'rewrite.sh')
    expect(row.capabilities.map((c) => c.id)).toContain('auto-approves')
  })

  it('does the same at project scope', () => {
    const script = path.join(project, 'guard.sh')
    fs.writeFileSync(script, '#!/bin/sh\nexit 2\n')
    fs.chmodSync(script, 0o755)
    fs.writeFileSync(path.join(project, '.claude/settings.json'), JSON.stringify(hook(script)))
    const row = byLabel(scriptsOf(buildProjectInventory(project)), 'guard.sh')
    expect(row.capabilities.map((c) => c.id)).toContain('blocks')
  })
})

describe('hooks that name no script file', () => {
  it('lists an inline hook instead of dropping it', () => {
    // `npx prettier --write` is a perfectly normal hook. It resolves to no
    // script path, and the page that exists to show what is configured
    // used to omit it entirely.
    writeGlobal(hook('npx prettier --write'))
    const items = scriptsOf(buildInventory(root))
    expect(items).toHaveLength(1)
    expect(items[0].inline).toBe(true)
    expect(items[0].reason).toMatch(/names no script file/)
  })

  it('does not call an inline hook broken, because it runs', () => {
    writeGlobal(hook('echo hello'))
    expect(scriptsOf(buildInventory(root))[0].broken).toBe(false)
  })

  it('points an inline hook at the settings file that declares it', () => {
    writeGlobal(hook('echo hello'))
    expect(scriptsOf(buildInventory(root))[0].path).toBe(path.join(root, 'settings.json'))
  })

  it('still calls a named-but-missing script broken', () => {
    writeGlobal(hook(path.join(root, 'gone.sh')))
    const row = scriptsOf(buildInventory(root))[0]
    expect(row.broken).toBe(true)
    expect(row.inline).toBe(false)
  })
})

describe('hook declarations the reader cannot walk', () => {
  it('shows a hooks block that is not a list, rather than skipping it', () => {
    writeGlobal({ hooks: { PreToolUse: { matcher: 'Bash' } } })
    const items = scriptsOf(buildInventory(root))
    expect(items).toHaveLength(1)
    expect(items[0].state).toBe('malformed')
    expect(items[0].reason).toMatch(/not a list of matchers/)
  })

  it('shows a hook entry with no command string', () => {
    writeGlobal({ hooks: { PreToolUse: [{ hooks: [{ type: 'command' }] }] } })
    const row = scriptsOf(buildInventory(root))[0]
    expect(row.state).toBe('malformed')
    expect(row.reason).toMatch(/no command string/)
  })
})
