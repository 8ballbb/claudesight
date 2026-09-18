// Which files a reader consulted is reported whatever those files said. The
// two sources here were pushed in sequence with an early return between them,
// so a missing installed_plugins.json also silenced the settings notice: the
// state of one file quietly decided whether the state of another was
// mentioned at all.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readPlugins } from '../src/server/readers/plugins.js'

let root
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-plugsrc-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const labels = (r) => r.sources.map((s) => s.label)
const state = (r, label) => r.sources.find((s) => s.label === label)?.state

describe('readPlugins reports both files it consults', () => {
  it('names settings.json even when installed_plugins.json is absent', () => {
    fs.writeFileSync(path.join(root, 'settings.json'), '{"enabledPlugins":{}}')
    const r = readPlugins(root)
    expect(labels(r)).toContain('settings')
    expect(state(r, 'installed_plugins')).toBe('absent')
    expect(state(r, 'settings')).toBe('ok')
  })

  it('names settings.json as malformed even when there are no plugins to enable', () => {
    fs.writeFileSync(path.join(root, 'settings.json'), '{ not json')
    const r = readPlugins(root)
    expect(state(r, 'settings')).toBe('malformed')
  })
})
