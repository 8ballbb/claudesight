import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonSafe } from './fsread.js'

// Where has Claude Code actually run? Three records answer it, and none is
// complete on its own — measured on a real machine, the union is 17 where the
// best single source gives 13. The project this app was built in appears ONLY
// in transcript cwds, because subagents ran there without ever triggering the
// trust decision that would register it.
//
// Deliberately NOT a source: the directory names under projects/. They mangle
// separators to dashes, so `payments-api` and `enterprise-memory` collapse
// to the same string — 6 of 13 were unrecoverable on this machine.

const under = (child, parent) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function fromRegistry(home) {
  const r = readJsonSafe(path.join(home, '.claude.json'))
  return r.state === 'ok' ? Object.keys(r.value.projects ?? {}) : []
}

function fromHistory(root) {
  const file = path.join(root, 'history.jsonl')
  const out = new Set()
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"project"')) continue
      try {
        const v = JSON.parse(line).project
        if (v) out.add(v)
      } catch { /* one malformed line hides one path, not the file */ }
    }
  } catch { /* absent history is not an error */ }
  return [...out]
}

// One cwd per transcript: the directory the session STARTED in. Reading
// further would collect every subdirectory anyone cd'd into, which is noise
// for identifying a project.
function fromTranscripts(root) {
  const counts = new Map()
  const projects = path.join(root, 'projects')
  let dirs
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true })
  } catch {
    return counts
  }
  // Transcripts nest: subagent sessions live under <session>/subagents/. They
  // carry cwd too, and reading only the top level misses whole projects —
  // this app's own repo was invisible until the walk recursed.
  const visit = (dir, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { visit(full, depth + 1); continue }
      if (!entry.name.endsWith('.jsonl')) continue
      try {
        for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
          if (!line.includes('"cwd"')) continue
          let cwd
          try { cwd = JSON.parse(line).cwd } catch { continue }
          if (cwd) { counts.set(cwd, (counts.get(cwd) ?? 0) + 1); break }
        }
      } catch { /* unreadable transcript hides one session */ }
    }
  }
  for (const dir of dirs) {
    if (dir.isDirectory()) visit(path.join(projects, dir.name), 1)
  }
  return counts
}

// "Ephemeral scratch, not a project." Expressed against the platform's real
// temp directory rather than hardcoded /private and /var/folders prefixes,
// which are macOS-specific — and which swallowed every project under a
// temp-dir home. Work inside your own home still counts even when the home
// itself is temporary.
function isNoise(p, home, root, tmp) {
  if (p === home) return true // the home directory is not a project
  if (under(p, root)) return true // inside the config root
  // os.tmpdir() plus /tmp, which is ephemeral by POSIX convention — macOS
  // exposes it as both /tmp and /private/tmp. Work inside your own home still
  // counts even when the home itself is temporary, which is how the tests run.
  const ephemeral = [tmp, path.join('/private', tmp.replace(/^\/private/, '')), '/tmp', '/private/tmp']
  return ephemeral.some((e) => under(p, e)) && !under(p, home)
}

// What Claude-related files does this directory actually hold?
export function projectMarkers(dir) {
  const has = (rel) => fs.existsSync(path.join(dir, rel))
  return {
    memory: has('CLAUDE.md') || has('CLAUDE.local.md') || has('.claude/CLAUDE.md'),
    settings: has('.claude/settings.json') || has('.claude/settings.local.json'),
    mcp: has('.mcp.json'),
    skills: has('.claude/skills'),
    claudeDir: has('.claude'),
    git: has('.git'),
  }
}

/**
 * Every directory Claude Code is known to have run in, ranked by session
 * count. Measured ~650ms over 653 transcripts including nested subagent ones
 * — fine on demand for the projects page, too slow to sit on the global page.
 */
export function discoverProjects(root, home = os.homedir(), extra = [], tmp = os.tmpdir()) {
  const sessions = fromTranscripts(root)
  const all = new Set([
    ...fromRegistry(home),
    ...fromHistory(root),
    ...sessions.keys(),
    ...extra,
  ])

  const projects = []
  let filtered = 0
  for (const dir of all) {
    if (isNoise(dir, home, root, tmp)) { filtered += 1; continue }
    const exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory()
    const markers = exists ? projectMarkers(dir) : null
    projects.push({
      path: dir,
      exists,
      sessions: sessions.get(dir) ?? 0,
      markers,
      configured: markers ? (markers.memory || markers.settings || markers.mcp || markers.claudeDir) : false,
    })
  }

  projects.sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))
  return { projects, filtered }
}
