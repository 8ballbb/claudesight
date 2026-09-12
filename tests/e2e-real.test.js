import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../src/server/index.js'

// Snapshot of the author's real shape, so this runs anywhere.
let root, handle, base, cookie
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-e2e-'))
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '@NOTES.md\n')
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# RTK\n\nToken killer.\n')
  fs.mkdirSync(path.join(root, 'hooks'))
  fs.writeFileSync(path.join(root, 'hooks/format-hook.sh'), '#!/bin/bash\necho hi\n')
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
    model: 'claude-opus-5',
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `bash ${path.join(root, 'hooks/format-hook.sh')}` }] }] },
  }, null, 2))
  const skill = path.join(root, 'plugins/cache/spyglass/spyglass/0.1.0/skills/spyglass')
  fs.mkdirSync(skill, { recursive: true })
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: spyglass\ndescription: d\n---\n')

  handle = await createServer({ root, distDir: null })
  base = handle.url.split('?')[0].replace(/\/$/, '')
  cookie = (await fetch(handle.url)).headers.getSetCookie().join('; ')
})
afterAll(() => { handle.server.close(); fs.rmSync(root, { recursive: true, force: true }) })

const call = (p, init = {}) => fetch(base + p, {
  ...init,
  headers: { origin: base, cookie, 'content-type': 'application/json', ...(init.headers ?? {}) },
})

describe('phase 1 exit criteria', () => {
  it('shows plugin skills even though ~/.claude/skills does not exist', async () => {
    const inv = await (await call('/api/inventory')).json()
    expect(inv.groups.find((g) => g.kind === 'skill').items).toHaveLength(1)
    expect(inv.sources.find((s) => s.label === 'user').state).toBe('absent')
  })

  it('shows the hook script body as an artifact', async () => {
    const inv = await (await call('/api/inventory')).json()
    expect(inv.groups.find((g) => g.kind === 'scripts').items[0].label).toBe('format-hook.sh')
  })

  it('edits NOTES.md in place and leaves a backup', async () => {
    const inv = await (await call('/api/inventory')).json()
    const rtk = inv.groups.flatMap((g) => g.items).find((i) => i.path.endsWith('NOTES.md'))
    const read = await (await call('/api/read', { method: 'POST', body: JSON.stringify({ id: rtk.id }) })).json()
    const w = await (await call('/api/write', {
      method: 'POST', body: JSON.stringify({ id: rtk.id, content: '# RTK edited\n', etag: read.etag }),
    })).json()
    expect(w.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'NOTES.md'), 'utf8')).toBe('# RTK edited\n')
    expect(fs.existsSync(w.backup)).toBe(true)
  })

  it('refuses a settings.json write when the file changed under us', async () => {
    const inv = await (await call('/api/inventory')).json()
    const st = inv.groups.flatMap((g) => g.items).find((i) => i.path.endsWith('settings.json'))
    const read = await (await call('/api/read', { method: 'POST', body: JSON.stringify({ id: st.id }) })).json()
    fs.writeFileSync(path.join(root, 'settings.json'), '{"model":"claude-sonnet-5"}')
    const w = await (await call('/api/write', {
      method: 'POST', body: JSON.stringify({ id: st.id, content: '{"model":"mine"}', etag: read.etag }),
    })).json()
    expect(w.ok).toBe(false)
    expect(w.error).toBe('conflict')
  })
})
