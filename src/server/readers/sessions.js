import fs from 'node:fs'
import path from 'node:path'

// Sessions are the transcripts under <root>/projects/<slug>/*.jsonl. The slug
// is a lossy encoding of the launch directory — it maps '/' and '_' both to
// '-' — so it cannot be computed back from a path. A dir is identified the only
// reliable way, the way discovery already does it: by the `cwd` recorded inside
// its transcripts. All top-level transcripts in one dir share that cwd.
//
// Nothing here parses a whole transcript to LIST sessions — the store is ~200MB
// and a single file reaches 49MB. The list is built from file stats plus a
// capped read for a title; the full parse happens only when one session opens.

const projectsDir = (root) => path.join(root, 'projects')

// The transcript dir for a project. Claude Code names it by the launch path
// with '/', '_' and '.' each replaced by '-' — verified against every dir in a
// real store. The mapping is lossy (two paths differing only in those
// characters collide), but for a given path it is deterministic and needs no
// file reads, so listing costs nothing beyond a stat per transcript. The
// alternative — reading the cwd recorded inside a transcript — is defeated by
// that cwd sitting hundreds of KB deep, past the opening attachments.
function slugFor(projectPath) {
  return path.resolve(projectPath).replace(/[/_.]/g, '-')
}

function dirForProject(root, projectPath) {
  const dir = path.join(projectsDir(root), slugFor(projectPath))
  try { return fs.statSync(dir).isDirectory() ? dir : null } catch { return null }
}

// A short, recognisable label without a full parse: the newest ai-title Claude
// Code wrote, else the first human prompt, from a capped read of the head.
function titleFrom(file, budgetBytes = 131072) {
  let fd
  try { fd = fs.openSync(file, 'r') } catch { return null }
  try {
    const buf = Buffer.alloc(budgetBytes)
    const n = fs.readSync(fd, buf, 0, budgetBytes, 0)
    const lines = buf.toString('utf8', 0, n).split('\n')
    let aiTitle = null
    let firstPrompt = null
    for (const line of lines) {
      if (!line) continue
      let o
      try { o = JSON.parse(line) } catch { continue } // a truncated final line in the slice
      if (o.type === 'ai-title' && typeof o.aiTitle === 'string') aiTitle = o.aiTitle
      if (!firstPrompt) {
        const t = humanPrompt(o)
        if (t) firstPrompt = t
      }
    }
    return aiTitle ?? firstPrompt ?? null
  } catch { return null } finally { fs.closeSync(fd) }
}

// The human text of a user line, or null when the line is not a human prompt
// (a tool result, an attachment, a meta line). A prompt is what the person
// typed, not everything with role "user".
function promptText(o) {
  if (o.type !== 'user') return null
  const c = o.message?.content
  if (typeof c === 'string') return c.trim() || null
  if (Array.isArray(c)) {
    const text = c.filter((p) => p?.type === 'text').map((p) => p.text).join('\n').trim()
    return text || null
  }
  return null
}

// The text a person actually typed, or null. Claude Code injects several
// messages with role "user" that no one typed — the caveat and stdout wrappers
// around a slash command, and the "session is being continued" summary after a
// compaction. Those are dropped; a slash command itself (e.g. /code-review) is
// kept, unwrapped to its name, because running it was a real user action.
function humanPrompt(o) {
  const raw = promptText(o)
  if (!raw) return null
  const t = raw.trim()
  if (t.startsWith('<local-command-caveat>') || t.startsWith('<local-command-stdout>')) return null
  if (t.startsWith('This session is being continued from a previous conversation')) return null
  const cmd = /^<command-name>([^<]+)<\/command-name>/.exec(t)
  if (cmd) return cmd[1].trim()
  if (t.startsWith('<')) {
    const stripped = t.replace(/<[^>]+>/g, '').trim()
    return stripped || null
  }
  return t
}

export function listSessions(root, projectPath) {
  const dir = dirForProject(root, projectPath)
  if (!dir) return { sessions: [], state: 'absent' }

  const sessions = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const file = path.join(dir, name)
    let st
    try { st = fs.statSync(file) } catch { continue }
    if (!st.isFile()) continue
    sessions.push({
      id: name.replace(/\.jsonl$/, ''),
      lastActivity: st.mtime.toISOString(),
      bytes: st.size,
      title: titleFrom(file),
    })
  }
  sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
  return { sessions, state: sessions.length ? 'ok' : 'empty', dir }
}

// The one full parse, when a session opens. Metadata plus the human prompts,
// turn by turn — not the assistant's replies or tool output, which is the
// smallest sensitive surface that still lets you recognise a session.
const MAX_PROMPTS = 2000

export function readSession(root, projectPath, id) {
  const dir = dirForProject(root, projectPath)
  if (!dir) return { state: 'absent' }
  // Resolve the id within the project's own dir — never a client path — and
  // confirm the result stays inside it, so no crafted id can escape.
  const file = path.join(dir, `${path.basename(id)}.jsonl`)
  if (path.dirname(file) !== dir || !fs.existsSync(file)) return { state: 'absent' }

  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return { state: 'denied' } }

  let title = null
  let firstTs = null
  let lastTs = null
  let model = null
  let messageCount = 0
  let cwd = null
  const prompts = []
  let capped = false

  for (const line of text.split('\n')) {
    if (!line) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'ai-title' && typeof o.aiTitle === 'string') title = o.aiTitle
    if (o.cwd && !cwd) cwd = o.cwd
    if (o.timestamp) { if (!firstTs) firstTs = o.timestamp; lastTs = o.timestamp }
    if (o.type === 'user' || o.type === 'assistant') messageCount += 1
    if (o.type === 'assistant' && !model && o.message?.model) model = o.message.model
    const p = humanPrompt(o)
    if (p) {
      if (prompts.length < MAX_PROMPTS) prompts.push({ at: o.timestamp ?? null, text: p })
      else capped = true
    }
  }

  return {
    state: 'ok',
    id: path.basename(id),
    title: title ?? prompts[0]?.text?.slice(0, 80) ?? null,
    firstTs,
    lastTs,
    model,
    messageCount,
    cwd,
    prompts,
    capped,
  }
}
