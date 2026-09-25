// The settings catalogue reads a bundled JSON Schema into per-key detail the
// UI renders: type, allowed values, description, default, and which control to
// show. It advises and never gatekeeps — an unknown key is unknown, not
// invalid, and an out-of-enum value is flagged, not rejected.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSettingsCatalog, classifySettings, readSettingFields } from '../src/server/readers/settings-catalog.js'

let dir
const schema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: true,
  $defs: { rule: { type: 'string' } },
  properties: {
    autoUpdatesChannel: { type: 'string', enum: ['stable', 'latest'], default: 'latest', description: 'Release channel.' },
    cleanupPeriodDays: { type: 'integer', minimum: 1, default: 30, description: 'Days to retain.' },
    autoMemoryEnabled: { type: 'boolean', description: 'Toggle auto memory.' },
    model: { type: 'string', description: 'Override the model.' },
    permissions: { type: 'object', properties: { allow: { type: 'array', items: { $ref: '#/$defs/rule' } } }, description: 'Permission rules.' },
    legacyThing: { type: 'string', deprecated: true, description: 'Old.' },
  },
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-cat-'))
  fs.writeFileSync(path.join(dir, 'claude-code-settings.schema.json'), JSON.stringify(schema))
  fs.writeFileSync(path.join(dir, 'settings-schema.meta.json'), JSON.stringify({ syncedTo: 'v2.1.220', fetchedAt: '2026-09-20T00:00:00Z' }))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('readSettingsCatalog', () => {
  it('reads every documented key', () => {
    const c = readSettingsCatalog(dir)
    expect(c.state).toBe('ok')
    expect(c.keys).toContain('autoUpdatesChannel')
    expect(c.keys).not.toContain('$schema')
  })

  it('picks a control per value shape', () => {
    const c = readSettingsCatalog(dir)
    expect(c.entries.get('autoUpdatesChannel').control).toBe('enum')
    expect(c.entries.get('cleanupPeriodDays').control).toBe('number')
    expect(c.entries.get('autoMemoryEnabled').control).toBe('boolean')
    expect(c.entries.get('model').control).toBe('string')
    expect(c.entries.get('permissions').control).toBe('object') // was json; now a one-level form
  })

  it('carries allowed values, default, range and description', () => {
    const e = readSettingsCatalog(dir).entries.get('autoUpdatesChannel')
    expect(e.enum).toEqual(['stable', 'latest'])
    expect(e.default).toBe('latest')
    expect(e.description).toMatch(/channel/i)
    expect(readSettingsCatalog(dir).entries.get('cleanupPeriodDays').min).toBe(1)
  })

  it('marks a deprecated setting', () => {
    expect(readSettingsCatalog(dir).entries.get('legacyThing').deprecated).toBe(true)
  })

  it('surfaces provenance so staleness can be stated', () => {
    expect(readSettingsCatalog(dir).provenance.syncedTo).toBe('v2.1.220')
  })

  it('reports absent, not empty, when the bundle is missing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-none-'))
    expect(readSettingsCatalog(empty).state).toBe('absent')
    fs.rmSync(empty, { recursive: true, force: true })
  })

  it('reports malformed rather than crashing on a corrupt bundle', () => {
    fs.writeFileSync(path.join(dir, 'claude-code-settings.schema.json'), '{ not json')
    expect(readSettingsCatalog(dir).state).toBe('malformed')
  })
})

describe('classifySettings advises, never gatekeeps', () => {
  it('separates known from unknown keys', () => {
    const c = readSettingsCatalog(dir)
    const r = classifySettings({ model: 'opus', notARealKey: 1 }, c)
    expect(r.known).toEqual(['model'])
    expect(r.unknown).toEqual(['notARealKey'])
  })

  it('flags an out-of-enum value without calling it invalid', () => {
    const c = readSettingsCatalog(dir)
    const r = classifySettings({ autoUpdatesChannel: 'nightly' }, c)
    expect(r.known).toContain('autoUpdatesChannel')
    expect(r.outOfEnum[0]).toMatchObject({ key: 'autoUpdatesChannel', value: 'nightly', allowed: ['stable', 'latest'] })
  })

  it('accepts an in-enum value with no complaint', () => {
    const c = readSettingsCatalog(dir)
    expect(classifySettings({ autoUpdatesChannel: 'stable' }, c).outOfEnum).toEqual([])
  })
})

