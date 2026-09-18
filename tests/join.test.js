// A declaration pointing at something absent, and a setting that will never
// take effect. Both are the broken-hook shape applied elsewhere: the config
// says one thing and the machine does another, with nothing joining the two.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { danglingPlugins, managedOverrides } from '../src/server/join.js'

let tmp
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-join-'))) })
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('a plugin switched on but not installed', () => {
  it('is reported', () => {
    expect(danglingPlugins({ 'ghost@market': true }, ['real@market'])).toEqual(['ghost@market'])
  })

  it('is not reported when it is installed', () => {
    expect(danglingPlugins({ 'real@market': true }, ['real@market'])).toEqual([])
  })

  it('ignores one that is switched off — it is not meant to load', () => {
    expect(danglingPlugins({ 'ghost@market': false }, [])).toEqual([])
  })

  it('does not call a plugin missing over a marketplace suffix mismatch', () => {
    expect(danglingPlugins({ thing: true }, ['thing@somewhere'])).toEqual([])
  })

  it('survives a settings file where enabledPlugins is not an object', () => {
    expect(danglingPlugins('nonsense', [])).toEqual([])
    expect(danglingPlugins(null, [])).toEqual([])
  })
})

describe('settings overridden by managed policy', () => {
  const managedAt = (body) => {
    const f = path.join(tmp, 'managed-settings.json')
    fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body))
    return [f]
  }

  it('answers null when there is no policy file, not "nothing is overridden"', () => {
    expect(managedOverrides({ model: 'opus' }, [path.join(tmp, 'absent.json')])).toBe(null)
  })

  it('names the keys of yours that a policy overrides', () => {
    const files = managedAt({ model: 'sonnet', env: {} })
    const [r] = managedOverrides({ model: 'opus', other: 1 }, files)
    expect(r.keys).toEqual(['model'])
  })

  it('reports no overlap as an empty list, which is a real answer', () => {
    const files = managedAt({ forceLoginMethod: 'sso' })
    const [r] = managedOverrides({ model: 'opus' }, files)
    expect(r.keys).toEqual([])
    expect(r.state).toBe('ok')
  })

  it('keeps an unreadable policy file distinguishable from an empty one', () => {
    const files = managedAt('{ not json')
    const [r] = managedOverrides({ model: 'opus' }, files)
    expect(r.state).toBe('malformed')
  })
})

describe('the joins reach the inventory', () => {
  it('reports a plugin enabled in settings but not installed', async () => {
    const { buildInventory } = await import('../src/server/api.js')
    const root = path.join(tmp, '.claude')
    fs.mkdirSync(path.join(root, 'plugins'), { recursive: true })
    fs.writeFileSync(path.join(root, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'ghost@market': true } }))
    fs.writeFileSync(path.join(root, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: {} }))
    const inv = buildInventory(root)
    expect(inv.joins.danglingPlugins).toEqual(['ghost@market'])
  })

  it('reports nothing dangling when the plugin really is installed', async () => {
    const { buildInventory } = await import('../src/server/api.js')
    const root = path.join(tmp, '.claude2')
    const cache = path.join(root, 'plugins', 'cache', 'market', 'real', '1.0.0', '.claude-plugin')
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(path.join(cache, 'plugin.json'), JSON.stringify({ name: 'real', version: '1.0.0' }))
    fs.writeFileSync(path.join(root, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'real@market': true } }))
    fs.writeFileSync(path.join(root, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'real@market': [{ version: '1.0.0', installPath: path.join(root, 'plugins', 'cache', 'market', 'real', '1.0.0') }] } }))
    const inv = buildInventory(root)
    expect(inv.joins.danglingPlugins).toEqual([])
  })
})
