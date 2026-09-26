// The Claude-file critic: a read-only `claude -p` review of one artifact.
//
// This is the one place claudesight makes an outbound LLM call, and it does so
// only when the user has enabled Review and confirmed a click (see the routes
// in index.js and the consent UI). Everything here is built around three facts
// established by the design spec's red/blue review:
//
//   1. The subprocess must NOT load or run the target's hooks/MCP. Spawning
//      `claude` inside a project fires that project's SessionStart hooks — a
//      "read-only" review would execute shell. So the child runs in a NEUTRAL
//      empty working directory with --strict-mcp-config. (Verified empirically:
//      a hook in the project dir fires under a normal spawn and does NOT fire
//      from a neutral cwd.) --bare would also skip hooks but requires an API key
//      and never reads OAuth, so it is not usable under a subscription login.
//
//   2. The default critic has NO file-read tools at all. Grounding is the
//      metadata seed claudesight assembles here plus a local-verify pass. This
//      removes the exfiltration primitive: untrusted artifact content cannot
//      drive the model to read secrets, because it has no Read/Grep/Glob.
//
//   3. claudesight adjudicates repo-claims locally. The critic marks a finding
//      with a STRUCTURED `verify_against`; we resolve it offline against the
//      real files, with zero extra egress, and confirm/refute it.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The critic model. Sonnet for cost; the preflight probe uses haiku since it
// only needs to prove the binary + flags + auth work end to end.
const REVIEW_MODEL = 'sonnet'
const PROBE_MODEL = 'haiku'
const REVIEW_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 30_000
// The artifact's own text is embedded in the prompt; a runaway file should be
// refused rather than sent. Generous for config files, far below any real risk.
const MAX_ARTIFACT_BYTES = 256 * 1024

// A neutral, empty directory for the child's cwd, so no project settings.json
// (hence no hooks) and no CLAUDE.md are discovered from the working tree.
function neutralCwd() {
  const dir = path.join(os.tmpdir(), 'claudesight-critic')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// execFile with an ARGS ARRAY — never a shell string, so nothing in the prompt
// or a path can be interpreted as shell. Injectable so tests never hit network.
export function spawnClaude(args, { cwd, timeoutMs, injectedRun } = {}) {
  if (injectedRun) return injectedRun(args, { cwd, timeoutMs })
  return new Promise((resolve) => {
    execFile('claude', args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') return resolve({ ok: false, code: 'ENOENT', stdout: '', stderr: '' })
        if (err && err.killed) return resolve({ ok: false, code: 'TIMEOUT', stdout: stdout ?? '', stderr: stderr ?? '' })
        resolve({ ok: !err, code: err?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '' })
      })
  })
}

// ── Preflight ──────────────────────────────────────────────────────────────
// Prove `claude -p` is usable before any Review button is shown. Distinguishes
// the failures a user can act on — binary missing, auth, version/flag — rather
// than collapsing them to a bare "unavailable" (result.js discipline).
export async function preflight({ injectedRun } = {}) {
  const args = ['-p', 'reply with exactly: ok', '--output-format', 'json',
    '--model', PROBE_MODEL, '--strict-mcp-config', '--disallowedTools',
    'Bash,Edit,Write,Read,Grep,Glob']
  const r = await spawnClaude(args, { cwd: neutralCwd(), timeoutMs: PROBE_TIMEOUT_MS, injectedRun })
  if (r.code === 'ENOENT') {
    return { state: 'absent', reason: 'The `claude` CLI was not found on PATH. Install Claude Code to enable Review.' }
  }
  if (r.code === 'TIMEOUT') {
    return { state: 'error', reason: 'The `claude` CLI did not respond within 30s.' }
  }
  const parsed = parseJson(r.stdout)
  const blob = `${r.stdout}\n${r.stderr}`.toLowerCase()
  if (!r.ok || !parsed) {
    if (/login|logged in|authenticat|oauth|api key|unauthor|forbidden|credit|billing/.test(blob)) {
      return { state: 'auth', reason: 'The `claude` CLI is installed but not authenticated (or out of credit). Run `claude` once to sign in.' }
    }
    return { state: 'error', reason: 'The `claude` CLI failed a trivial call. Run `claude -p "hi"` in a terminal to see why.' }
  }
  return { state: 'ok' }
}