describe('the real bundled schema', () => {
  it('parses and carries the keys users actually ask about', () => {
    const c = readSettingsCatalog() // default dir = the shipped data/
    expect(c.state).toBe('ok')
    expect(c.keys.length).toBeGreaterThan(100)
    for (const k of ['cleanupPeriodDays', 'permissions', 'statusLine', 'model', 'hooks']) {
      expect(c.keys, `catalogue should know ${k}`).toContain(k)
    }
    expect(c.provenance.syncedTo).toMatch(/^v\d/)
  })
})

describe('composite controls — list, map, one-level object', () => {
  let d
  const compositeSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    $defs: { rule: { type: 'string' } },
    properties: {
      excludes: { type: 'array', items: { type: 'string' }, description: 'A list of strings.' },
      channels: { type: 'array', items: { enum: ['stable', 'latest'] } },
      overrides: { type: 'object', additionalProperties: { type: 'string' }, description: 'A map.' },
      attribution: {
        type: 'object',
        properties: { commit: { type: 'boolean' }, pullRequest: { type: 'boolean' } },
        description: 'A small object of scalars.',
      },
      permissions: {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { $ref: '#/$defs/rule' } },
          defaultMode: { enum: ['default', 'plan'] },
        },
      },
      // deep: an object with a nested object field — must stay json.
      sandbox: {
        type: 'object',
        properties: { filesystem: { type: 'object', properties: { allowRead: { type: 'array', items: { type: 'string' } } } } },
      },
      // an array of objects — must stay json.
      servers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
    },
  }
  beforeEach(() => {
    d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-comp-'))
    fs.writeFileSync(path.join(d, 'claude-code-settings.schema.json'), JSON.stringify(compositeSchema))
  })
  afterEach(() => fs.rmSync(d, { recursive: true, force: true }))

  const cat = () => readSettingsCatalog(d)

  it('renders a list for an array of scalars, carrying the item control', () => {
    const e = cat().entries.get('excludes')
    expect(e.control).toBe('list')
    expect(e.item.control).toBe('string')
  })

  it('carries item enum values for a list of enums', () => {
    expect(cat().entries.get('channels').item).toMatchObject({ control: 'enum', enum: ['stable', 'latest'] })
  })

  it('renders a map for a string→string object', () => {
    expect(cat().entries.get('overrides').control).toBe('map')
  })

  it('renders a one-level object of scalars with its fields', () => {
    const e = cat().entries.get('attribution')
    expect(e.control).toBe('object')
    expect(e.fields.map((f) => `${f.key}:${f.control}`)).toEqual(['commit:boolean', 'pullRequest:boolean'])
  })

  it('renders permissions as an object whose fields are lists and enums', () => {
    const e = cat().entries.get('permissions')
    expect(e.control).toBe('object')
    const byKey = Object.fromEntries(e.fields.map((f) => [f.key, f.control]))
    expect(byKey).toEqual({ allow: 'list', defaultMode: 'enum' })
  })

  it('keeps an object-inside-object as json, never recursing composites', () => {
    expect(cat().entries.get('sandbox').control).toBe('json')
  })

  it('keeps an array of objects as json', () => {
    expect(cat().entries.get('servers').control).toBe('json')
  })
})

describe('env — a documented string map', () => {
  let d
  const envSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        properties: {
          ANTHROPIC_API_KEY: { type: 'string', description: 'API key.' },
          DISABLE_TELEMETRY: { type: 'string', description: 'Turn off telemetry.' },
        },
      },
      // a plain string map (no fixed keys) stays 'map', not 'envmap'
      overrides: { type: 'object', additionalProperties: { type: 'string' } },
    },
  }
  beforeEach(() => {
    d = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-env-'))
    fs.writeFileSync(path.join(d, 'claude-code-settings.schema.json'), JSON.stringify(envSchema))
  })
  afterEach(() => fs.rmSync(d, { recursive: true, force: true }))

  it('classifies a documented string map as envmap', () => {
    expect(readSettingsCatalog(d).entries.get('env').control).toBe('envmap')
  })
  it('leaves a keyless string map as a plain map', () => {
    expect(readSettingsCatalog(d).entries.get('overrides').control).toBe('map')
  })
  it('serves the documented sub-keys on demand, with descriptions', () => {
    const r = readSettingFields('env', d)
    expect(r.state).toBe('ok')
    expect(r.fields.map((f) => f.key)).toEqual(['ANTHROPIC_API_KEY', 'DISABLE_TELEMETRY'])
    expect(r.fields[0].description).toBe('API key.')
  })
  it('returns absent for a key that is not a documented map', () => {
    expect(readSettingFields('overrides', d).state).toBe('absent')
    expect(readSettingFields('nope', d).state).toBe('absent')
  })
})
