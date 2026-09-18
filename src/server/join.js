import fs from 'node:fs'
import path from 'node:path'
import { readJsonSafe } from './fsread.js'

// Two declarations that point at something that is not there, or that will
// never take effect. Both have the same shape as the broken-hook case: the
// configuration says one thing, the machine does another, and nothing on the
// page joins the two.

// Where an organization deploys settings that individual users cannot override.
// Kept in step with writability.js, which refuses to call these editable.
export const MANAGED_SETTINGS = [
  '/Library/Application Support/ClaudeCode/managed-settings.json',
  '/etc/claude-code/managed-settings.json',
]

// A plugin switched on in settings.json that is not installed. Claude Code has
// nothing to load, and the only trace is a `true` in a file nobody re-reads.
export function danglingPlugins(enabledPlugins, installedIds) {
  if (enabledPlugins === null || typeof enabledPlugins !== 'object' || Array.isArray(enabledPlugins)) return []
  const installed = new Set(installedIds)
  const out = []
  for (const [id, on] of Object.entries(enabledPlugins)) {
    if (on !== true) continue
    if (installed.has(id)) continue
    // Settings name a plugin as `name@marketplace`; be forgiving about a bare
    // name, so a real installation is never reported as missing.
    const bare = String(id).split('@')[0]
    if ([...installed].some((i) => String(i).split('@')[0] === bare)) continue
    out.push(id)
  }
  return out
}

// Keys a managed policy file sets, which silently win over the same key in a
// user or project settings file. Returns null when there is no managed file to
// compare against — "nothing is overridden" and "there is no policy here" are
// different answers, and only one of them is knowable.
export function managedOverrides(userSettings, files = MANAGED_SETTINGS) {
  const present = files.filter((f) => {
    try { return fs.existsSync(f) } catch { return false }
  })
  if (present.length === 0) return null

  const shadowed = []
  for (const file of present) {
    const r = readJsonSafe(file)
    if (r.state !== 'ok') {
      shadowed.push({ file, state: r.state, keys: [] })
      continue
    }
    const managedKeys = Object.keys(r.value ?? {})
    const yours = userSettings && typeof userSettings === 'object' ? Object.keys(userSettings) : []
    shadowed.push({
      file,
      state: 'ok',
      keys: managedKeys.filter((k) => yours.includes(k)),
      allKeys: managedKeys,
    })
  }
  return shadowed
}

// Convenience for the inventory: the managed file paths that actually exist.
export function managedFiles(files = MANAGED_SETTINGS) {
  return files.filter((f) => {
    try { return fs.existsSync(f) && fs.statSync(f).isFile() } catch { return false }
  }).map((f) => path.resolve(f))
}
