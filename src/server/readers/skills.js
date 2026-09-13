import path from 'node:path'
import { readDirSafe, readFileSafe, walkForSafe } from '../fsread.js'
import { parseFrontmatter, attributePlugin, visibleUnder } from './shared.js'

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
  sources.push({ label: 'user skills', dir: userDir, state: userState.state })
  if (userState.state === 'ok') {
    const w = walkForSafe(userDir, 'SKILL.md', 4)
    denied.push(...w.denied)
    errors.push(...w.errors)
    for (const f of visibleUnder(userDir, w.found)) {
      const origin = f.includes(`${path.sep}synced${path.sep}`) ? 'synced' : 'user'
      skills.push(toSkill(root, f, origin))
    }
  }

  const pluginDir = path.join(root, 'plugins', 'cache')
  const pluginState = readDirSafe(pluginDir)
  sources.push({ label: 'plugin skills', dir: pluginDir, state: pluginState.state })
  if (pluginState.state === 'ok') {
    const w = walkForSafe(pluginDir, 'SKILL.md', 8)
    denied.push(...w.denied)
    errors.push(...w.errors)
    for (const f of visibleUnder(pluginDir, w.found)) skills.push(toSkill(root, f, 'plugin'))
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { skills, denied, errors, sources }
}
