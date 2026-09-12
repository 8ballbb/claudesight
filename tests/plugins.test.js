import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readPlugins } from '../src/server/readers/plugins.js'

let root
const installPlugin = (id, dirVersion, manifestVersion) => {
  const [name, marketplace] = id.split('@')
  const p = path.join(root, 'plugins/cache', marketplace, name, dirVersion)
  fs.mkdirSync(path.join(p, '.claude-plugin'), { recursive: true })
  if (manifestVersion !== null) {
    fs.writeFileSync(path.join(p, '.claude-plugin/plugin.json'),
      JSON.stringify({ name, version: manifestVersion, repository: `https://github.com/x/${name}` }))
  }
  return p
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-plugins-'))
  const a = installPlugin('spyglass@spyglass', '0.1.0', '0.3.3')     // genuine drift
  const b = installPlugin('superpowers@official', '6.3.0', '6.3.0')  // in sync
  const c = installPlugin('feature-dev@official', 'unknown', null)   // no recorded version
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(root, 'plugins/installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'spyglass@spyglass': [{ scope: 'user', installPath: a, version: '0.1.0' }],
      'superpowers@official': [{ scope: 'user', installPath: b, version: '6.3.0' }],
      'feature-dev@official': [{ scope: 'user', installPath: c, version: 'unknown' }],
    },
  }))
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
    enabledPlugins: { 'spyglass@spyglass': true, 'superpowers@official': true },
  }))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('readPlugins', () => {
  it('classifies genuine drift', () => {
    const p = readPlugins(root).plugins.find((x) => x.name === 'spyglass')
    expect(p.drift).toBe('drifted')
    expect(p.recordedVersion).toBe('0.1.0')
    expect(p.manifestVersion).toBe('0.3.3')
  })

  it('distinguishes a missing version from drift — they are not the same condition', () => {
    expect(readPlugins(root).plugins.find((x) => x.name === 'feature-dev').drift).toBe('unknown-version')
  })

  it('reports in-sync plugins as none', () => {
    expect(readPlugins(root).plugins.find((x) => x.name === 'superpowers').drift).toBe('none')
  })

  it('counts exactly one drifted plugin, not three', () => {
    expect(readPlugins(root).plugins.filter((p) => p.drift === 'drifted')).toHaveLength(1)
  })

  it('reflects enabled state from settings.json', () => {
    const byName = Object.fromEntries(readPlugins(root).plugins.map((p) => [p.name, p.enabled]))
    expect(byName.spyglass).toBe(true)
    expect(byName['feature-dev']).toBe(false)
  })

  it('distinguishes a corrupt manifest from an absent one', () => {
    const mk = (name, body) => {
      const p = path.join(root, 'plugins/cache/mk', name, '1.0.0')
      fs.mkdirSync(path.join(p, '.claude-plugin'), { recursive: true })
      if (body !== null) fs.writeFileSync(path.join(p, '.claude-plugin/plugin.json'), body)
      return p
    }
    const broken = mk('broken', '{ oops not json')
    const missing = mk('missing', null)
    const ipPath = path.join(root, 'plugins/installed_plugins.json')
    const ip = JSON.parse(fs.readFileSync(ipPath, 'utf8'))
    ip.plugins['broken@mk'] = [{ scope: 'user', installPath: broken, version: '1.0.0' }]
    ip.plugins['missing@mk'] = [{ scope: 'user', installPath: missing, version: '1.0.0' }]
    fs.writeFileSync(ipPath, JSON.stringify(ip))

    const byName = Object.fromEntries(readPlugins(root).plugins.map((p) => [p.name, p]))
    expect(byName.broken.manifestState).toBe('malformed')
    expect(byName.missing.manifestState).toBe('absent')
    expect(byName.broken.manifestState).not.toBe(byName.missing.manifestState)
  })

  it('reports settings.json in sources', () => {
    const s = readPlugins(root).sources.find((x) => x.label === 'settings')
    expect(s).toBeTruthy()
    expect(s.state).toBe('ok')
  })

  it('does not present a malformed settings.json as all-plugins-disabled without saying so', () => {
    const sPath = path.join(root, 'settings.json')
    const saved = fs.readFileSync(sPath, 'utf8')
    try {
      fs.writeFileSync(sPath, '{ broken')
      const r = readPlugins(root)
      expect(r.plugins.every((p) => p.enabled === false)).toBe(true)
      expect(r.sources.find((x) => x.label === 'settings').state).toBe('malformed')
    } finally {
      fs.writeFileSync(sPath, saved)
    }
  })

  it('carries the install scope', () => {
    expect(readPlugins(root).plugins.every((p) => p.scope === 'user')).toBe(true)
  })
})
