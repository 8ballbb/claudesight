// The bundled schema is data the app trusts; these guard its integrity offline
// (no network). The online drift check — "has SchemaStore synced a newer
// Claude Code version" — runs in CI via `refresh-settings-schema.mjs --check`,
// because a test suite must not depend on the network.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const dir = path.resolve('data')
const schemaPath = path.join(dir, 'claude-code-settings.schema.json')
const metaPath = path.join(dir, 'settings-schema.meta.json')

describe('the bundled settings schema', () => {
  it('is present and parses', () => {
    const s = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
    expect(Object.keys(s.properties ?? {}).length).toBeGreaterThan(100)
  })

  it('carries provenance the app can show', () => {
    const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    expect(m.syncedTo, 'meta must name the Claude Code version it synced to').toMatch(/^v\d+\.\d+\.\d+$/)
    expect(m.source).toContain('schemastore')
    expect(m.license).toBe('Apache-2.0')
    expect(m.fetchedAt).toBeTruthy()
  })

  it('matches the hash recorded in its provenance', () => {
    // If the schema file is edited by hand without re-running the refresh
    // script, the hash drifts from the meta — this catches that, so the two
    // cannot silently disagree.
    const raw = fs.readFileSync(schemaPath, 'utf8')
    const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    const hash = crypto.createHash('sha256').update(raw).digest('hex')
    expect(hash).toBe(m.sha256)
  })

  it('is attributed, as Apache-2.0 requires', () => {
    const notice = fs.readFileSync(path.join(dir, 'ATTRIBUTION.md'), 'utf8')
    expect(notice).toContain('Apache-2.0')
    expect(notice.toLowerCase()).toContain('schemastore')
  })
})
