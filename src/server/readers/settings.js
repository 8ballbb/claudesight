import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonSafe, readFileSafe } from '../fsread.js'

export function readSettings(root) {
  const p = path.join(root, 'settings.json')
  return { result: readJsonSafe(p), path: p }
}

// `~` in a shell command is the home directory, not the config root — these
// differ whenever CLAUDE_CONFIG_DIR is set.
const INTERPRETERS = new Set(['env', 'sh', 'bash', 'zsh', 'dash', 'node', 'python', 'python3', 'ruby', 'perl'])

// A project's hooks are normally written relative to the project, or against
// $CLAUDE_PROJECT_DIR. Resolving only absolute and ~/ paths left those hooks
// showing a command with no file behind it — invisible, though Claude Code
// executes them. `root` is the project at project scope, the config root at
// global scope; it was already a parameter here and simply never used.
function resolveToken(token, home, root) {
  const expanded = token
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, root)
    .replace(/\$CLAUDE_PROJECT_DIR/g, root)
  if (expanded.startsWith('~/')) return path.join(home, expanded.slice(2))
  if (path.isAbsolute(expanded)) return expanded
  return path.resolve(root, expanded)
}

function scriptPathFrom(command, home, root) {
  if (typeof command !== 'string') return null
  let found = null
  for (const token of command.split(/\s+/)) {
    if (token.startsWith('-')) continue
    if (!token.includes('/')) continue
    const candidate = resolveToken(token, home, root)
    if (INTERPRETERS.has(path.basename(candidate))) continue
    try {
      if (fs.statSync(candidate).isFile()) found = candidate
    } catch { /* not a path; keep looking */ }
  }
  return found
}

function makeRef(kind, keyPath, command, home, root) {
  const scriptPath = scriptPathFrom(command, home, root)
  return {
    kind,
    keyPath,
    command,
    scriptPath,
    body: scriptPath ? readFileSafe(scriptPath) : null,
  }
}

export function extractScripts(settings, root, home = os.homedir()) {
  const refs = []
  if (settings?.statusLine?.command) {
    refs.push(makeRef('statusLineScript', 'statusLine.command', settings.statusLine.command, home, root))
  }
  const hooks = settings?.hooks ?? {}
  for (const [event, matchers] of Object.entries(hooks)) {
    if (!Array.isArray(matchers)) continue
    matchers.forEach((matcher, i) => {
      const list = Array.isArray(matcher?.hooks) ? matcher.hooks : []
      list.forEach((hook, j) => {
        if (typeof hook?.command !== 'string') return
        refs.push(makeRef('hookScript', `hooks.${event}.${i}.hooks.${j}.command`, hook.command, home, root))
      })
    })
  }
  return refs
}
