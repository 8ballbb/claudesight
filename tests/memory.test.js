import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readMemory, flattenMemory } from '../src/server/readers/memory.js'

let dir
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-memory-'))
  // The author's real shape: CLAUDE.md is 8 bytes and imports everything
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '@NOTES.md\n')
  fs.writeFileSync(path.join(dir, 'NOTES.md'), '# Notes\n\nProject conventions.\n@nested.md\n')
  fs.writeFileSync(path.join(dir, 'nested.md'), 'deep content\n')
  fs.writeFileSync(path.join(dir, 'loopA.md'), '@loopB.md\n')
  fs.writeFileSync(path.join(dir, 'loopB.md'), '@loopA.md\n')
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('readMemory', () => {
  it('resolves @-imports so a tiny CLAUDE.md is not the whole story', () => {
    // The real case this came from: a global CLAUDE.md holding one @-import
    // and nothing else. Its own size says almost nothing about what is loaded.
    const node = readMemory(path.join(dir, 'CLAUDE.md'))
    expect(node.bytes).toBeLessThan(20)
    expect(node.imports).toHaveLength(1)
    expect(node.imports[0].path).toBe(path.join(dir, 'NOTES.md'))
    expect(node.imports[0].content).toContain('Project conventions')
  })

  it('resolves transitively', () => {
    const all = flattenMemory(readMemory(path.join(dir, 'CLAUDE.md')))
    expect(all.map((n) => path.basename(n.path))).toEqual(['CLAUDE.md', 'NOTES.md', 'nested.md'])
  })

  it('reports a missing import as absent instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'broken.md'), '@ghost.md\n')
    expect(readMemory(path.join(dir, 'broken.md')).imports[0].state).toBe('absent')
  })

  it('terminates on an import cycle and flags it', () => {
    const all = flattenMemory(readMemory(path.join(dir, 'loopA.md')))
    expect(all.some((n) => n.cycle)).toBe(true)
  })

  it('follows imports four levels deep, then stops with a depthExceeded stub', () => {
    for (let i = 0; i < 8; i++) {
      fs.writeFileSync(path.join(dir, `c${i}.md`), `@c${i + 1}.md\n`)
    }
    fs.writeFileSync(path.join(dir, 'c8.md'), 'end\n')

    const all = flattenMemory(readMemory(path.join(dir, 'c0.md')))
    const read = all.filter((n) => n.content.length > 0).map((n) => path.basename(n.path))

    expect(read).toEqual(['c0.md', 'c1.md', 'c2.md', 'c3.md', 'c4.md'])
    expect(all.filter((n) => n.depthExceeded)).toHaveLength(1)
  })
})
