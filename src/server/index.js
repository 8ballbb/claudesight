import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createSecurity } from './security.js'
import { buildInventory } from './api.js'
import { readForEdit, writeArtifact } from './writer.js'

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

const readBody = (req) => new Promise((resolve, reject) => {
  let data = ''
  req.on('data', (c) => {
    data += c
    if (data.length > 5_000_000) reject(new Error('body too large'))
  })
  req.on('end', () => resolve(data))
  req.on('error', reject)
})

const parseBody = async (req) => { try { return JSON.parse(await readBody(req)) } catch { return null } }

// A plain startsWith(distDir) also matches a sibling directory with distDir as
// a string prefix (e.g. "distDir-evil"). Compare on path segments instead.
const isUnderDir = (child, parent) => {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

export function createServer({ root, distDir }) {
  return new Promise((resolve, reject) => {
    let security
    let inventory = null

    const server = http.createServer(async (req, res) => {
      try {
        const headers = security.cspHeaders()
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)

        const port = server.address().port
        if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { error: 'host' })

        const url = new URL(req.url, `http://127.0.0.1:${port}`)

        if (url.pathname === '/' && url.searchParams.has('n')) {
          if (security.issueCookie(req, res)) {
            res.writeHead(200, { 'content-type': 'text/html' })
            let index = '<!doctype html><title>claude-atlas</title><p>Run <code>npm run build</code>.</p>'
            if (distDir) { try { index = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8') } catch { /* fall back */ } }
            return res.end(index)
          }
          return json(res, 403, { error: 'bad or used nonce' })
        }

        const verdict = security.check(req)
        if (!verdict.ok) return json(res, verdict.status, { error: verdict.reason })

        if (url.pathname === '/api/inventory') {
          inventory = buildInventory(root)
          // `table` is deliberately stripped from the response — it holds absolute
          // filesystem paths and is server-only lookup state, never sent to the client.
          // eslint-disable-next-line no-unused-vars
          const { table, ...safe } = inventory
          return json(res, 200, safe)
        }

        if (url.pathname === '/api/read' && req.method === 'POST') {
          const parsed = await parseBody(req)
          if (parsed === null) return json(res, 400, { error: 'invalid-json' })
          const { id } = parsed
          if (!inventory) inventory = buildInventory(root)
          const entry = inventory.table.get(id)
          if (!entry) return json(res, 404, { error: 'unknown id' })
          // Some artifacts are directories or have vanished since the scan.
          // Say so rather than letting readFileSync throw EISDIR/ENOENT.
          const st = fs.statSync(entry.path, { throwIfNoEntry: false })
          if (!st) return json(res, 404, { error: 'missing', path: entry.path, kind: entry.kind })
          if (!st.isFile()) {
            return json(res, 400, { error: 'not-a-file', path: entry.path, kind: entry.kind })
          }
          const { content, etag } = readForEdit(entry.path)
          return json(res, 200, { content, etag, path: entry.path, kind: entry.kind })
        }

        if (url.pathname === '/api/write' && req.method === 'POST') {
          const body = await parseBody(req)
          if (body === null) return json(res, 400, { error: 'invalid-json' })
          if (!inventory) inventory = buildInventory(root)
          const entry = inventory.table.get(body.id)
          if (!entry) return json(res, 404, { error: 'unknown id' })
          const result = writeArtifact({
            target: entry.path,
            content: body.content,
            etag: body.etag,
            kind: entry.kind,
            root,
            confirmToken: body.confirmToken,
          })
          return json(res, result.ok ? 200 : 409, result)
        }

        if (distDir && req.method === 'GET') {
          const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
          const file = path.join(distDir, rel)
          if (isUnderDir(file, distDir) && fs.existsSync(file)) {
            res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
            return res.end(fs.readFileSync(file))
          }
        }
        return json(res, 404, { error: 'not found' })
      } catch (err) {
        // Never surface err.message — Node embeds input text in parser errors.
        return json(res, 500, { error: 'internal', code: err?.code ?? err?.name ?? 'Error' })
      }
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      security = createSecurity({ port })
      resolve({ server, security, url: `http://127.0.0.1:${port}/?n=${security.nonce}` })
    })
  })
}
