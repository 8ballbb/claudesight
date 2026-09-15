#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, DEFAULT_PORT } from '../src/server/index.js'
import { resolveRoot } from '../src/server/roots.js'

// macOS only, and said out loud rather than discovered as odd behaviour. The
// paths that differ by platform — the Trash mechanism, filesystem case folding
// — have only ever been exercised on darwin, and this app's whole discipline is
// not asserting things it has not checked.
if (process.platform !== 'darwin') {
  console.error(`claudescope supports macOS only at the moment; this is ${process.platform}.`)
  console.error('Nothing else has been tested, and it reads and writes files you rely on.')
  console.error('Track or request other platforms: https://github.com/8ballbb/claudescope/issues')
  process.exit(1)
}

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
  console.log(`claudescope — reading ${root.path} (${root.source})`)
  console.log(url)
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    // Never silently move: the whole point of a fixed port is that the URL you
    // bookmarked is the URL that works.
    console.error(`Port ${port} is already in use — another copy may be running.`)
    console.error(`Stop it, or choose another: claudescope --port ${port + 1}`)
    process.exit(1)
  }
  throw err
}
