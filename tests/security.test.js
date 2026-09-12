import { describe, it, expect, beforeEach } from 'vitest'
import { createSecurity } from '../src/server/security.js'

let sec, cookie
const PORT = 51234
const ORIGIN = `http://127.0.0.1:${PORT}`

beforeEach(() => {
  sec = createSecurity({ port: PORT })
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v } }
  sec.issueCookie({ url: `/?n=${sec.nonce}` }, res)
  cookie = `atlas=${/atlas=([^;]+)/.exec(res.headers['Set-Cookie'])[1]}`
})

const req = (over = {}) => ({
  method: 'GET',
  ...over,
  headers: { origin: ORIGIN, host: `127.0.0.1:${PORT}`, cookie, ...over.headers },
})

describe('security.check', () => {
  it('the request helper merges header overrides onto the defaults', () => {
    const r = req({ method: 'POST', headers: { 'content-type': 'application/json' } })
    expect(r.headers.origin).toBe(ORIGIN)
    expect(r.headers.host).toBe(`127.0.0.1:${PORT}`)
    expect(r.headers.cookie).toBe(cookie)
    expect(r.headers['content-type']).toBe('application/json')
  })

  it('accepts a well-formed request', () => {
    expect(sec.check(req()).ok).toBe(true)
  })

  it('rejects a GET with no cookie — no read-only carve-out', () => {
    expect(sec.check(req({ headers: { cookie: undefined } })).status).toBe(403)
  })

  it('fails closed when Origin is absent', () => {
    expect(sec.check(req({ headers: { origin: undefined } })).status).toBe(403)
  })

  it('rejects a cross-origin request', () => {
    expect(sec.check(req({ headers: { origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('rejects DNS-rebinding Host values', () => {
    for (const host of [`localhost:${PORT}`, `[::1]:${PORT}`, `127.1:${PORT}`, `127.0.0.1.:${PORT}`]) {
      expect(sec.check(req({ headers: { host } })).status, host).toBe(403)
    }
  })

  it('rejects text/plain JSON-CSRF on POST', () => {
    const r = sec.check(req({ method: 'POST', headers: { 'content-type': 'text/plain' } }))
    expect(r.status).toBe(415)
  })

  it('accepts application/json on POST', () => {
    expect(sec.check(req({ method: 'POST', headers: { 'content-type': 'application/json' } })).ok).toBe(true)
  })

  it('invalidates the nonce after one use', () => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v } }
    const second = sec.issueCookie({ url: `/?n=${sec.nonce}` }, res)
    expect(second).toBe(false)
  })

  it('sets an HttpOnly SameSite=Strict cookie', () => {
    const s = createSecurity({ port: PORT })
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v } }
    s.issueCookie({ url: `/?n=${s.nonce}` }, res)
    expect(res.headers['Set-Cookie']).toMatch(/HttpOnly/)
    expect(res.headers['Set-Cookie']).toMatch(/SameSite=Strict/)
  })

  it('emits a CSP with no unsafe-inline and a no-referrer policy', () => {
    const h = sec.cspHeaders()
    expect(h['Content-Security-Policy']).toContain("default-src 'none'")
    expect(h['Content-Security-Policy']).not.toContain('unsafe-inline')
    expect(h['Referrer-Policy']).toBe('no-referrer')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
  })
})
