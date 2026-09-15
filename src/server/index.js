import http from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { createSecurity } from './security.js'
import { buildInventory, buildProjectInventory } from './api.js'
import { discoverProjects } from './discover.js'
import { readForEdit, writeArtifact } from './writer.js'
import { listVersions, createVersion, readVersion, deleteVersion, compareVersion } from './versions.js'
import { createSkill } from './create.js'

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

export const DEFAULT_PORT = 7717

export function createServer({ root, distDir, port: requestedPort = DEFAULT_PORT }) {
  return new Promise((resolve, reject) => {
    let security
    let inventory = null
    const home = os.homedir()
    const projectInventories = new Map()
    const added = new Set()
    let allowed = new Set()

    // An artifact id may belong to the global inventory or to any project
    // opened this session, so every lookup checks both.
    const lookup = (id) => {
      if (!inventory) inventory = buildInventory(root)
      const global = inventory.table.get(id)
      if (global) return global
      for (const inv of projectInventories.values()) {
        const hit = inv.table.get(id)
        if (hit) return hit
      }
      return null
    }

    const server = http.createServer(async (req, res) => {
      try {
        const headers = security.cspHeaders()
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)

        const port = server.address().port
        if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { error: 'host' })

        const url = new URL(req.url, `http://127.0.0.1:${port}`)

        const verdict = security.check(req)
        if (!verdict.ok) return json(res, verdict.status, { error: verdict.reason })

        if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
          res.writeHead(200, { 'content-type': 'text/html' })
          let index = '<!doctype html><title>claudesight</title><p>Run <code>npm run build</code>.</p>'
          if (distDir) { try { index = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8') } catch { /* fall back */ } }
          return res.end(index)
        }

        // Cheap enough to poll: no readers run, nothing is walked. The UI uses
        // it to notice the server is gone rather than showing an inventory it
        // can no longer verify.
        if (url.pathname === '/api/ping') {
          return json(res, 200, { ok: true })
        }

        // Stopping a local tool you started should not require finding the
        // terminal you started it in. Behind the same Origin/Host/JSON gate as
        // every write, so a page on another site cannot reach it.
        if (url.pathname === '/api/quit' && req.method === 'POST') {
          json(res, 200, { ok: true, stopping: true })
          // Let the response flush before the process goes.
          res.on('finish', () => {
            server.close()
            setTimeout(() => process.exit(0), 50)
          })
          return undefined
        }

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
          const entry = lookup(id)
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
          const entry = lookup(body.id)
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

        if (url.pathname === '/api/projects' && req.method === 'GET') {
          const found = discoverProjects(root, home, [...added])
          // Only paths that came out of discovery, or were explicitly added,
          // may be inventoried — otherwise a crafted request is an
          // arbitrary-directory read primitive.
          allowed = new Set(found.projects.map((p) => p.path))
          return json(res, 200, found)
        }

        if (url.pathname === '/api/projects/add' && req.method === 'POST') {
          const body = await parseBody(req)
          if (body === null) return json(res, 400, { error: 'invalid-json' })
          const dir = path.resolve(String(body.path ?? ''))
          let stat
          try { stat = fs.statSync(dir) } catch { stat = null }
          if (!stat || !stat.isDirectory()) {
            return json(res, 404, { ok: false, error: 'not-a-directory', reason: `${dir} is not a directory.` })
          }
          added.add(dir)
          const found = discoverProjects(root, home, [...added])
          allowed = new Set(found.projects.map((p) => p.path))
          return json(res, 200, { ok: true, ...found })
        }

        if (url.pathname === '/api/project-inventory' && req.method === 'POST') {
          const body = await parseBody(req)
          if (body === null) return json(res, 400, { error: 'invalid-json' })
          const dir = path.resolve(String(body.path ?? ''))
          if (!allowed.has(dir)) {
            return json(res, 403, { error: 'not-discovered', reason: 'Open this project from the list first.' })
          }
          const built = buildProjectInventory(dir)
          projectInventories.set(dir, built)
          // `table` holds absolute paths and is server-only lookup state.
          // eslint-disable-next-line no-unused-vars
          const { table, ...safe } = built
          return json(res, 200, safe)
        }

        if (url.pathname === '/api/create' && req.method === 'POST') {
          const body = await parseBody(req)
          if (body === null) return json(res, 400, { error: 'invalid-json' })
          if (body.kind !== 'skill') {
            return json(res, 400, {
              ok: false,
              error: 'unsupported-kind',
              reason: 'Only skills can be created in this version.',
            })
          }
          const made = createSkill({ root, name: body.name, description: body.description })
          if (!made.ok) return json(res, 409, made)

          // The scaffold is the one state that cannot be reconstructed once
          // it has been edited, so it becomes the first restore point.
          createVersion(made.path, 'created')

          inventory = buildInventory(root)
          const found = [...inventory.table.entries()].find(([, e]) => e.path === made.path)
          return json(res, 200, { ...made, id: found ? found[0] : null })
        }

        // ── versions ──────────────────────────────────────────────────────
        // Explicit restore points. Metadata only over the wire; content is
        // never listed, only restored.
        if (url.pathname.startsWith('/api/versions') && req.method === 'POST') {
          const body = await parseBody(req)
          if (body === null) return json(res, 400, { error: 'invalid-json' })
          const entry = lookup(body.id)
          if (!entry) return json(res, 404, { error: 'unknown id' })

          if (url.pathname === '/api/versions') {
            return json(res, 200, { versions: listVersions(entry.path) })
          }

          if (url.pathname === '/api/versions/create') {
            const r = createVersion(entry.path, body.label)
            return json(res, r.ok ? 200 : 409, r)
          }

          if (url.pathname === '/api/versions/diff') {
            const d = compareVersion(entry.path, String(body.versionId ?? ''))
            return json(res, 200, { ok: true, ...d })
          }

          if (url.pathname === '/api/versions/delete') {
            const r = deleteVersion(entry.path, body.versionId)
            return json(res, r.ok ? 200 : 404, r)
          }

          if (url.pathname === '/api/versions/restore') {
            const content = readVersion(entry.path, body.versionId)
            if (content === null) return json(res, 404, { error: 'unknown-version' })

            // The inventory is a scan-time snapshot; the file may be gone.
            let live
            try {
              live = readForEdit(entry.path)
            } catch {
              return json(res, 409, {
                ok: false,
                error: 'missing',
                reason: 'That file no longer exists. Reload to rescan.',
              })
            }
            if (live.content === content) {
              return json(res, 200, { ok: true, unchanged: true })
            }

            // Restoring is a write like any other: classification, validation
            // and the executable-value confirmation all still apply, so a
            // rollback cannot be used to slip past the gate.
            const result = writeArtifact({
              target: entry.path,
              content,
              etag: live.etag,
              kind: entry.kind,
              root,
              confirmToken: body.confirmToken,
            })
            return json(res, result.ok ? 200 : 409, result)
          }

          return json(res, 404, { error: 'not found' })
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
    // A fixed port by default, so the URL you bookmark survives a restart.
    // 0 asks the OS for an ephemeral one, which is what the tests want.
    server.listen(requestedPort, '127.0.0.1', () => {
      const { port } = server.address()
      security = createSecurity({ port })
      resolve({ server, security, url: `http://127.0.0.1:${port}/` })
    })
  })
}
