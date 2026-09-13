// What actually stops a hostile web page from driving this API.
//
// A page on any site can SEND requests to 127.0.0.1 — localhost is not a
// boundary against your own browser — so the API has to refuse them. Three
// checks do that, and none of them needs a secret in the URL:
//
//   Origin   A cross-origin request carries the attacker's Origin, which is
//            not ours, so it is refused. Browsers always set it on writes,
//            so its absence on a write means a non-browser client.
//   Host     DNS rebinding points a hostile domain at 127.0.0.1 to fake
//            same-origin. The Host header still says that domain, not ours.
//   JSON     A form POST — the one shape that skips CORS preflight entirely —
//            cannot set application/json. Requiring it forces any other
//            attempt through a preflight this server never answers.
//
// There was a fourth: a single-use nonce in the launch URL, exchanged for a
// cookie. It added nothing the three above do not already cover — its only
// distinct effect was blocking non-browser local clients, and any process
// running as you can read ~/.claude directly anyway. What it did do was make
// the link one-shot, which locked the author out of their own running server.
// Removed deliberately; see the spec's security section.
export function createSecurity({ port }) {
  const expectedOrigin = `http://127.0.0.1:${port}`
  const expectedHost = `127.0.0.1:${port}`

  return {
    check(req) {
      const h = req.headers ?? {}
      const isSafeMethod = req.method === 'GET' || req.method === 'HEAD'

      if (h.origin !== undefined) {
        if (h.origin !== expectedOrigin) return { ok: false, status: 403, reason: 'origin' }
      } else if (!isSafeMethod) {
        return { ok: false, status: 403, reason: 'origin' }
      }
      if (h.host !== expectedHost) {
        return { ok: false, status: 403, reason: 'host' }
      }
      if (!isSafeMethod) {
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
