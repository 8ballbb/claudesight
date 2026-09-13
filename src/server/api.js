import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readSkills } from './readers/skills.js'
import { readMemory, flattenMemory } from './readers/memory.js'
import { readSettings, extractScripts } from './readers/settings.js'
import { readPlugins } from './readers/plugins.js'
import { readMarkdownKind } from './readers/markdown.js'
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

  // Markdown-defined kinds: a flat directory of .md files, or nested for rules.
  const markdownAt = (dir, depth) => {
    const r = readDirSafe(dir)
    if (r.state !== 'ok') return []
    const out = []
    const visit = (current, left) => {
      const entries = readDirSafe(current)
      if (entries.state !== 'ok') return
      for (const entry of entries.value) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) { if (left > 0) visit(full, left - 1); continue }
        if (!entry.name.endsWith('.md')) continue
        out.push({ path: full, label: path.relative(dir, full).replace(/\.md$/, '') })
      }
    }
    visit(dir, depth)
    return out
  }

  const markdownIn = (rel, depth) => markdownAt(path.join(dotClaude, rel), depth)

  // A plugin SOURCE repo keeps its artifacts at the repo root rather than
  // under .claude/ — that is the layout `claude plugin` publishes from. Without
  // this, a repo holding a manifest, 13 agents and 3 skills reported nothing.
  const manifest = readJsonSafe(path.join(projectPath, '.claude-plugin', 'plugin.json'))
  const isPluginSource = manifest.state !== 'absent'

  add('agent', [...markdownIn('agents', 1), ...(isPluginSource ? markdownAt(path.join(projectPath, 'agents'), 1) : [])])
  add('command', [...markdownIn('commands', 1), ...(isPluginSource ? markdownAt(path.join(projectPath, 'commands'), 2) : [])])
  add('rule', markdownIn('rules', 3))

  if (isPluginSource) {
    add('manifest', [{
      path: path.join(projectPath, '.claude-plugin', 'plugin.json'),
      label: 'plugin.json',
      keys: manifest.state === 'ok' ? Object.keys(manifest.value).length : 0,
      declaredVersion: manifest.state === 'ok' ? (manifest.value.version ?? null) : null,
      state: manifest.state,
      artifactKind: 'settings',
    }])
    const repoSkills = readSkills(projectPath)
    denied.push(...repoSkills.denied)
    errors.push(...repoSkills.errors)
    for (const g of groups) {
      if (g.kind !== 'skill') continue
      for (const x of repoSkills.skills) {
        const id = handleFor(x.path)
        table.set(id, { path: x.path, kind: 'skill' })
        g.items.push({
          id, kind: 'skill', path: x.path, label: x.name, description: x.description,
          origin: 'plugin-source', malformed: x.malformed, unreadable: x.unreadable,
          writability: classify({ path: x.path, kind: 'skill', root: projectPath }),
        })
      }
    }
  }

  // Hooks and status lines declared in a project's settings point at scripts
  // that Claude Code EXECUTES. The global inventory has always surfaced these;
  // at project scope they were invisible.
  const scripts = []
  for (const name of ['settings.json', 'settings.local.json']) {
    const r = readJsonSafe(path.join(dotClaude, name))
    if (r.state !== 'ok') continue
    for (const x of extractScripts(r.value, projectPath)) {
      if (x.scriptPath) {
        scripts.push({
          path: x.scriptPath, label: path.basename(x.scriptPath),
          keyPath: `${name}:${x.keyPath}`, command: x.command, artifactKind: x.kind,
        })
      }
    }
  }
  add('scripts', scripts)

  // Anything else in .claude/ that no reader above consumed. A project's
  // .claude/ is curated by hand, so an entry we do not recognise is still a
  // real thing the user put there — showing "nothing" because we lack a
  // reader is precisely the failure this app exists to prevent. (The global
  // root is excluded from this treatment: it holds Claude Code's own internal
  // state — caches, daemons, session data — which is noise, not config.)
  const CONSUMED = new Set([
    'CLAUDE.md', 'settings.json', 'settings.local.json',
    'skills', 'agents', 'commands', 'rules',
  ])
  const rest = readDirSafe(dotClaude)
  add('other', rest.state !== 'ok' ? [] : rest.value
    .filter((e) => !CONSUMED.has(e.name))
    .map((e) => {
      const full = path.join(dotClaude, e.name)
      let size = null
      try { size = e.isDirectory() ? null : fs.statSync(full).size } catch { /* ignore */ }
      return {
        path: full,
        label: e.name,
        entryType: e.isDirectory() ? 'directory' : 'file',
        bytes: size,
      }
    }))

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
  const sources = []

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

  // Agents and commands were missing entirely: on a machine with no user-level
  // agents/ directory, every one of them comes from a plugin, so a reader that
  // only looked at <root>/agents would have reported an honest-looking zero.
  for (const [kind, dirName] of [['agent', 'agents'], ['command', 'commands']]) {
    const r = readMarkdownKind(root, dirName)
    denied.push(...r.denied)
    errors.push(...r.errors)
    sources.push(...r.sources)
    add(kind, r.items.map((x) => ({
      path: x.path, label: x.name, invocable: x.invocable, description: x.description,
      model: x.model, origin: x.origin, plugin: x.plugin ?? null,
      malformed: x.malformed, unreadable: x.unreadable,
    })))
  }

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
    sources: [...sk.sources, ...sources, ...pl.sources],
    table,
  }
}
