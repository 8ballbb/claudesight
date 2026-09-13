import crypto from 'node:crypto'
import path from 'node:path'
import { readSkills } from './readers/skills.js'
import { readMemory, flattenMemory } from './readers/memory.js'
import { readSettings, extractScripts } from './readers/settings.js'
import { readPlugins } from './readers/plugins.js'
import { classify } from './writability.js'
import { readJsonSafe, readDirSafe } from './fsread.js'

const handleFor = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 16)

// A project's .claude/ is structurally the global root in miniature, so the
// same readers work against it. `root` for classification is the PROJECT
// directory, not its .claude/, because CLAUDE.md and .mcp.json sit beside it.
export function buildProjectInventory(projectPath) {
  const table = new Map()
  const groups = []
  const denied = []
  const errors = []
  const dotClaude = path.join(projectPath, '.claude')

  const add = (groupKind, entries) => {
    const items = entries.map((e) => {
      const kind = e.artifactKind ?? groupKind
      const id = handleFor(e.path)
      table.set(id, { path: e.path, kind })
      return { id, kind, ...e, writability: classify({ path: e.path, kind, root: projectPath }) }
    })
    groups.push({ kind: groupKind, items })
  }

  // Every documented project memory location, each with its imports resolved.
  const memoryItems = []
  for (const rel of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md')]) {
    const node = readMemory(path.join(projectPath, rel))
    if (node.state === 'absent') continue
    for (const n of flattenMemory(node)) {
      memoryItems.push({
        path: n.path,
        label: path.relative(projectPath, n.path),
        bytes: n.bytes,
        state: n.state,
      })
    }
  }
  add('memory', memoryItems)

  const settingsItems = []
  for (const name of ['settings.json', 'settings.local.json']) {
    const file = path.join(dotClaude, name)
    const r = readJsonSafe(file)
    if (r.state === 'absent') continue
    settingsItems.push({
      path: file,
      label: name,
      keys: r.state === 'ok' ? Object.keys(r.value).length : 0,
      state: r.state,
    })
  }
  add('settings', settingsItems)

  const mcpFile = path.join(projectPath, '.mcp.json')
  const mcp = readJsonSafe(mcpFile)
  add('mcp', mcp.state === 'absent' ? [] : [{
    path: mcpFile,
    label: '.mcp.json',
    servers: mcp.state === 'ok' ? Object.keys(mcp.value.mcpServers ?? {}).length : 0,
    state: mcp.state,
  }])

  // readSkills expects a root holding skills/ — a project's .claude/ is that.
  const sk = readSkills(dotClaude)
  denied.push(...sk.denied)
  errors.push(...sk.errors)
  add('skill', sk.skills.map((x) => ({
    path: x.path, label: x.name, description: x.description,
    origin: 'project', malformed: x.malformed, unreadable: x.unreadable,
  })))

  return {
    root: projectPath,
    scope: 'project',
    groups,
    denied,
    errors,
    sources: [{ label: 'project .claude', dir: dotClaude, state: readDirSafe(dotClaude).state }],
    table,
  }
}

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
  add('plugin', pl.plugins.map((p) => {
    // A plugin's installPath is a DIRECTORY. Addressing the item by it made
    // every read throw EISDIR, so point at the manifest when there is one and
    // mark the item unopenable when there is not.
    const manifest = path.join(p.installPath, '.claude-plugin', 'plugin.json')
    const openable = p.manifestState === 'ok'
    return {
      path: openable ? manifest : p.installPath,
      openable,
      label: p.id,
      drift: p.drift,
      recordedVersion: p.recordedVersion,
      manifestVersion: p.manifestVersion,
      manifestState: p.manifestState,
      scope: p.scope,
      enabled: p.enabled,
      marketplace: p.marketplace,
      installPath: p.installPath,
      repository: p.repository ?? null,
    }
  }))

  return {
    root,
    groups,
    denied,
    errors,
    sources: [...sk.sources, ...pl.sources],
    table,
  }
}