// ── Review ───────────────────────────────────────────────────────────────────
export async function review({ entry, content, injectedRun } = {}) {
  if (content == null) return { state: 'error', reason: 'Nothing to review — the file could not be read.' }
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_ARTIFACT_BYTES) {
    return { state: 'error', reason: `This file is ${bytes} bytes — larger than the ${MAX_ARTIFACT_BYTES}-byte review limit.` }
  }

  const seed = buildSeed(entry, content)
  const system = buildSystemPrompt(entry.kind)
  const prompt = buildPrompt(seed, content)

  const args = ['-p', prompt,
    '--model', REVIEW_MODEL,
    '--output-format', 'json',
    '--append-system-prompt', system,
    // Default mode: no file tools whatsoever. The critic is pure text-in/JSON-out.
    '--allowedTools', '',
    '--disallowedTools', 'Bash,Edit,Write,Read,Grep,Glob',
    '--strict-mcp-config',
    '--permission-mode', 'dontAsk']

  const r = await spawnClaude(args, { cwd: neutralCwd(), timeoutMs: REVIEW_TIMEOUT_MS, injectedRun })
  if (r.code === 'ENOENT') return { state: 'absent', reason: 'The `claude` CLI was not found on PATH.' }
  if (r.code === 'TIMEOUT') return { state: 'error', reason: 'The review timed out after 120s.' }

  const envelope = parseJson(r.stdout)
  if (!envelope) return { state: 'error', reason: 'The review did not return parseable output.' }
  const findingsDoc = parseJson(stripFences(envelope.result ?? ''))
  if (!findingsDoc || !Array.isArray(findingsDoc.findings)) {
    return { state: 'error', reason: 'The critic did not return a structured review.' }
  }

  const verified = findingsDoc.findings.map((f) => ({
    ...f,
    local_verification: localVerify(f.verify_against, entry.root),
  }))

  return {
    state: 'ok',
    report: {
      verdict: findingsDoc.verdict ?? null,
      findings: verified,
      // The honest egress record: in default mode the critic reads no files, so
      // the only thing sent is this artifact plus the metadata seed.
      context_seeded: Object.keys(seed.facts),
      files_read: [],
      cost_usd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : null,
    },
  }
}

// ── Metadata seed (§9.1a) ────────────────────────────────────────────────────
// claudesight already resolved this artifact's operating context; hand the
// critic the facts rather than a naked file. Small, structured, deterministic —
// so the per-click confirm can name exactly what egresses.
export function buildSeed(entry, content) {
  const facts = {}
  const put = (k, v) => { if (v !== null && v !== undefined && v !== '') facts[k] = v }
  put('kind', entry.kind)
  put('label', entry.label)
  put('path', entry.path)
  put('scope', entry.scope ?? (entry.root ? 'project' : 'global'))
  put('writability', entry.writability?.class)
  put('state', entry.state)
  put('description', entry.description)
  put('invoke_as', entry.invocable)
  put('model', entry.model)
  put('origin', entry.origin)
  put('plugin', entry.plugin)
  put('bound_to', entry.keyPath)
  put('command', entry.command)
  put('capabilities', entry.capabilities)
  // Precedence: claudesight knows when a definition is shadowed or inherited.
  put('shadows', entry.shadows)
  put('inherited_from', entry.inheritedFrom)
  if (/^@[^\n]+/m.test(content)) facts.has_at_imports = true
  return { facts }
}

const RUBRICS = {
  memory: `This is a CLAUDE.md / memory file loaded into Claude Code's context EVERY session, so every token costs. Judge it on: actionability (can a model execute the instruction, or is it a vague principle?), token economy (does every line change behaviour?), specificity (does it name concrete files/commands, or is it generic boilerplate?), non-redundancy (is it discoverable from the codebase without this file?), staleness (tool/version references that may be wrong), precedence clarity (conflicting always/never rules), testability (can compliance be checked?), and density (historical rationale that changes no behaviour).`,
  skill: `This is a Skill. Judge its description/trigger precision above all: is it specific enough to fire when intended and NOT fire otherwise? Flag over-broad ("use for any task") and over-narrow triggers. Then frontmatter correctness, body actionability (executable steps vs vague principles), and YAGNI.`,
  agent: `This is a subagent definition. Judge when-to-invoke clarity (does the description tell the dispatcher exactly when to use it?) and LEAST-PRIVILEGE tools: is the tool allowlist wider than the job needs? Note that an ABSENT tools list inherits everything including Bash, so silence is more permissive than a narrow explicit list — judge the effective grant, not the spelling.`,
  command: `This is a slash command. Judge argument clarity, prompt specificity, scope creep and redundancy. Claude Code marks commands deprecated in favour of skills; "this could be a skill" is a fair finding.`,
  settings: `This is a settings.json / hooks file. Judge SECURITY posture first: over-permissive allow-lists, dangerous shell patterns, potential injection in hook commands, plaintext secrets, and matcher correctness. Execution semantics depend on environment you cannot fully see — hedge (confidence: low) with a verify_against unless the seed already confirms it.`,
  hookScript: `This is a hook/statusline script Claude Code executes as shell. Judge SECURITY first: dangerous commands, injection, unquoted expansions, secrets. Then whether it does what its binding implies. Hedge anything that depends on runtime environment.`,
  rule: `This is a rule file. Judge clarity, scope (does it quietly apply to files it should not?), specificity and redundancy.`,
}
RUBRICS.statusLineScript = RUBRICS.hookScript
RUBRICS.mcp = RUBRICS.settings

