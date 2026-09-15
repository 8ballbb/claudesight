import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildInventory } from '../src/server/api.js'
import { SOURCE_NOTE } from '../src/ui/Inventory.jsx'

let root
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-shape-'))
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# memory\n')

  const good = path.join(root, 'plugins/cache/mp/good-plugin/1.0.0')
  fs.mkdirSync(path.join(good, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(good, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'good-plugin', version: '1.0.0' }))

  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(root, 'plugins/installed_plugins.json'), JSON.stringify({
    plugins: {
      // The shape Claude Code writes: a list of instances.
      'good-plugin@mp': [{ installPath: good, version: '1.0.0', scope: 'user' }],
      // The shape a hand edit produces: the instance itself, unwrapped.
      'hand-edited@mp': { installPath: '/nowhere', version: '2.0.0' },
    },
  }))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('an instance list that is not a list', () => {
  it('does not take the whole inventory down with it', () => {
    // It used to throw TypeError out of readPlugins, and the API turned that
    // into a 500 — every artifact on the page gone, not just the plugins.
    const inv = buildInventory(root)
    expect(inv.groups.find((g) => g.kind === 'memory').items.length).toBeGreaterThan(0)
  })

  it('still lists the plugins either side of the bad entry', () => {
    const plugins = buildInventory(root).groups.find((g) => g.kind === 'plugin')
    expect(plugins.items.map((i) => i.label).join(' ')).toContain('good-plugin')
  })

  it('says the entry was skipped instead of dropping it silently', () => {
    const note = buildInventory(root).sources
      .find((s) => s.label.includes('hand-edited@mp'))
    expect(note, 'the skipped entry left no trace').toBeTruthy()
    expect(note.state).toBe('unexpected-shape')
  })

  it('has copy for that state, so the note is a sentence and not a code', () => {
    expect(SOURCE_NOTE['unexpected-shape']).toBeTypeOf('function')
    expect(SOURCE_NOTE['unexpected-shape']('/p/installed_plugins.json'))
      .toMatch(/parsed, but an entry inside it is not the expected shape/)
  })
})
