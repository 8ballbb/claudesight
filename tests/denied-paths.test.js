import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildInventory, buildProjectInventory } from '../src/server/api.js'

// "3 directories could not be read" tells you the page is incomplete but not
// what to do about it. The path is the actionable part — on a managed machine
// it is what you hand to an administrator.
let root, locked

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-denied-'))
  locked = path.join(root, 'skills', 'private')
  fs.mkdirSync(locked, { recursive: true })
  fs.writeFileSync(path.join(locked, 'SKILL.md'), '---\nname: hidden\ndescription: d\n---\n')
  fs.chmodSync(locked, 0o000)
})

afterEach(() => {
  try { fs.chmodSync(locked, 0o700) } catch { /* already restored */ }
  fs.rmSync(root, { recursive: true, force: true })
})

const rootIsReadableAnyway = () => {
  try { fs.readdirSync(locked); return true } catch { return false }
}

describe('denied directories', () => {
  it('reports the path, not just a count', () => {
    if (rootIsReadableAnyway()) return // running as root defeats the mode bits
    const inv = buildInventory(root)
    expect(inv.denied).toContain(locked)
  })

  it('reports denied paths at project scope too', () => {
    if (rootIsReadableAnyway()) return
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-denied-proj-'))
    const dir = path.join(project, '.claude', 'skills', 'private')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: x\ndescription: d\n---\n')
    fs.chmodSync(dir, 0o000)
    try {
      expect(buildProjectInventory(project).denied).toContain(dir)
    } finally {
      fs.chmodSync(dir, 0o700)
      fs.rmSync(project, { recursive: true, force: true })
    }
  })

  it('never silently succeeds — an unreadable skill directory is not zero skills', () => {
    if (rootIsReadableAnyway()) return
    const inv = buildInventory(root)
    const skills = inv.groups.find((g) => g.kind === 'skill')
    // The skill inside is genuinely not listed; the denial is how we say so.
    expect(skills.items).toHaveLength(0)
    expect(inv.denied.length).toBeGreaterThan(0)
  })
})

// The UI half of this file used to read Inventory.jsx as a string and assert
// on fragments like `title={p}` — which passes even if Notices has stopped
// rendering. Those behaviours are now asserted against a mounted component in
// tests/ui-behaviour.test.jsx: the paths themselves, their title attributes,
// the fold on long lists and the errno beside an unexpected failure.
