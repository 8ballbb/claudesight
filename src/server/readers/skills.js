import path from 'node:path'
import YAML from 'yaml'
import { readDirSafe, readFileSafe, walkForSafe } from '../fsread.js'

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, malformed: false }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { data: {}, malformed: true }
  try {
    return { data: YAML.parse(text.slice(4, end)) ?? {}, malformed: false }
  } catch {
    return { data: {}, malformed: true }
  }
}

// plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
function attributePlugin(root, skillPath) {
  const rel = path.relative(path.join(root, 'plugins', 'cache'), skillPath)
  if (rel.startsWith('..')) return {}
  const parts = rel.split(path.sep)
  return { marketplace: parts[0], plugin: parts[1] }
}

function toSkill(root, file, origin) {
  const raw = readFileSafe(file)
  const fm = raw.state === 'ok'
    ? parseFrontmatter(raw.value)
    : { data: {}, malformed: false }
  const dir = path.dirname(file)
  return {
    name: fm.data.name ?? path.basename(dir),
    description: fm.data.description ?? null,
    path: file,
    origin,
    malformed: fm.malformed,
    unreadable: raw.state === 'ok' ? null : raw.state,
    ...(origin === 'plugin' ? attributePlugin(root, file) : {}),
  }
}

export function readSkills(root) {
  const skills = []
  const denied = []
  const errors = []
  const sources = []

  const userDir = path.join(root, 'skills')
  const userState = readDirSafe(userDir)
  sources.push({ label: 'user', dir: userDir, state: userState.state })
  if (userState.state === 'ok') {
    const w = walkForSafe(userDir, 'SKILL.md', 4)
    denied.push(...w.denied)
    errors.push(...w.errors)
    for (const f of w.found) {
      const origin = f.includes(`${path.sep}synced${path.sep}`) ? 'synced' : 'user'
      skills.push(toSkill(root, f, origin))
    }
  }

  const pluginDir = path.join(root, 'plugins', 'cache')
  const pluginState = readDirSafe(pluginDir)
  sources.push({ label: 'plugins', dir: pluginDir, state: pluginState.state })
  if (pluginState.state === 'ok') {
    const w = walkForSafe(pluginDir, 'SKILL.md', 8)
    denied.push(...w.denied)
    errors.push(...w.errors)
    for (const f of w.found) skills.push(toSkill(root, f, 'plugin'))
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { skills, denied, errors, sources }
}
