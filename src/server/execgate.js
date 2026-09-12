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
