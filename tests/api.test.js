import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../src/server/index.js'

let root, handle, base
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-api-'))
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '@NOTES.md\n')
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# RTK\n')
  fs.writeFileSync(path.join(root, 'settings.json'), '{"model":"claude-opus-5"}')
  const agentDir = path.join(root, 'plugins/cache/mp/spyglass/0.1.0/agents')
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(path.join(agentDir, 'test-planner.md'),
    '---\nname: test-planner\ndescription: derives test cases\n---\n\nPrompt.\n')
  handle = await createServer({ port: 0, root, distDir: null })
  base = handle.url.split('?')[0].replace(/\/$/, '')
})
afterAll(() => { handle.server.close(); fs.rmSync(root, { recursive: true, force: true }) })

const call = (p, init = {}) => fetch(base + p, {
  ...init,
  headers: { origin: base, 'content-type': 'application/json', ...(init.headers ?? {}) },
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

  // Agents are delivered almost entirely by plugins. A reader that looked only
  // at <root>/agents would report an honest-looking zero on most machines.
  it('serves plugin-delivered agents under their invocable name', async () => {
    const inv = await (await call('/api/inventory')).json()
    const agents = inv.groups.find((g) => g.kind === 'agent')
    expect(agents.items).toHaveLength(1)
    expect(agents.items[0]).toMatchObject({
      label: 'test-planner',
      invocable: 'spyglass:test-planner',
      description: 'derives test cases',
    })
    expect(agents.items[0].writability.class).toBe('redirect')
  })

  it('shows a global hook whose script is missing — the same rule as project scope', async () => {
    // Both drop sites had to change together. If only one had, the app would
    // be honest at one scope and silent at the other.
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
      model: 'claude-opus-5',
      hooks: { PreToolUse: [{ hooks: [{ command: 'bash ~/.claude/hooks/gone.sh' }] }] },
    }))
    const inv = await (await call('/api/inventory')).json()
    const scripts = inv.groups.find((g) => g.kind === 'scripts')
    const broken = scripts.items.filter((i) => i.broken)
    expect(broken).toHaveLength(1)
    expect(broken[0]).toMatchObject({ label: 'gone.sh', state: 'absent' })
    fs.writeFileSync(path.join(root, 'settings.json'), '{"model":"claude-opus-5"}')
  })

  it('gives every item an opaque id, not a path', async () => {
    const inv = await (await call('/api/inventory')).json()
    const ids = inv.groups.flatMap((g) => g.items.map((i) => i.id))
    expect(ids.every((id) => /^[0-9a-f]{16}$/.test(id))).toBe(true)
  })

  // The launch URL carries no secret now, so these are the checks that stop a
  // page on another site from driving this API.
  it('rejects a read that claims another origin', async () => {
    const r = await fetch(base + '/api/inventory', { headers: { origin: 'https://evil.example' } })
    expect(r.status).toBe(403)
  })

  it('rejects a write from another origin', async () => {
    const r = await fetch(base + '/api/write', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'deadbeefdeadbeef', content: 'x' }),
    })
    expect(r.status).toBe(403)
  })

  it('rejects a write a form could send — no application/json, no write', async () => {
    const r = await fetch(base + '/api/write', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'text/plain' },
      body: JSON.stringify({ id: 'deadbeefdeadbeef', content: 'x' }),
    })
    expect(r.status).toBe(415)
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

  it('surfaces a broken @-import instead of dropping it', async () => {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '@NOTES.md\n@GONE.md\n')
    const inv = await (await call('/api/inventory')).json()
    const mem = inv.groups.find((g) => g.kind === 'memory')
    const gone = mem.items.find((i) => i.path.endsWith('GONE.md'))
    expect(gone).toBeTruthy()
    expect(gone.state).toBe('absent')
  })
})
