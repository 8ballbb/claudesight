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

/**
 * Create a user-scope skill at <root>/skills/<name>/SKILL.md.
 * Returns { ok: true, path, warning? } or { ok: false, error, reason }.
 */
export function createSkill({ root, name, description }) {
  const nameError = validateName(name)
  if (nameError) return { ok: false, error: 'invalid-name', reason: nameError }

  const desc = normaliseDescription(description)
  if (desc.length === 0) {
    return {
      ok: false,
      error: 'invalid-description',
      reason: 'A description is required — without one Claude cannot tell when to use the skill.',
    }
  }

  const dir = path.join(root, 'skills', name)
  const target = path.join(dir, 'SKILL.md')

  // The same gate every write goes through, so no crafted name can place a
  // file inside the plugin cache or a managed directory.
  const verdict = classify({ path: target, kind: 'skill', root })
  if (verdict.class !== 'free') {
    return { ok: false, error: verdict.class, reason: verdict.reason }
  }

  // A plugin skill of the same name is not a conflict — both load, because
  // plugin skills are namespaced. Say so rather than refusing.
  let warning = null
  try {
    const clash = readSkills(root).skills.find((s) => s.name === name && s.origin === 'plugin')
    if (clash) {
      warning = `${clash.plugin ?? 'A plugin'} already provides a skill called "${name}". `
        + `Both will load — yours as /${name}, theirs as /${clash.plugin}:${name}.`
    }
  } catch { /* the warning is a courtesy, never a gate */ }

  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    if (err.code === 'ENOTDIR') {
      return { ok: false, error: 'not-a-directory', reason: `${path.join(root, 'skills')} is a file.` }
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { ok: false, error: 'denied', reason: `Cannot write to ${dir}.` }
    }
    throw err
  }

  let fd
  try {
    fd = fs.openSync(target, 'wx')
  } catch (err) {
    if (err.code === 'EEXIST') {
      return { ok: false, error: 'exists', reason: `${target} already exists.` }
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { ok: false, error: 'denied', reason: `Cannot write to ${target}.` }
    }
    throw err
  }

  try {
    fs.writeFileSync(fd, skillTemplate(name, desc))
  } finally {
    fs.closeSync(fd)
  }

  return { ok: true, path: target, warning }
}
