import path from 'node:path'
import { readJsonSafe } from '../fsread.js'

export function readPlugins(root) {
  const installedPath = path.join(root, 'plugins', 'installed_plugins.json')
  const installed = readJsonSafe(installedPath)
  const sources = [{ label: 'installed_plugins', dir: installedPath, state: installed.state }]
  if (installed.state !== 'ok') return { plugins: [], sources }

  const settings = readJsonSafe(path.join(root, 'settings.json'))
  const enabledMap = settings.state === 'ok' ? (settings.value.enabledPlugins ?? {}) : {}

  const plugins = []
  for (const [id, instances] of Object.entries(installed.value.plugins ?? {})) {
    for (const inst of instances) {
      const [name, marketplace] = id.split('@')
      const manifest = readJsonSafe(path.join(inst.installPath, '.claude-plugin', 'plugin.json'))
      const manifestVersion = manifest.state === 'ok' ? (manifest.value.version ?? null) : null
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
        recordedVersion,
        manifestVersion,
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
