// "6 filtered" answered nothing. The reader's question is which directories
// were dropped and why — the server knew both and reduced them to a count on
// the last step to the screen, which is the shape of nearly every defect
// found in this codebase.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverProjects } from '../src/server/discover.js'

let home, root
beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-fr-')))
  root = path.join(home, '.claude')
  fs.mkdirSync(root, { recursive: true })
})
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

describe('filtered directories', () => {
  it('still reports how many were dropped', () => {
    const found = discoverProjects(root, home, [home, root])
    expect(found.filtered).toBeGreaterThan(0)
  })

  it('says WHICH directory was dropped and why, not only how many', () => {
    const found = discoverProjects(root, home, [home])
    expect(Array.isArray(found.filteredPaths)).toBe(true)
    const entry = found.filteredPaths.find((f) => f.path === home)
    expect(entry, 'the home directory should appear with a reason').toBeTruthy()
    expect(typeof entry.reason).toBe('string')
    expect(entry.reason.length).toBeGreaterThan(0)
  })

  it('distinguishes the reasons rather than giving one blanket answer', () => {
    const found = discoverProjects(root, home, [home, root])
    const reasons = new Set(found.filteredPaths.map((f) => f.reason))
    expect(reasons.size).toBeGreaterThan(1)
  })

  it('keeps the count and the list in agreement', () => {
    const found = discoverProjects(root, home, [home, root])
    expect(found.filteredPaths.length).toBe(found.filtered)
  })
})
