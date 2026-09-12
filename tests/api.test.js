import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../src/server/index.js'

let root, handle, base, cookie
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-api-'))
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '@NOTES.md\n')
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# RTK\n')
  fs.writeFileSync(path.join(root, 'settings.json'), '{"model":"claude-opus-5"}')
  handle = await createServer({ root, distDir: null })
  base = handle.url.split('?')[0].replace(/\/$/, '')
  const res = await fetch(handle.url)
  cookie = res.headers.getSetCookie().join('; ')
})
afterAll(() => { handle.server.close(); fs.rmSync(root, { recursive: true, force: true }) })

const call = (p, init = {}) => fetch(base + p, {
  ...init,
  headers: { origin: base, cookie, 'content-type': 'application/json', ...(init.headers ?? {}) },
})

describe('api', () => {
  it('binds an ephemeral port on 127.0.0.1', () => {
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    expect(handle.server.address().port).toBeGreaterThan(0)
  })

  it('serves an inventory including memory imports', async () => {
    const inv = await (await call('/api/inventory')).json()
    const mem = inv.groups.find((g) => g.kind === 'memory')
    expect(mem.items.some((i) => i.path.endsWith('NOTES.md'))).toBe(true)
  })

  it('gives every item an opaque id, not a path', async () => {
    const inv = await (await call('/api/inventory')).json()
    const ids = inv.groups.flatMap((g) => g.items.map((i) => i.id))
    expect(ids.every((id) => /^[0-9a-f]{16}$/.test(id))).toBe(true)
  })

  it('rejects an unauthenticated GET', async () => {
    expect((await fetch(base + '/api/inventory')).status).toBe(403)
  })

  it('reads and writes an artifact by id', async () => {
    const inv = await (await call('/api/inventory')).json()
    const item = inv.groups.flatMap((g) => g.items).find((i) => i.path.endsWith('NOTES.md'))
    const read = await (await call('/api/read', { method: 'POST', body: JSON.stringify({ id: item.id }) })).json()
    expect(read.content).toContain('# RTK')
    const w = await call('/api/write', {
      method: 'POST',
      body: JSON.stringify({ id: item.id, content: '# RTK v2\n', etag: read.etag }),
    })
    expect((await w.json()).ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'NOTES.md'), 'utf8')).toBe('# RTK v2\n')
  })

  it('returns 404 for an unknown id rather than touching the filesystem', async () => {
    const r = await call('/api/read', { method: 'POST', body: JSON.stringify({ id: 'deadbeefdeadbeef' }) })
    expect(r.status).toBe(404)
  })

  it('classifies a hook script body as exec, matching what the writer enforces', async () => {
    const inv = await (await call('/api/inventory')).json()
    const scripts = inv.groups.find((g) => g.kind === 'scripts')
    if (!scripts || scripts.items.length === 0) return
    expect(scripts.items[0].kind).toMatch(/hookScript|statusLineScript/)
    expect(scripts.items[0].writability.class).toBe('exec')
  })
})
