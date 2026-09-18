import path from 'node:path'
import { readJsonSafe } from '../fsread.js'

export function readPlugins(root) {
  const installedPath = path.join(root, 'plugins', 'installed_plugins.json')
  const installed = readJsonSafe(installedPath)
  const settingsPath = path.join(root, 'settings.json')
  const settings = readJsonSafe(settingsPath)
  // Both files are named whatever either one says. These used to be pushed
  // either side of the early return below, so an absent installed_plugins.json
  // also silenced the settings notice — one file's state deciding whether
  // another file's state was mentioned at all.
  const sources = [
    { label: 'installed_plugins', dir: installedPath, state: installed.state },
    { label: 'settings', dir: settingsPath, state: settings.state },
  ]
  if (installed.state !== 'ok') return { plugins: [], sources }
  const enabledMap = settings.state === 'ok' ? (settings.value.enabledPlugins ?? {}) : {}

  const plugins = []
  for (const [id, instances] of Object.entries(installed.value.plugins ?? {})) {
    // Every instance list is an array in a file Claude Code wrote. A file
    // somebody edited by hand may hold an object here, and iterating it threw
    // a TypeError out of the reader — which emptied the ENTIRE inventory page,
    // not just the plugin list. Skip the entry and say so; one unreadable
    // plugin must not take the other artifacts down with it.
    if (!Array.isArray(instances)) {
      sources.push({ label: `installed_plugins → ${id}`, dir: installedPath, state: 'unexpected-shape' })
      continue
    }
    for (const inst of instances) {
      const [name, marketplace] = id.split('@')
      const manifestPath = path.join(inst.installPath, '.claude-plugin', 'plugin.json')
      const manifest = readJsonSafe(manifestPath)
      const manifestVersion = manifest.state === 'ok' ? (manifest.value.version ?? null) : null
      // 'ok' here means the file parsed; a parsed manifest with no version field
      // is still 'ok' — manifestVersion being null is what says it lacked one.
      const manifestState = manifest.state
      const recordedVersion = inst.version ?? null

      let drift = 'none'
      if (recordedVersion === 'unknown' || recordedVersion === null || manifestVersion === null) {
        drift = 'unknown-version'
      } else if (recordedVersion !== manifestVersion) {
        drift = 'drifted'
      }

      plugins.push({
        id,
        name,
        marketplace,
        scope: inst.scope ?? null,
        recordedVersion,
        manifestVersion,
        manifestState,
        installPath: inst.installPath,
        enabled: enabledMap[id] === true,
        drift,
        repository: manifest.state === 'ok' ? (manifest.value.repository ?? null) : null,
      })
    }
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id))
  return { plugins, sources }
}
