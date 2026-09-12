import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { classify } from './writability.js'
import { execChanges } from './execgate.js'

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

// The confirmation token is a receipt for one exact change, not a capability.
// Binding it to (target, content) makes confirm-then-swap impossible: a token
// issued for one body will not validate a different body.
const CONFIRM_SECRET = crypto.randomBytes(32)

function confirmTokenFor(target, content) {
  return crypto
    .createHmac('sha256', CONFIRM_SECRET)
    .update(target)
    .update('\0')
    .update(content)
    .digest('hex')
}

function confirmTokenMatches(supplied, expected) {
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

export function readForEdit(target) {
  const buf = fs.readFileSync(target)
  const st = fs.statSync(target)
  return { content: buf.toString('utf8'), etag: `${st.size}:${hash(buf)}` }
}

function hasSymlinkComponent(target, root) {
  let current = path.resolve(target)
  const stop = path.parse(current).root
  while (current !== stop) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true
    } catch { /* missing components are fine */ }
    if (current === path.resolve(root)) break
    current = path.dirname(current)
  }
  return false
}

function backupBeside(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = `${target}.atlas-${stamp}.bak`
  const fd = fs.openSync(dest, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, fs.readFileSync(target))
    const mode = fs.fstatSync(fd).mode & 0o777
    if (mode !== 0o600) throw new Error(`backup mode ${mode.toString(8)} !== 600`)
  } finally {
    fs.closeSync(fd)
  }
  return dest
}

export function writeArtifact({ target, content, etag, kind, root, confirmToken }) {
  const verdict = classify({ path: target, kind, root })
  if (verdict.class === 'readonly') return { ok: false, error: 'readonly', reason: verdict.reason }
  if (verdict.class === 'redirect') {
    return { ok: false, error: 'redirect', reason: verdict.reason, redirectTo: verdict.redirectTo }
  }
  if (verdict.class === 'guarded') {
    const expected = confirmTokenFor(target, content)
    if (!confirmTokenMatches(confirmToken, expected)) {
      return { ok: false, error: 'guarded', reason: verdict.reason, confirmToken: expected }
    }
  }
  if (hasSymlinkComponent(target, root)) {
    return { ok: false, error: 'symlink', reason: 'Path contains a symlink; refusing to write through it' }
  }

  // An exec-class target IS the executable — its whole body is the command,
  // so it needs the same confirmation a command-bearing settings key does.
  if (verdict.class === 'exec') {
    let previous = null
    try { previous = fs.readFileSync(target, 'utf8') } catch { /* new file */ }
    if (previous !== content) {
      const expected = confirmTokenFor(target, content)
      if (!confirmTokenMatches(confirmToken, expected)) {
        return {
          ok: false,
          error: 'confirmation_required',
          changes: [{
            keyPath: path.basename(target),
            before: previous,
            after: content,
            reason: 'executable-file-body',
          }],
          confirmToken: expected,
        }
      }
    }
  }

  let parsedAfter = null
  if (target.endsWith('.json')) {
    try {
      parsedAfter = JSON.parse(content)
    } catch {
      return { ok: false, error: 'invalid-json', reason: 'Claude Code silently ignores malformed settings' }
    }
  }

  if (parsedAfter !== null) {
    let parsedBefore = {}
    try { parsedBefore = JSON.parse(fs.readFileSync(target, 'utf8')) } catch { /* treat as empty */ }
    const changes = execChanges(parsedBefore, parsedAfter)
    if (changes.length > 0) {
      const expected = confirmTokenFor(target, content)
      if (!confirmTokenMatches(confirmToken, expected)) {
        return { ok: false, error: 'confirmation_required', changes, confirmToken: expected }
      }
    }
  }

  const lock = `${target}.atlas-lock`
  let lockFd
  try {
    lockFd = fs.openSync(lock, 'wx')
  } catch (err) {
    if (err.code === 'EEXIST') return { ok: false, error: 'locked', reason: 'Another write is in progress' }
    throw err
  }

  try {
    const current = fs.readFileSync(target)
    const st = fs.statSync(target)
    if (`${st.size}:${hash(current)}` !== etag) {
      return { ok: false, error: 'conflict', reason: 'File changed on disk since you opened it' }
    }

    const backup = backupBeside(target)
    const tmp = path.join(path.dirname(target), `.atlas-tmp-${process.pid}-${Date.now()}`)
    const tmpFd = fs.openSync(tmp, 'wx', st.mode & 0o777)
    try {
      fs.writeFileSync(tmpFd, content)
      fs.fsyncSync(tmpFd)
    } finally {
      fs.closeSync(tmpFd)
    }

    // Re-check immediately before rename to narrow the window further.
    const recheck = fs.readFileSync(target)
    if (hash(recheck) !== hash(current)) {
      fs.rmSync(tmp, { force: true })
      return { ok: false, error: 'conflict', reason: 'File changed while the write was being prepared' }
    }

    fs.renameSync(tmp, target)
    return { ok: true, backup }
  } finally {
    fs.closeSync(lockFd)
    fs.rmSync(lock, { force: true })
  }
}
