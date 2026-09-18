// ~/.claude/scheduled-tasks/<name>/SKILL.md holds the prompt behind a Desktop
// scheduled task, and it is user-editable: "Changes take effect on the next
// run." The official .claude directory page does not list it, which is how it
// was missed. The app showed nothing for it, so a prompt that runs on a
// schedule was invisible to the page that exists to list what is configured.
//
// Only the PROMPT lives in this file. Schedule, folder, model and enabled
// state are held by Desktop, so the app lists and edits the prompt and never
// implies it can create a task.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readScheduledTasks } from '../src/server/readers/scheduled.js'

let root
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-sched-'))) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const task = (name, body) => {
  const dir = path.join(root, 'scheduled-tasks', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body)
  return path.join(dir, 'SKILL.md')
}

describe('readScheduledTasks', () => {
  it('is absent, not empty, when no task has ever been created', () => {
    const r = readScheduledTasks(root)
    expect(r.source.state).toBe('absent')
    expect(r.tasks).toEqual([])
  })

  it('distinguishes an existing but empty directory', () => {
    fs.mkdirSync(path.join(root, 'scheduled-tasks'))
    expect(readScheduledTasks(root).source.state).toBe('empty')
  })

  it('lists a task by the name in its frontmatter', () => {
    task('daily-review', '---\nname: daily-review\ndescription: Review yesterday\n---\n\nDo the thing.\n')
    const [t] = readScheduledTasks(root).tasks
    expect(t.name).toBe('daily-review')
    expect(t.description).toBe('Review yesterday')
  })

  it('falls back to the folder name, which is what Desktop keys on', () => {
    task('dep-audit', '---\ndescription: no name field\n---\n\nbody\n')
    expect(readScheduledTasks(root).tasks[0].name).toBe('dep-audit')
  })

  it('keeps a malformed frontmatter visible rather than dropping the task', () => {
    task('broken', '---\nname: [unclosed\n---\n\nbody\n')
    const [t] = readScheduledTasks(root).tasks
    expect(t.malformed).toBe(true)
    expect(t.path).toContain('broken')
  })

  it('ignores a directory with no SKILL.md instead of inventing one', () => {
    fs.mkdirSync(path.join(root, 'scheduled-tasks', 'stray'), { recursive: true })
    expect(readScheduledTasks(root).tasks).toEqual([])
  })

  it('reports the directory it read, so a denied one is not a silent zero', () => {
    task('x', '---\nname: x\n---\n\nbody\n')
    const r = readScheduledTasks(root)
    expect(r.source.dir).toBe(path.join(root, 'scheduled-tasks'))
    expect(r.source.state).toBe('ok')
  })
})

describe('the inventory shows scheduled tasks', () => {
  it('gives each one a row at global scope', async () => {
    const { buildInventory } = await import('../src/server/api.js')
    task('nightly', '---\nname: nightly\ndescription: d\n---\n\nbody\n')
    const inv = buildInventory(root)
    const g = inv.groups.find((x) => x.kind === 'scheduledTask')
    expect(g.items.map((i) => i.label)).toEqual(['nightly'])
  })

  it('says the schedule is not in this file, so the row promises nothing extra', async () => {
    const { buildInventory } = await import('../src/server/api.js')
    task('nightly', '---\nname: nightly\ndescription: d\n---\n\nbody\n')
    const [row] = buildInventory(root).groups.find((x) => x.kind === 'scheduledTask').items
    expect(row.note).toMatch(/schedule/i)
  })
})
