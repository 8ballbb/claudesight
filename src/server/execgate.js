// Verified against Claude Code 2.1.231: every one of these executes shell or
// controls process startup. Gating on artifact kind (r2 gated `hook` only)
// missed seven of them. Spec §9.3.
const EXEC_KEY_PATTERNS = [
  /^hooks\..+\.command$/,
  /^statusLine\.command$/,
  /^apiKeyHelper$/,
  /Helper$/,
  /AuthRefresh$/,
  /^awsCredentialExport$/,
  /^defaultShell$/,
  /^env\..+/,
  /^mcpServers\..+\.(command|args|env)(\..+)?$/,
]

// Keys that gate protections rather than carry commands. A boolean flip here
// cannot be caught by looksExecutable, which requires a string.
const PROTECTION_KEY_PATTERNS = [
  /^sandbox(\..+)?$/,
  /^disableSkillShellExecution$/,
  /^disableAllHooks$/,
  /^permissions(\..+)?$/,
  /^allowedHttpHookUrls(\..+)?$/,
]

const SHELL_META = /[;&|`$(){}<>\n]/
const PATHISH = /^(~|\.{0,2}\/|\/)/

export const isExecutableKeyPath = (keyPath) =>
  EXEC_KEY_PATTERNS.some((re) => re.test(keyPath))

export const isProtectionKeyPath = (keyPath) =>
  PROTECTION_KEY_PATTERNS.some((re) => re.test(keyPath))

export function looksExecutable(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  return SHELL_META.test(value) || PATHISH.test(value)
}

function flatten(obj, prefix = '', out = new Map()) {
  if (obj === null || typeof obj !== 'object') { out.set(prefix, obj); return out }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out))
    return out
  }
  for (const [k, v] of Object.entries(obj)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

export function execChanges(before, after) {
  const a = flatten(before ?? {})
  const b = flatten(after ?? {})
  const changes = []
  for (const keyPath of new Set([...a.keys(), ...b.keys()])) {
    const oldValue = a.has(keyPath) ? a.get(keyPath) : null
    const newValue = b.has(keyPath) ? b.get(keyPath) : null
    if (oldValue === newValue) continue

    const byKey = isExecutableKeyPath(keyPath)
    const byShape = looksExecutable(newValue)
    const byProtection = isProtectionKeyPath(keyPath)
    if (!byKey && !byShape && !byProtection) continue

    changes.push({
      keyPath,
      before: oldValue,
      after: newValue,
      reason: byKey ? 'known-executable-key'
        : byProtection ? 'protection-change'
        : 'executable-value-shape',
    })
  }
  return changes
}

// ── markdown frontmatter ────────────────────────────────────────────────────
// A subagent file is markdown, so it never reached the JSON gate above — yet
// its YAML frontmatter can carry `hooks:`, which Claude Code runs as shell,
// and `permissionMode: bypassPermissions`, which stops it asking at all. Those
// are the same capabilities settings.json is gated for, reachable through a
// file the gate did not look at.
//
// This is a line scan, not a YAML parser, and it claims no more than a scan
// can know — the same footing as capabilitiesOf() in readers/settings.js. It
// reads only the frontmatter block, so prose in the body is never mistaken for
// configuration.

export function frontmatterOf(text) {
  if (typeof text !== 'string') return ''
  if (!text.startsWith('---')) return ''
  const rest = text.slice(text.indexOf('\n') + 1)
  const end = rest.search(/^---\s*$/m)
  if (end === -1) return ''
  return rest.slice(0, end)
}

// Permission modes that stop Claude Code asking before it acts. `plan`,
// `default` and `manual` still prompt, so they are not capability changes.
const SILENT_MODES = new Set(['bypassPermissions', 'dontAsk'])

function capabilitiesIn(text) {
  const found = new Map()
  for (const raw of frontmatterOf(text).split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*#/.test(line)) continue
    if (/^hooks\s*:/.test(line)) found.set('hooks', 'declared')
    const mode = /^permissionMode\s*:\s*(["']?)([A-Za-z]+)\1\s*$/.exec(line)
    if (mode && SILENT_MODES.has(mode[2])) found.set('permissionMode', mode[2])
  }
  return found
}

// What this change ADDS. A capability already present and unchanged is not
// re-confirmed: the gate is for the moment a capability appears or changes,
// not a toll on every later edit.
export function capabilityChanges(before, after) {
  const was = capabilitiesIn(before)
  const now = capabilitiesIn(after)
  const out = []
  for (const [key, value] of now) {
    if (was.get(key) === value) continue
    out.push({
      keyPath: key,
      before: was.get(key) ?? null,
      after: value,
      reason: key === 'hooks'
        ? 'declares hooks — shell commands Claude Code runs'
        : 'turns off the approval prompt',
    })
  }
  return out
}
