import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { diffText, MAX_LINES } from '../src/server/linediff.js'
import { createVersion, compareVersion } from '../src/server/versions.js'

const NL = '\n'
const NUL = String.fromCharCode(0)

describe('diffText', () => {
  it('says identical rather than returning an empty diff', () => {
    // An empty line list would render as nothing, which reads as "no answer"
    // rather than "no difference".
    expect(diffText('a' + NL + 'b', 'a' + NL + 'b')).toMatchObject({ state: 'identical', lines: [] })
  })

  it('counts what changed', () => {
    const d = diffText('one' + NL + 'two', 'one' + NL + 'TWO' + NL + 'three')
    expect(d.state).toBe('changed')
    expect(d.delCount).toBe(1)
    expect(d.addCount).toBe(2)
    expect(d.lines[0]).toEqual({ type: 'same', text: 'one' })
  })

  it('never claims identical when a side could not be read', () => {
    // The dangerous case: null on both sides is not "the same".
    expect(diffText(null, null).state).toBe('unverifiable')
    expect(diffText(null, '').state).toBe('unverifiable')
    expect(diffText('', null).state).toBe('unverifiable')
  })

  it('names which side it could not read', () => {
    expect(diffText(null, 'x', { beforeLabel: 'the version' }).reason).toContain('the version')
    expect(diffText('x', null, { afterLabel: 'the current file' }).reason).toContain('the current file')
  })

  it('refuses binary rather than diffing bytes as lines', () => {
    const r = diffText('a' + NUL + 'b', 'c')
    expect(r.state).toBe('unverifiable')
    expect(r.reason).toContain('binary')
  })

  it('refuses an oversized file and states the size it refused', () => {
    const huge = Array(MAX_LINES + 100).fill('x').join(NL)
    const r = diffText(huge, 'y')
    expect(r.state).toBe('unverifiable')
    expect(r.reason).toContain(String(MAX_LINES + 100))
    expect(r.lines).toHaveLength(0) // never a truncated prefix passed off as the whole
  })

  it('handles a file with no trailing newline and one line', () => {
    expect(diffText('only', 'only').state).toBe('identical')
    expect(diffText('only', 'other').state).toBe('changed')
  })
})

describe('compareVersion', () => {
  let home, target
  const setup = () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-diff-'))
    target = path.join(home, 'CLAUDE.md')
    fs.writeFileSync(target, 'first' + NL + 'second' + NL)
  }

  it('compares a stored version against what is on disk now', () => {
    setup()
    const v = createVersion(target, 'before edit', home)
    fs.writeFileSync(target, 'first' + NL + 'CHANGED' + NL)
    const d = compareVersion(target, v.version.id, home)
    expect(d.state).toBe('changed')
    // add/del are stated from the point of view of the action: restoring this
    // version would bring 'second' back and take 'CHANGED' away.
    expect(d.lines.some((l) => l.type === 'add' && l.text === 'second')).toBe(true)
    expect(d.lines.some((l) => l.type === 'del' && l.text === 'CHANGED')).toBe(true)
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('says identical when nothing has changed since the version', () => {
    setup()
    const v = createVersion(target, null, home)
    expect(compareVersion(target, v.version.id, home).state).toBe('identical')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('is unverifiable, not identical, when the file has since been deleted', () => {
    setup()
    const v = createVersion(target, null, home)
    fs.rmSync(target)
    const d = compareVersion(target, v.version.id, home)
    expect(d.state).toBe('unverifiable')
    expect(d.reason).toContain('no longer exists')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('is unverifiable for a version id that does not exist', () => {
    setup()
    const d = compareVersion(target, 'not-a-real-version', home)
    expect(d.state).toBe('unverifiable')
    expect(d.reason).toContain('snapshot')
    fs.rmSync(home, { recursive: true, force: true })
  })
})

describe('one direction convention, used by both surfaces', () => {
  const src = fs.readFileSync('src/ui/Editor.jsx', 'utf8')

  it('states the verb rather than a neutral change count', () => {
    expect(src).toContain('verb="Restoring"')
    expect(src).toContain('verb="Saving"')
    expect(src).toContain('{verb} would add')
  })

  it('never flips the marks — add is always what the action adds', () => {
    // The restore diff used to be computed backwards and corrected in the view.
    // That works until someone reads one half of it without the other.
    expect(src).toContain("l.type === 'add' ? '+'")
    expect(src).not.toContain("l.type === 'add' ? '−'")
  })

  it('runs the engine in the browser rather than per keystroke over HTTP', () => {
    expect(src).toContain("import { diffText } from '../server/linediff.js'")
    expect(fs.readFileSync('src/server/linediff.js', 'utf8')).not.toContain('Buffer.byteLength')
  })

  it('puts the content diff inside the confirmation for executable files', () => {
    // The key list says which settings become executable; it says nothing
    // about the rest of the file you are agreeing to install.
    expect(src).toMatch(/!confirm\.versionId && saveDiff/)
  })

  it('offers the preview only when there is an unsaved change', () => {
    expect(src).toContain('{preview ? \'Hide changes\' : \'Preview changes\'}')
    expect(src).toMatch(/preview && dirty/)
  })
})
