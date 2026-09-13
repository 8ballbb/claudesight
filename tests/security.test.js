import { describe, it, expect, beforeEach } from 'vitest'
import { createSecurity } from '../src/server/security.js'

let sec
const PORT = 51234
const ORIGIN = `http://127.0.0.1:${PORT}`

beforeEach(() => { sec = createSecurity({ port: PORT }) })

const req = (over = {}) => ({
  method: 'GET',
  ...over,
  headers: { origin: ORIGIN, host: `127.0.0.1:${PORT}`, ...over.headers },
})

describe('security.check', () => {
  it('the request helper merges header overrides onto the defaults', () => {
    const r = req({ method: 'POST', headers: { 'content-type': 'application/json' } })
    expect(r.headers.origin).toBe(ORIGIN)
    expect(r.headers.host).toBe(`127.0.0.1:${PORT}`)
    expect(r.headers['content-type']).toBe('application/json')
  })

  it('accepts a well-formed request', () => {
    expect(sec.check(req()).ok).toBe(true)
  })

  // The three checks below are the whole defence. A page on another site can
  // send requests here; each of these is a reason one gets refused.
  it('rejects a cross-origin request', () => {
    expect(sec.check(req({ headers: { origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('rejects a cross-origin write even with a correct Host', () => {
    const r = sec.check(req({
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    }))
    expect(r.status).toBe(403)
  })

  it('rejects DNS-rebinding Host values', () => {
    for (const host of [`localhost:${PORT}`, `[::1]:${PORT}`, `127.1:${PORT}`, `127.0.0.1.:${PORT}`, 'evil.example']) {
      expect(sec.check(req({ headers: { host } })).status, host).toBe(403)
    }
  })

  it('rejects text/plain JSON-CSRF on POST', () => {
    // A form POST is the one shape that reaches us without a CORS preflight,
    // and a form cannot set application/json. Requiring it closes that door.
    expect(sec.check(req({ method: 'POST', headers: { 'content-type': 'text/plain' } })).status).toBe(415)
    expect(sec.check(req({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })).status).toBe(415)
  })

  it('accepts application/json on POST', () => {
    expect(sec.check(req({ method: 'POST', headers: { 'content-type': 'application/json' } })).ok).toBe(true)
  })

  it('allows a same-origin GET with no Origin header, as browsers send', () => {
    expect(sec.check(req({ headers: { origin: undefined } })).ok).toBe(true)
  })

  it('still rejects a POST with no Origin header', () => {
    // Browsers always send Origin on a write; its absence is a non-browser client.
    const r = sec.check(req({ method: 'POST', headers: { origin: undefined, 'content-type': 'application/json' } }))
    expect(r.status).toBe(403)
  })

  it('emits a CSP with no unsafe-inline and a no-referrer policy', () => {
    const h = sec.cspHeaders()
    expect(h['Content-Security-Policy']).toContain("default-src 'none'")
    expect(h['Content-Security-Policy']).not.toContain('unsafe-inline')
    expect(h['Referrer-Policy']).toBe('no-referrer')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
  })

  it('no longer issues or demands a cookie — the URL carries no secret', () => {
    // Deliberate removal: the single-use nonce blocked only non-browser local
    // clients, which can read ~/.claude directly anyway, while making the
    // launch URL one-shot. A plain request with no cookie must now be fine.
    expect(sec.issueCookie).toBeUndefined()
    expect(sec.nonce).toBeUndefined()
    expect(sec.check(req({ headers: { cookie: undefined } })).ok).toBe(true)
  })
})
