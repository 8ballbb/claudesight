import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../src/server/index.js'

let root, handle, base
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-life-'))
  fs.writeFileSync(path.join(root, 'settings.json'), '{}')
  handle = await createServer({ port: 0, root, distDir: null })
  base = handle.url.replace(/\/$/, '')
})
afterAll(() => {
  try { handle.server.close() } catch { /* already closed */ }
  fs.rmSync(root, { recursive: true, force: true })
})

const call = (p, init = {}) => fetch(base + p, {
  ...init,
  headers: { origin: base, 'content-type': 'application/json', ...(init.headers ?? {}) },
})

describe('/api/ping', () => {
  it('answers, so a page can tell a live server from a dead one', async () => {
    const r = await call('/api/ping')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('runs no readers — it must be cheap enough to poll', async () => {
    // A guard against someone later making this return an inventory.
    const body = await (await call('/api/ping')).json()
    expect(Object.keys(body)).toEqual(['ok'])
  })

  it('is gated like everything else', async () => {
    const r = await call('/api/ping', { headers: { origin: 'https://evil.example' } })
    expect(r.status).toBe(403)
  })
})

describe('/api/quit', () => {
  it('cannot be triggered from another origin', async () => {
    const r = await call('/api/quit', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: '{}',
    })
    expect(r.status).toBe(403)
    // and the server is still up
    expect((await call('/api/ping')).status).toBe(200)
  })

  it('cannot be triggered by a form-shaped POST', async () => {
    const r = await call('/api/quit', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    })
    expect(r.status).toBe(415)
    expect((await call('/api/ping')).status).toBe(200)
  })

  it('is a POST — a link or an <img> must not be able to stop the server', async () => {
    const r = await call('/api/quit')
    expect(r.status).toBe(404)
    expect((await call('/api/ping')).status).toBe(200)
  })
})

describe('the UI reports a server it can no longer reach', () => {
  const src = fs.readFileSync('src/ui/App.jsx', 'utf8')

  it('polls only while the tab is visible', () => {
    expect(src).toContain('if (document.hidden) return')
  })

  it('also reports the loss when a write fails, since a hidden tab never polls', () => {
    expect(src).toContain('onServerLost()')
  })

  it('says when the data on screen was last read', () => {
    expect(src).toContain('setReadAt(new Date())')
    expect(src).toContain('last read')
  })

  it('tells the reader nothing can be saved, and how to get back', () => {
    expect(src).toContain('nothing here can be saved')
    expect(src).toContain('npm start')
  })

  it('freezes the write controls rather than leaving them looking usable', () => {
    expect(src).toContain("frozen={server === 'gone'}")
    expect(fs.readFileSync('src/ui/Editor.jsx', 'utf8')).toContain('const busyOrFrozen = busy || frozen')
  })

  it('does not offer quit on a server that has already gone', () => {
    expect(src).toContain("{server === 'live' && (")
  })
})
