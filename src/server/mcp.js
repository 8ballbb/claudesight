import fs from 'node:fs'
import path from 'node:path'
import { readJsonSafe } from './fsread.js'

// A declared MCP server whose command is not on PATH fails at launch, and
// nothing in the configuration says so — the same shape as the broken-hook
// case, which this file applies to .mcp.json.
//
// The check is deliberately conservative. `resolved` is true when the command
// was found, false when PATH was searched and it was not there, and null when
// no answer is possible: a server addressed by URL has no command, and a
// command cannot be judged when PATH itself is unavailable. A confident
// "missing" for something we could not look up would be a new way of lying.

function isExecutable(file) {
  try {
    const st = fs.statSync(file)
    if (!st.isFile()) return false
    return (st.mode & 0o111) !== 0
  } catch { return false }
}

export function resolveCommand(command, env = process.env) {
  if (typeof command !== 'string' || command.length === 0) {
    return { resolved: null, reason: 'no command given' }
  }
  // A path, absolute or relative, is not a PATH lookup.
  if (command.includes('/')) {
    const abs = path.resolve(command)
    if (!fs.existsSync(abs)) return { resolved: false, at: abs, reason: 'no such file' }
    if (!isExecutable(abs)) return { resolved: false, at: abs, reason: 'not executable' }
    return { resolved: true, at: abs }
  }
  const PATH = env.PATH ?? env.Path
  if (typeof PATH !== 'string' || PATH.length === 0) {
    return { resolved: null, reason: 'PATH is not set, so nothing can be looked up' }
  }
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, command)
    if (isExecutable(candidate)) return { resolved: true, at: candidate }
  }
  return { resolved: false, reason: 'not found on PATH' }
}

// Every server declared in an .mcp.json, each one carrying whether its command
// could be found. The file used to be reported as a single row with a count of
// servers, which named a number and answered nothing about any of them.
export function readMcpServers(file, env = process.env) {
  const r = readJsonSafe(file)
  if (r.state !== 'ok') return { state: r.state, line: r.line ?? null, column: r.column ?? null, servers: [] }

  const declared = r.value?.mcpServers
  if (declared === undefined) return { state: 'empty', servers: [] }
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) {
    return { state: 'malformed', reason: 'mcpServers is not an object', servers: [] }
  }

  const servers = []
  for (const [name, raw] of Object.entries(declared)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      servers.push({ name, transport: 'unknown', command: null, resolved: null, reason: 'this entry is not an object' })
      continue
    }
    // A URL-addressed server has no local command to find.
    if (typeof raw.url === 'string' && typeof raw.command !== 'string') {
      servers.push({ name, transport: raw.type ?? 'url', url: raw.url, command: null, resolved: null, reason: 'addressed by URL — nothing to find on PATH' })
      continue
    }
    const found = resolveCommand(raw.command, env)
    servers.push({
      name,
      transport: raw.type ?? 'stdio',
      command: typeof raw.command === 'string' ? raw.command : null,
      args: Array.isArray(raw.args) ? raw.args.length : 0,
      resolved: found.resolved,
      at: found.at ?? null,
      reason: found.reason ?? null,
    })
  }
  return { state: servers.length ? 'ok' : 'empty', servers }
}
