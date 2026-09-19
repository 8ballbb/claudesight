// Every row's id must be unique. Ids are React keys and the selection key, so
// two rows sharing one means duplicate keys in a list and clicking either
// highlighting both.
//
// handleFor() hashes the path, and several rows legitimately SHARE a path: an
// MCP server is addressed by the .mcp.json that declares it, and an inline
// hook by the settings.json that declares it. So the .mcp.json row and every
// server in it had one id between them, as did settings.json and every inline
// hook. The row, not the file, needs the identity.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildInventory, buildProjectInventory } from '../src/server/api.js'

let root
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-ids-'))) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const write = (rel, body) => {
  const f = path.join(root, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, body)
}
const settingsWithHooks = JSON.stringify({
  hooks: {
    Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'npx prettier --write .' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo one' }] }],
  },
})
const mcp = JSON.stringify({ mcpServers: { alpha: { command: 'node' }, beta: { command: 'nope-xyz' } } })

const ids = (inv) => inv.groups.flatMap((g) => g.items.map((i) => i.id))
const dupes = (list) => list.filter((x, i) => list.indexOf(x) !== i)

describe('project rows', () => {
  it('gives every row its own id, including inline hooks and MCP servers', () => {
    write('.claude/settings.json', settingsWithHooks)
    write('.mcp.json', mcp)
    const list = ids(buildProjectInventory(root))
    expect(dupes(list)).toEqual([])
  })

  it('separates the .mcp.json row from the servers declared inside it', () => {
    write('.mcp.json', mcp)
    const rows = buildProjectInventory(root).groups.find((g) => g.kind === 'mcp').items
    expect(rows.length).toBe(3)
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
  })

  it('separates the settings row from the inline hooks it declares', () => {
    write('.claude/settings.json', settingsWithHooks)
    const inv = buildProjectInventory(root)
    const settings = inv.groups.find((g) => g.kind === 'settings').items[0]
    const scripts = inv.groups.find((g) => g.kind === 'scripts').items
    expect(new Set([settings.id, ...scripts.map((s) => s.id)]).size).toBe(1 + scripts.length)
  })

  // The rule, not the two instances of it. Identity is minted in one place
  // from the group, the path and what distinguishes the row inside that file,
  // so this holds for row kinds that do not exist yet — including the
  // plugin-source skills, which for a while bypassed the id rule entirely by
  // building their rows by hand.
  it('holds for every row a rich project produces, whatever made it', () => {
    write('.claude/settings.json', settingsWithHooks)
    write('.mcp.json', mcp)
    write('CLAUDE.md', '# project\n')
    write('.claude/skills/local/SKILL.md', '---\nname: local\ndescription: d\n---\nx\n')
    write('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: d\n---\nx\n')
    write('.claude/rules/testing.md', '# testing\n')
    // A plugin source repo keeps its skills at the repo root, and those rows
    // are appended to an already-built group.
    write('.claude-plugin/plugin.json', '{"name":"demo","version":"1.0.0"}')
    write('skills/published/SKILL.md', '---\nname: published\ndescription: d\n---\nx\n')

    const inv = buildProjectInventory(root)
    const list = ids(inv)
    expect(list.length).toBeGreaterThan(8)
    expect(dupes(list)).toEqual([])
    // and every one of them still names a file the editor can open
    for (const id of list) {
      const entry = inv.table.get(id)
      expect(entry, `id ${id} should resolve`).toBeTruthy()
      expect(fs.existsSync(entry.path)).toBe(true)
    }
  })

  // Not merely "the same tree twice" — that passed even when ids were a plain
  // hash of the path. Adding a row must not renumber the rows already there,
  // which is what an id derived from position in the file would do.
  it('does not renumber existing rows when a new one appears', () => {
    write('.claude/skills/beta/SKILL.md', '---\nname: beta\ndescription: d\n---\nx\n')
    write('.claude/skills/gamma/SKILL.md', '---\nname: gamma\ndescription: d\n---\nx\n')
    const before = new Map(
      buildProjectInventory(root).groups.flatMap((g) => g.items.map((i) => [i.label, i.id])),
    )

    write('.claude/skills/alpha/SKILL.md', '---\nname: alpha\ndescription: d\n---\nx\n')
    const after = new Map(
      buildProjectInventory(root).groups.flatMap((g) => g.items.map((i) => [i.label, i.id])),
    )

    for (const [label, id] of before) {
      expect(after.get(label), `${label} should keep its id`).toBe(id)
    }
    expect(after.has('alpha')).toBe(true)
  })
})

describe('global rows', () => {
  it('gives every row its own id there too', () => {
    write('settings.json', settingsWithHooks)
    write('CLAUDE.md', '# x\n')
    const list = ids(buildInventory(root))
    expect(dupes(list)).toEqual([])
  })
})
