import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createSecurity } from './security.js'
import { buildInventory, makeScriptKind } from './api.js'
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

export function createServer({ root, distDir }) {
  return new Promise((resolve, reject) => {
    let security
    let inventory = null

    const server = http.createServer(async (req, res) => {
      const headers = security.cspHeaders()
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)

      const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`)

      if (url.pathname === '/' && url.searchParams.has('n')) {
        if (security.issueCookie(req, res)) {
          res.writeHead(200, { 'content-type': 'text/html' })
          const index = distDir ? fs.readFileSync(path.join(distDir, 'index.html'), 'utf8') : '<!doctype html><title>claude-atlas</title>'
          return res.end(index)
        }
        return json(res, 403, { error: 'bad or used nonce' })
      }

      const verdict = security.check(req)
      if (!verdict.ok) return json(res, verdict.status, { error: verdict.reason })

      if (url.pathname === '/api/inventory') {
        inventory = buildInventory(root)
        const { table, ...safe } = inventory
        return json(res, 200, safe)
      }

      if (url.pathname === '/api/read' && req.method === 'POST') {
        const { id } = JSON.parse(await readBody(req))
        if (!inventory) inventory = buildInventory(root)
        const entry = inventory.table.get(id)
        if (!entry) return json(res, 404, { error: 'unknown id' })
        const { content, etag } = readForEdit(entry.path)
        return json(res, 200, { content, etag, path: entry.path, kind: entry.kind })
      }

      if (url.pathname === '/api/write' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req))
        if (!inventory) inventory = buildInventory(root)
        const entry = inventory.table.get(body.id)
        if (!entry) return json(res, 404, { error: 'unknown id' })
        const result = writeArtifact({
          target: entry.path,
          content: body.content,
          etag: body.etag,
          kind: makeScriptKind(entry.kind),
          root,
          confirmToken: body.confirmToken,
        })
        return json(res, result.ok ? 200 : 409, result)
      }

      if (distDir && req.method === 'GET') {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
        const file = path.join(distDir, rel)
        if (file.startsWith(distDir) && fs.existsSync(file)) {
          res.writeHead(200)
          return res.end(fs.readFileSync(file))
        }
      }
      return json(res, 404, { error: 'not found' })
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      security = createSecurity({ port })
      resolve({ server, security, url: `http://127.0.0.1:${port}/?n=${security.nonce}` })
    })
  })
}
