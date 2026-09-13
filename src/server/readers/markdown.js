import path from 'node:path'
import { readDirSafe, readFileSafe, walkForDirSafe } from '../fsread.js'
import { parseFrontmatter, attributePlugin, visibleUnder } from './shared.js'

// Agents and commands are the same artifact shape: a markdown file whose
// frontmatter names it. They differ only in the directory they live in and
// in how they are invoked, so one reader serves both.
function toItem(root, file, dir, origin) {
  const raw = readFileSafe(file)
  const fm = raw.state === 'ok' ? parseFrontmatter(raw.value) : { data: {}, malformed: false }
  const rel = path.relative(dir, file).replace(/\.md$/, '')
  const attribution = origin === 'plugin' ? attributePlugin(root, file) : {}
  const name = fm.data.name ?? rel.split(path.sep).join(':')
  return {
    name,
    // What you actually type. Plugin artifacts are namespaced by their
    // plugin, which is why two plugins can both ship a "code-reviewer".
    invocable: attribution.plugin ? `${attribution.plugin}:${name}` : name,
    description: fm.data.description ?? null,
    model: fm.data.model ?? null,
    path: file,
    origin,
    malformed: fm.malformed,
    unreadable: raw.state === 'ok' ? null : raw.state,
    ...attribution,
  }
}

// Commands namespace by subdirectory, so nesting is real; agents are flat in
// practice. One shared depth covers both without inviting a runaway walk.
const NEST_DEPTH = 3

// plugins/cache/<marketplace>/<plugin>/<version>/<kind>
const PLUGIN_KIND_DEPTH = 4

function collect(root, dir, origin, items) {
  const visit = (current, left) => {
    const r = readDirSafe(current)
    if (r.state !== 'ok') return
    for (const entry of r.value) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) { if (left > 0) visit(full, left - 1) } else if (entry.name.endsWith('.md')) {
        items.push(toItem(root, full, dir, origin))
      }
    }
  }
  visit(dir, NEST_DEPTH)
}

export function readMarkdownKind(root, dirName) {
  const items = []
  const denied = []
  const errors = []
  const sources = []

  const userDir = path.join(root, dirName)
  const userState = readDirSafe(userDir)
  sources.push({ label: `user ${dirName}`, dir: userDir, state: userState.state })
  if (userState.state === 'ok') collect(root, userDir, 'user', items)

  // Claude Code loads a plugin's agents and commands from the plugin ROOT
  // only — <marketplace>/<plugin>/<version>/<kind>. A skill that keeps its own
  // prompt files in a nested agents/ directory is not shipping subagents, and
  // counting those would over-report what is actually loadable.
  const cache = path.join(root, 'plugins', 'cache')
  const cacheState = readDirSafe(cache)
  sources.push({ label: `plugin ${dirName}`, dir: cache, state: cacheState.state })
  if (cacheState.state === 'ok') {
    const w = walkForDirSafe(cache, dirName, PLUGIN_KIND_DEPTH)
    denied.push(...w.denied)
    errors.push(...w.errors)
    const atPluginRoot = w.found.filter((d) =>
      path.relative(cache, d).split(path.sep).length === PLUGIN_KIND_DEPTH)
    for (const dir of visibleUnder(cache, atPluginRoot)) collect(root, dir, 'plugin', items)
  }

  items.sort((a, b) => a.invocable.localeCompare(b.invocable))
  return { items, denied, errors, sources }
}
