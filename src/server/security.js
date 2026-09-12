import crypto from 'node:crypto'

export function createSecurity({ port }) {
  const nonce = crypto.randomBytes(24).toString('hex')
  const token = crypto.randomBytes(32).toString('hex')
  let nonceUsed = false

  const expectedOrigin = `http://127.0.0.1:${port}`
  const expectedHost = `127.0.0.1:${port}`

  return {
    nonce,

    // Single-use nonce -> HttpOnly cookie. The token never appears in a URL,
    // so it cannot leak via Referer, ps argv, or terminal scrollback. Spec §9.2.
    issueCookie(req, res) {
      const supplied = new URL(req.url, expectedOrigin).searchParams.get('n')
      if (nonceUsed || supplied !== nonce) return false
      nonceUsed = true
      res.setHeader('Set-Cookie',
        `atlas=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`)
      return true
    },

    check(req) {
      const h = req.headers ?? {}

      if (h.origin !== expectedOrigin) {
        return { ok: false, status: 403, reason: 'origin' }
      }
      if (h.host !== expectedHost) {
        return { ok: false, status: 403, reason: 'host' }
      }
      const supplied = /(?:^|;\s*)atlas=([^;]+)/.exec(h.cookie ?? '')?.[1]
      if (!supplied || supplied.length !== token.length) {
        return { ok: false, status: 403, reason: 'token' }
      }
      if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
        return { ok: false, status: 403, reason: 'token' }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (!/^application\/json\s*(;|$)/.test(h['content-type'] ?? '')) {
          return { ok: false, status: 415, reason: 'content-type' }
        }
      }
      return { ok: true }
    },

    cspHeaders() {
      return {
        'Content-Security-Policy': [
          "default-src 'none'", "script-src 'self'", "style-src 'self'",
          "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'",
          "object-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
        ].join('; '),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      }
    },
  }
}
