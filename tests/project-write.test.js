// The inventory advertised every project file as editable and the writer
// refused all of them: buildProjectInventory classifies against the project
// directory, while the write route classified against the global config root,
// so a project CLAUDE.md came back "Outside the Claude configuration root".
// The UI showed EDITABLE and the save failed — an indicator promising more
// than the page delivers, which is the failure this app exists to prevent.
//
// The fix is that an artifact's root travels with it: whoever built the
// inventory row decides the root the writer judges it by.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildProjectInventory, buildInventory } from '../src/server/api.js'
import { classify } from '../src/server/writability.js'
import { readForEdit, writeArtifact } from '../src/server/writer.js'

let tmp, project
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-pw-')))
  project = path.join(tmp, 'proj')
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# project\n')
  fs.writeFileSync(path.join(project, '.claude', 'settings.json'), '{"model":"opus"}\n')
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('what the inventory promises, the writer honours', () => {
  it('carries the root each artifact should be judged against', () => {
    const inv = buildProjectInventory(project)
    for (const [, entry] of inv.table) {
      expect(entry.root, 'every table entry needs the root it was classified under').toBeTruthy()
    }
  })

  it('agrees with the writer for every row it advertises', () => {
    const inv = buildProjectInventory(project)
    for (const group of inv.groups) {
      for (const item of group.items) {
        const entry = inv.table.get(item.id)
        const verdict = classify({ path: entry.path, kind: entry.kind, root: entry.root })
        expect(verdict.class, `${item.label} advertised ${item.writability.class}`)
          .toBe(item.writability.class)
      }
    }
  })

  it('actually saves a project file, rather than refusing it as foreign', () => {
    const inv = buildProjectInventory(project)
    const row = inv.groups.find((g) => g.kind === 'memory').items[0]
    const entry = inv.table.get(row.id)
    const target = entry.path
    const res = writeArtifact({
      target,
      content: '# edited\n',
      etag: readForEdit(target).etag,
      kind: entry.kind,
      root: entry.root,
    })
    expect(res.ok, JSON.stringify(res)).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe('# edited\n')
  })
})

describe('the global inventory keeps its own root', () => {
  it('still judges global artifacts against the config root', () => {
    const root = path.join(tmp, 'home', '.claude')
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# global\n')
    const inv = buildInventory(root)
    for (const [, entry] of inv.table) expect(entry.root).toBe(root)
  })
})