export function buildSystemPrompt(kind) {
  const rubric = RUBRICS[kind] ?? RUBRICS.memory
  return `You are a strict, read-only critic of Claude Code configuration files. You SUGGEST changes; you never edit. Your cardinal rule: additions are expensive, cuts are cheap — you are biased toward cutting. An addition is only justified if it encodes non-obvious, project-specific knowledge that materially changes behaviour and cannot be inferred from the codebase.

Work in two passes. PASS A (reduce): find content to cut, tighten, or keep. PASS B (add): only after A, and every addition must clear the bar above. "keep" is a valid, expected verdict — a review with zero keeps is over-criticism. Do not invent problems to fill a report; if the file is already lean, say so and return few findings.

Every cut/edit finding MUST quote the exact text it refers to. Do not invent file paths, commands, or facts you were not given. If a finding depends on the current state of the repo (a file existing, a tool version, a string appearing somewhere), you cannot verify it yourself — express it as a structured verify_against and keep confidence "low".

${rubric}

Respond with ONLY a JSON object, no prose around it, of this shape:
{
  "findings": [
    {
      "id": "F-001",
      "pass": "A" | "B",
      "action": "cut" | "edit" | "add" | "keep",
      "severity": "high" | "medium" | "low",
      "quote": "<verbatim excerpt from the file, or empty for an addition>",
      "problem": "<what is wrong, precisely>",
      "suggested_change": "<replacement text, or DELETE, or the text to add>",
      "rationale": "<why this improves the file>",
      "counterargument": "<strongest reason NOT to do this — required for add/edit>",
      "confidence": "high" | "medium" | "low",
      "verify_against": null | { "kind": "file_exists" | "substring_in_file" | "referenced_path_exists", "path": "<relative path>", "needle": "<string, for substring_in_file>" }
    }
  ],
  "verdict": {
    "verdict": "pass" | "needs_work" | "significant_revision_required",
    "summary": "<2-3 sentences>",
    "keep_count": <integer>,
    "review_limitations": ["<what you could not assess without the repo>"]
  }
}`
}

export function buildPrompt(seed, content) {
  const facts = Object.entries(seed.facts)
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return `claudesight has resolved this artifact's operating context. Use these facts; do not guess about them:

${facts}

Here is the file to review, verbatim between the markers:

<<<FILE
${content}
FILE>>>

Review it per your instructions and return only the JSON object.`
}

// ── Local verify (§9.1c) ─────────────────────────────────────────────────────
// The critic proposes; claudesight adjudicates, offline, against real files.
// Only a small, structured set of checks — anything else stays "unchecked".
export function localVerify(check, root) {
  if (!check || typeof check !== 'object') return { state: 'unchecked' }
  if (!root) return { state: 'unverifiable', checked: 'no project root to resolve against' }
  const rel = typeof check.path === 'string' ? check.path : ''
  // Refuse to climb out of the artifact's root — the same "judged by where it
  // lives" boundary the rest of the app enforces.
  const abs = path.resolve(root, rel)
  const within = abs === root || abs.startsWith(root + path.sep)
  if (!within) return { state: 'unverifiable', checked: `path escapes root: ${rel}` }
  try {
    if (check.kind === 'file_exists' || check.kind === 'referenced_path_exists') {
      const exists = fs.existsSync(abs)
      return { state: exists ? 'confirmed' : 'refuted', checked: `${rel} ${exists ? 'exists' : 'does not exist'}` }
    }
    if (check.kind === 'substring_in_file') {
      if (!fs.existsSync(abs)) return { state: 'refuted', checked: `${rel} does not exist` }
      const hay = fs.readFileSync(abs, 'utf8')
      const found = typeof check.needle === 'string' && check.needle.length > 0 && hay.includes(check.needle)
      return { state: found ? 'confirmed' : 'refuted', checked: `"${check.needle}" ${found ? 'found in' : 'not in'} ${rel}` }
    }
  } catch {
    return { state: 'unverifiable', checked: `could not read ${rel}` }
  }
  return { state: 'unchecked' }
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

// The model sometimes wraps JSON in a ```json fence despite instructions.
function stripFences(text) {
  const m = String(text).match(/```(?:json)?\s*([\s\S]*?)```/)
  return m ? m[1] : text
}
