// §4.1 has always specified `~/.claude/rules/`. Only buildProjectInventory
// ever read a rules directory, so a user-scope rule — loaded into every
// session on the machine — was absent from the page that lists what is
// loaded. The same shape of gap as the ancestor one, at the other scope.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildInventory } from '../src/server/api.js'

let root
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-grules-'))) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const rule = (rel, body = '# rule\n') => {
  const f = path.join(root, 'rules', rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, body)
}
const rules = () => buildInventory(root).groups.find((g) => g.kind === 'rule')?.items ?? []

describe('user-scope rules', () => {
  it('are listed', () => {
    rule('testing.md')
    expect(rules().map((r) => r.label)).toEqual(['testing'])
  })

  it('are found in nested directories, which Claude Code discovers recursively', () => {
    rule('frontend/react.md')
    expect(rules().map((r) => r.label)).toContain(path.join('frontend', 'react'))
  })

  it('ignores files that are not markdown', () => {
    rule('notes.txt')
    expect(rules()).toEqual([])
  })

  it('reports the directory as a source, so a denied one is not a silent zero', () => {
    rule('x.md')
    const src = buildInventory(root).sources.find((s) => s.label === 'user rules')
    expect(src.state).toBe('ok')
  })

  it('says absent when there is no rules directory, rather than nothing at all', () => {
    const src = buildInventory(root).sources.find((s) => s.label === 'user rules')
    expect(src.state).toBe('absent')
  })
})
