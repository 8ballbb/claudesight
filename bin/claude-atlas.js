#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '../src/server/index.js'
import { resolveRoot } from '../src/server/roots.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = resolveRoot(process.env)

try {
  const { url } = await createServer({ root: root.path, distDir: path.join(here, '..', 'dist') })
  console.log(`claude-atlas — reading ${root.path} (${root.source})`)
  console.log(url)
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error('Could not bind a local port. Refusing to fall back — see spec §9.1.')
    process.exit(1)
  }
  throw err
}
