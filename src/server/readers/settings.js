import fs from 'node:fs'
import path from 'node:path'
import { readJsonSafe, readFileSafe } from '../fsread.js'

export function readSettings(root) {
  const p = path.join(root, 'settings.json')
  return { result: readJsonSafe(p), path: p }
}

// Pull a filesystem path out of a shell command like `bash ~/.claude/x.sh`.
function scriptPathFrom(command, root) {
  if (typeof command !== 'string') return null
  for (const token of command.split(/\s+/)) {
    const candidate = token.startsWith('~')
      ? path.join(root, token.slice(1).replace(/^\/?\.claude\/?/, ''))
      : token
    if (!candidate.includes('/')) continue
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch { /* not a path; keep looking */ }
  }
  return null
}

function makeRef(kind, keyPath, command, root) {
  const scriptPath = scriptPathFrom(command, root)
  return {
    kind,
    keyPath,
    command,
    scriptPath,
    body: scriptPath ? readFileSafe(scriptPath) : null,
  }
}

export function extractScripts(settings, root) {
  const refs = []
  if (settings?.statusLine?.command) {
    refs.push(makeRef('statusLineScript', 'statusLine.command', settings.statusLine.command, root))
  }
  const hooks = settings?.hooks ?? {}
  for (const [event, matchers] of Object.entries(hooks)) {
    if (!Array.isArray(matchers)) continue
    matchers.forEach((matcher, i) => {
      const list = Array.isArray(matcher?.hooks) ? matcher.hooks : []
      list.forEach((hook, j) => {
        if (typeof hook?.command !== 'string') return
        refs.push(makeRef('hookScript', `hooks.${event}.${i}.hooks.${j}.command`, hook.command, root))
      })
    })
  }
  return refs
}
