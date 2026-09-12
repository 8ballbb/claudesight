import crypto from 'node:crypto'
import path from 'node:path'
import { readSkills } from './readers/skills.js'
import { readMemory, flattenMemory } from './readers/memory.js'
import { readSettings, extractScripts } from './readers/settings.js'
import { readPlugins } from './readers/plugins.js'
import { classify } from './writability.js'

const handleFor = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 16)

export function buildInventory(root) {
  const table = new Map()
  const groups = []
  const denied = []
  const errors = []

  const add = (groupKind, entries) => {
    const items = entries.map((e) => {
      const kind = e.artifactKind ?? groupKind
      const id = handleFor(e.path)
      table.set(id, { path: e.path, kind })
      return { id, kind, ...e, writability: classify({ path: e.path, kind, root }) }
    })
    groups.push({ kind: groupKind, items })
  }

  const mem = readMemory(path.join(root, 'CLAUDE.md'))
  add('memory', flattenMemory(mem).map((n) => ({
    path: n.path,
    label: path.basename(n.path),
    bytes: n.bytes,
    state: n.state,
    cycle: n.cycle ?? false,
    depthExceeded: n.depthExceeded ?? false,
  })))

  const s = readSettings(root)
  add('settings', s.result.state === 'ok'
    ? [{ path: s.path, label: 'settings.json', keys: Object.keys(s.result.value).length }]
    : [])

  const scripts = s.result.state === 'ok' ? extractScripts(s.result.value, root) : []
  add('scripts', scripts.filter((r) => r.scriptPath).map((r) => ({
    path: r.scriptPath, label: path.basename(r.scriptPath), keyPath: r.keyPath, command: r.command, artifactKind: r.kind,
  })))

  const sk = readSkills(root)
  denied.push(...sk.denied)
  errors.push(...sk.errors)
  add('skill', sk.skills.map((x) => ({
    path: x.path, label: x.name, description: x.description, origin: x.origin, plugin: x.plugin,
    malformed: x.malformed, unreadable: x.unreadable,
  })))

  const pl = readPlugins(root)
  add('plugin', pl.plugins.map((p) => ({
    path: p.installPath, label: p.id, drift: p.drift,
    recordedVersion: p.recordedVersion, manifestVersion: p.manifestVersion,
    manifestState: p.manifestState, scope: p.scope, enabled: p.enabled,
  })))

  return {
    root,
    groups,
    denied,
    errors,
    sources: [...sk.sources, ...pl.sources],
    table,
  }
}
