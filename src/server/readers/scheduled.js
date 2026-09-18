import path from 'node:path'
import { readDirSafe, readFileSafe } from '../fsread.js'
import { parseFrontmatter } from './shared.js'

// Desktop scheduled tasks keep their prompt at
// <root>/scheduled-tasks/<task-name>/SKILL.md — the same shape as a skill,
// and user-editable: changes take effect on the next run.
//
// It is documented on the desktop-scheduled-tasks page and NOT listed on the
// page that otherwise inventories the .claude directory, which is how it went
// unnoticed here. A prompt that runs on a schedule, unattended, is exactly the
// sort of configuration this app exists to surface.
//
// Only the prompt lives in this file. The schedule, working folder, model and
// enabled state are Desktop's own state, so the row says so: listing a task
// without that caveat would imply the app can tell you when it runs, or that
// creating the file creates a task. Neither is true.
export function readScheduledTasks(root) {
  const dir = path.join(root, 'scheduled-tasks')
  const listing = readDirSafe(dir)
  const source = { label: 'scheduled tasks', dir, state: listing.state }
  if (listing.state !== 'ok') return { tasks: [], source }

  const tasks = []
  for (const entry of listing.value) {
    if (!entry.isDirectory()) continue
    const file = path.join(dir, entry.name, 'SKILL.md')
    const raw = readFileSafe(file)
    // A directory without a SKILL.md is not a task; inventing a row for it
    // would put something on screen that Desktop does not know about.
    if (raw.state === 'absent') continue
    const fm = raw.state === 'ok' ? parseFrontmatter(raw.value) : { data: {}, malformed: false }
    tasks.push({
      name: fm.data.name ?? entry.name,
      description: fm.data.description ?? null,
      path: file,
      malformed: fm.malformed,
      unreadable: raw.state === 'ok' ? null : raw.state,
    })
  }
  if (tasks.length === 0 && source.state === 'ok') source.state = 'empty'
  return { tasks, source }
}
