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
// separators to dashes, so `payments_api` and `payments-api` collapse
// to the same string — 6 of 13 were unrecoverable on this machine.

const under = (child, parent) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Every one of these returns its reader state alongside its paths. Collapsing
// to [] made a denied or malformed source indistinguishable from a healthy one
// listing nothing — the app's own invariant, violated in the one builder that
// never carried `sources` the way buildInventory does.
function fromRegistry(home) {
  const file = path.join(home, '.claude.json')
  const r = readJsonSafe(file)
  return {
    paths: r.state === 'ok' ? Object.keys(r.value.projects ?? {}) : [],
    source: { label: 'project registry', dir: file, state: r.state },
  }
}

function fromHistory(root) {
  const file = path.join(root, 'history.jsonl')
  const out = new Set()
  let state = 'ok'
  let badLines = 0
  try {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.trim()) state = 'empty'
    for (const line of text.split('\n')) {
      if (!line.includes('"project"')) continue
      try {
        const v = JSON.parse(line).project
        if (v) out.add(v)
      } catch { badLines += 1 } // one malformed line hides one path, not the file
    }
  } catch (err) {
    state = err.code === 'ENOENT' ? 'absent'
      : (err.code === 'EACCES' || err.code === 'EPERM' ? 'denied' : 'malformed')
  }
  // Lines that would not parse are counted, not swallowed: each one is a
  // project this list may be missing.
  if (state === 'ok' && badLines) state = 'malformed'
  return { paths: [...out], source: { label: 'prompt history', dir: file, state, badLines } }
}

// One cwd per transcript: the directory the session STARTED in. Reading
// further would collect every subdirectory anyone cd'd into, which is noise
// for identifying a project.
function fromTranscripts(root) {
  const counts = new Map()
  const projects = path.join(root, 'projects')
  let unreadable = 0
  let dirs
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true })
  } catch (err) {
    const state = err.code === 'ENOENT' ? 'absent'
      : (err.code === 'EACCES' || err.code === 'EPERM' ? 'denied' : 'malformed')
    return { counts, source: { label: 'session transcripts', dir: projects, state, unreadable: 0 } }
  }
  // Transcripts nest: subagent sessions live under <session>/subagents/. They
  // carry cwd too, and reading only the top level misses whole projects —
  // this app's own repo was invisible until the walk recursed.
  const visit = (dir, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch { unreadable += 1; return }
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
      } catch { unreadable += 1 } // an unreadable transcript hides one session
    }
  }
  for (const dir of dirs) {
    if (dir.isDirectory()) visit(path.join(projects, dir.name), 1)
  }
  // `ok` with a non-zero count is still worth saying: every unreadable
  // transcript is a session, and possibly a project, this list may be missing.
  return {
    counts,
    source: {
      label: 'session transcripts',
      dir: projects,
      state: unreadable ? 'partial' : 'ok',
      unreadable,
    },
  }
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
    // A plugin source repo keeps its skills and agents at the REPO ROOT, not
    // under .claude/. Without this a repo full of Claude artifacts — the
    // author's own plugin — reported "no config".
    pluginSource: has('.claude-plugin/plugin.json'),
    git: has('.git'),
  }
}

/**
 * Every directory Claude Code is known to have run in, ranked by session
 * count. Measured ~650ms over 653 transcripts including nested subagent ones
 * — fine on demand for the projects page, too slow to sit on the global page.
 */
export function discoverProjects(root, home = os.homedir(), extra = [], tmp = os.tmpdir()) {
  const registry = fromRegistry(home)
  const history = fromHistory(root)
  const transcripts = fromTranscripts(root)
  const sessions = transcripts.counts
  const sources = [registry.source, history.source, transcripts.source]

  const all = new Set([
    ...registry.paths,
    ...history.paths,
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
      configured: markers
        ? (markers.memory || markers.settings || markers.mcp || markers.claudeDir || markers.pluginSource)
        : false,
    })
  }

  projects.sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path))
  return { projects, filtered, sources }
}
