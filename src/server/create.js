import fs from 'node:fs'
import path from 'node:path'
import { classify } from './writability.js'
import { readSkills } from './readers/skills.js'

// Creating is not writing. writeArtifact reads the target for its
// compare-and-swap, so it cannot create; rather than weaken it with a
// null-etag path, creation uses open(…, 'wx') — O_EXCL is the collision
// check, performed atomically by the kernel.

// Rejected, never sanitised: silently renaming what someone typed is worse
// than refusing it. Kebab-case matches the convention Claude Code's own
// skills use, and the bound keeps the path well inside any filesystem limit.
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

export function validateName(name) {
  if (typeof name !== 'string' || name.length === 0) return 'A name is required.'
  if (!NAME.test(name)) {
    return 'Use lower-case letters, digits and hyphens, starting with a letter or digit (max 64).'
  }
  return null
}

// A description that spans lines would break the YAML frontmatter, and an
// undescribed skill is invisible to the model — the commonest authoring
// mistake — so it is required rather than optional.
function normaliseDescription(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 400)
}

export function skillTemplate(name, description) {
  return `---
name: ${name}
description: ${JSON.stringify(description)}
---

# ${name}

Describe what Claude should do when this skill fires.
`
}

// ── the four kinds that can be created ──────────────────────────────────────
// User-authored, already visible in the app, safe to create, and current.
//
// Commands are deliberately absent. The docs mark `.claude/commands/*.md`
// deprecated in favour of skills at both scopes, and a creator that steers
// people onto a deprecated mechanism is worse than no creator. Hook scripts
// are absent too: creating an executable shell file is the riskiest act in
// this family. Workflows are written by Claude, not by hand.
export const CREATABLE = new Set(['skill', 'agent', 'rule', 'memory', 'settings'])

// Memory has a fixed filename, so it takes no name; the others are named by
// the user and the name IS the identifier Claude Code uses.
const NEEDS_NAME = new Set(['skill', 'agent', 'rule'])
// A skill and an agent are both selected by their description — an
// undescribed one is invisible to the model. A rule is unconditional prose.
const NEEDS_DESCRIPTION = new Set(['skill', 'agent'])

export function targetFor({ kind, root, projectPath, name }) {
  switch (kind) {
    case 'skill': return path.join(root, 'skills', name, 'SKILL.md')
    case 'agent': return path.join(root, 'agents', `${name}.md`)
    case 'rule': return path.join(root, 'rules', `${name}.md`)
    // Both ./CLAUDE.md and ./.claude/CLAUDE.md are valid project memory.
    // The root-level one is what /init writes and where a reader looks.
    case 'memory': return path.join(projectPath ?? root, 'CLAUDE.md')
    // An empty settings.json, so a user with none has somewhere to add the
    // settings they want. In a project it lives under .claude/ (root is the
    // project's .claude), at global scope it is the config root itself.
    case 'settings': return path.join(root, 'settings.json')
    default: return null
  }
}

function agentTemplate(name, description) {
  // The two required fields and nothing else. No permissionMode, no hooks:
  // a file this app creates must never arrive holding a capability the user
  // did not ask for.
  return `---
name: ${name}
description: ${JSON.stringify(description)}
---

You are ${name}. Describe what to do when this subagent is delegated to.
`
}

function ruleTemplate(name) {
  // No `paths:` frontmatter. Adding one would silently scope the rule to
  // files nobody named, and a rule that quietly never applies is worse than
  // one that always does.
  return `# ${name}

Instructions Claude should follow. This rule loads in every session.

To scope it to certain files instead, add frontmatter with a \`paths:\` list.
`
}

function memoryTemplate() {
  return `# Project instructions

Build and test commands, conventions, and anything you would otherwise
re-explain each session.
`
}

function templateFor(kind, name, description) {
  if (kind === 'skill') return skillTemplate(name, description)
  if (kind === 'agent') return agentTemplate(name, description)
  if (kind === 'rule') return ruleTemplate(name)
  // An empty object — nothing this app invented, ready for the form to add to.
  if (kind === 'settings') return '{}\n'
  return memoryTemplate()
}

/**
 * Create one artifact. Returns { ok: true, path, warning? } or
 * { ok: false, error, reason }.
 */
export function createArtifact({ root, projectPath, kind, name, description }) {
  if (!CREATABLE.has(kind)) {
    const reason = kind === 'command'
      ? 'Commands are deprecated in favour of skills — create a skill instead.'
      : `${kind} cannot be created here.`
    return { ok: false, error: 'unsupported-kind', reason }
  }

  if (NEEDS_NAME.has(kind)) {
    const nameError = validateName(name)
    if (nameError) return { ok: false, error: 'invalid-name', reason: nameError }
  }

  const desc = normaliseDescription(description)
  if (NEEDS_DESCRIPTION.has(kind) && desc.length === 0) {
    return {
      ok: false,
      error: 'invalid-description',
      reason: kind === 'agent'
        ? 'A description is required — it is how Claude decides to delegate to this subagent.'
        : 'A description is required — without one Claude cannot tell when to use the skill.',
    }
  }

  const target = targetFor({ kind, root, projectPath, name })

  // The same gate every write goes through, so no crafted name can place a
  // file inside the plugin cache or a managed directory.
  const verdict = classify({ path: target, kind, root: projectPath ?? root })
  if (verdict.class !== 'free') {
    return { ok: false, error: verdict.class, reason: verdict.reason }
  }

  let warning = null
  if (kind === 'skill') {
    // A plugin skill of the same name is not a conflict — both load, because
    // plugin skills are namespaced. Say so rather than refusing.
    try {
      const clash = readSkills(root).skills.find((x) => x.name === name && x.origin === 'plugin')
      if (clash) {
        warning = `${clash.plugin ?? 'A plugin'} already provides a skill called "${name}". `
          + `Both will load — yours as /${name}, theirs as /${clash.plugin}:${name}.`
      }
    } catch { /* the warning is a courtesy, never a gate */ }
  }

  const dir = path.dirname(target)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    if (err.code === 'ENOTDIR') return { ok: false, error: 'not-a-directory', reason: `${dir} is a file.` }
    if (err.code === 'EACCES' || err.code === 'EPERM') return { ok: false, error: 'denied', reason: `Cannot write to ${dir}.` }
    throw err
  }

  let fd
  try {
    fd = fs.openSync(target, 'wx')
  } catch (err) {
    if (err.code === 'EEXIST') return { ok: false, error: 'exists', reason: `${target} already exists.` }
    if (err.code === 'EACCES' || err.code === 'EPERM') return { ok: false, error: 'denied', reason: `Cannot write to ${target}.` }
    throw err
  }

  try {
    fs.writeFileSync(fd, templateFor(kind, name, desc))
  } finally {
    fs.closeSync(fd)
  }

  return { ok: true, path: target, warning }
}
