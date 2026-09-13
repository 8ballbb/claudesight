#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, DEFAULT_PORT } from '../src/server/index.js'
import { resolveRoot } from '../src/server/roots.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = resolveRoot(process.env)

const flag = process.argv.indexOf('--port')
const port = flag === -1 ? DEFAULT_PORT : Number(process.argv[flag + 1])
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`--port needs a number between 0 and 65535, got "${process.argv[flag + 1]}".`)
  process.exit(1)
}

try {
  const { url } = await createServer({ root: root.path, port, distDir: path.join(here, '..', 'dist') })
  console.log(`claude-atlas — reading ${root.path} (${root.source})`)
  console.log(url)
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    // Never silently move: the whole point of a fixed port is that the URL you
    // bookmarked is the URL that works.
    console.error(`Port ${port} is already in use — another copy may be running.`)
    console.error(`Stop it, or choose another: claude-atlas --port ${port + 1}`)
    process.exit(1)
  }
  throw err
}
