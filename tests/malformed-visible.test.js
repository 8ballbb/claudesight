import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildInventory, buildProjectInventory } from '../src/server/api.js'

let root
const BROKEN = '{\n  "model": "opus",\n  "x": ,\n}\n'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-malformed-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const settingsOf = (inv) => inv.groups.find((g) => g.kind === 'settings').items

describe('a broken settings.json is shown, not swallowed', () => {
  it('global scope keeps the item — an empty group would be a bare zero', () => {
    // This is the defect: `state === 'ok' ? [item] : []` meant a syntax error
    // in the most important file here rendered as no settings at all.
    fs.writeFileSync(path.join(root, 'settings.json'), BROKEN)
    const items = settingsOf(buildInventory(root))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'settings.json', state: 'malformed', keys: 0 })
  })

  it('project scope agrees with global scope', () => {
    const dir = path.join(root, '.claude')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'settings.json'), BROKEN)
    expect(settingsOf(buildProjectInventory(root))[0].state).toBe('malformed')
  })

  it('a truly absent settings file still produces nothing', () => {
    // "Broken" and "not there" must not collapse into each other either.
    expect(settingsOf(buildInventory(root))).toHaveLength(0)
  })

  it('a malformed .mcp.json keeps its item too', () => {
    fs.writeFileSync(path.join(root, '.mcp.json'), BROKEN)
    const mcp = buildProjectInventory(root).groups.find((g) => g.kind === 'mcp')
    expect(mcp.items[0]).toMatchObject({ state: 'malformed', servers: 0 })
  })

  it('carries a position when the parser reports one', () => {
    fs.writeFileSync(path.join(root, 'settings.json'), '{"a":1,,}')
    const [item] = settingsOf(buildInventory(root))
    expect(item.line).toBe(1)
    expect(item.column).toBeGreaterThan(1)
  })

  it('carries null, not line 1, when the parser reports none', () => {
    fs.writeFileSync(path.join(root, 'settings.json'), BROKEN)
    const [item] = settingsOf(buildInventory(root))
    expect(item.line).toBeNull()
  })

  it('still counts keys normally when the file parses', () => {
    fs.writeFileSync(path.join(root, 'settings.json'), '{"a":1,"b":2}')
    expect(settingsOf(buildInventory(root))[0]).toMatchObject({ state: 'ok', keys: 2 })
  })
})

describe('the row says what is wrong', () => {
  const src = fs.readFileSync('src/ui/Inventory.jsx', 'utf8')

  it('prefers the parse error over the key count', () => {
    expect(src).toContain("item.state === 'malformed'")
    expect(src).toContain('invalid JSON at line')
  })

  it('admits when the parser did not give a position', () => {
    expect(src).toContain('the parser did not say where')
  })

  it('treats a file Claude Code cannot parse as broken, not a caution', () => {
    expect(src).toMatch(/item\.state === 'malformed'\) out\.push\(\['malformed', s\.alarm\]\)/)
  })

  it('names both versions on a drifted plugin instead of just "drift"', () => {
    expect(src).toContain('manifest says')
  })
})
