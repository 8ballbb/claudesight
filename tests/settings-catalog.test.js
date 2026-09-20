// The settings catalogue reads a bundled JSON Schema into per-key detail the
// UI renders: type, allowed values, description, default, and which control to
// show. It advises and never gatekeeps — an unknown key is unknown, not
// invalid, and an out-of-enum value is flagged, not rejected.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSettingsCatalog, classifySettings } from '../src/server/readers/settings-catalog.js'

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
    expect(c.entries.get('permissions').control).toBe('json')
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
