import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// Deleting must stay recoverable outside this app, so nothing here ever
// unlinks a user-facing file as a fallback. If no trash mechanism is
// available the deletion is refused instead.
//
// macOS only, deliberately. There was an XDG implementation here for Linux,
// but it had never once run outside the test suite — `trashMechanism()` only
// returned 'xdg' on linux, and the app has only ever run on darwin. Shipping
// an untested code path as though it were supported is the kind of claim this
// project exists not to make. It survives below as 'folder', named for what it
// actually is: a move into a directory, used by tests so that deleting does
// not litter the real Trash, and the obvious basis for Linux support later.

const MACOS_TRASH = '/usr/bin/trash'

export function trashMechanism(platform = process.platform) {
  if (platform === 'darwin' && fs.existsSync(MACOS_TRASH)) return 'macos-cli'
  return null
}

// A move into <home>/.local/share/Trash, following the XDG layout so that a
// future Linux implementation starts from something already exercised. Reached
// only when a caller asks for it by name.
function folderTrash(target, home) {
  const base = path.join(home, '.local', 'share', 'Trash')
  const filesDir = path.join(base, 'files')
  const infoDir = path.join(base, 'info')
  fs.mkdirSync(filesDir, { recursive: true })
  fs.mkdirSync(infoDir, { recursive: true })

  // The info file is created exclusively; the name it claims is the name the
  // file must take.
  const original = path.basename(target)
  let name = original
  let n = 1
  let infoFd
  for (;;) {
    try {
      infoFd = fs.openSync(path.join(infoDir, `${name}.trashinfo`), 'wx')
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      const ext = path.extname(original)
      name = `${path.basename(original, ext)}.${n++}${ext}`
    }
  }

  const stamp = new Date().toISOString().replace(/\.\d+Z$/, '')
  try {
    fs.writeFileSync(infoFd,
      `[Trash Info]\nPath=${path.resolve(target)}\nDeletionDate=${stamp}\n`)
  } finally {
    fs.closeSync(infoFd)
  }

  const dest = path.join(filesDir, name)
  try {
    fs.renameSync(target, dest)
  } catch (err) {
    if (err.code !== 'EXDEV') {
      fs.rmSync(path.join(infoDir, `${name}.trashinfo`), { force: true })
      throw err
    }
    fs.cpSync(target, dest, { recursive: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
  return dest
}

/**
 * Move a path to the platform trash.
 * Returns { ok: true, mechanism } or { ok: false, error, reason }.
 * Never falls back to an unrecoverable delete.
 */
export function moveToTrash(target, home = os.homedir(), forceMechanism = null) {
  const mechanism = forceMechanism ?? trashMechanism()
  // Anything unrecognised counts as unavailable. Falling through to a
  // best-effort branch is how a "safe delete" quietly becomes a real one.
  if (mechanism !== 'macos-cli' && mechanism !== 'folder') {
    return {
      ok: false,
      error: 'no-trash',
      reason: 'No trash mechanism is available on this platform, so nothing was deleted.',
    }
  }

  try {
    if (mechanism === 'macos-cli') {
      execFileSync(MACOS_TRASH, ['--', target], { stdio: 'ignore', timeout: 15000 })
      // ~/.Trash is not listable under macOS privacy protection, so the
      // source being gone is the confirmation available to us.
      if (fs.existsSync(target)) {
        return { ok: false, error: 'trash-failed', reason: 'The item is still in place after trashing.' }
      }
      return { ok: true, mechanism }
    }
    folderTrash(target, home)
    return { ok: true, mechanism }
  } catch (err) {
    return { ok: false, error: 'trash-failed', reason: err.message ?? String(err) }
  }
}
