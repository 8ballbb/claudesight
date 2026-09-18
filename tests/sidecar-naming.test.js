// Every file this app writes beside a user's file carries the product name.
// The rename to claudesight missed all four places writer.js spelled the old
// one, so a save left `settings.json.atlas-<stamp>.bak` in the user's config
// directory — and the project reader, which lists anything it does not
// recognise, then reported that backup back to the user as a mystery
// artifact. The name is a fact about the product, so it lives in one module
// and the reader agrees with the writer by construction.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readForEdit, writeArtifact } from '../src/server/writer.js'
import { buildProjectInventory } from '../src/server/api.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.join(here, '..')

let root, target
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-sidecar-'))
  target = path.join(root, 'CLAUDE.md')
  fs.writeFileSync(target, 'original\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const edit = (content) => writeArtifact({
  target, content, etag: readForEdit(target).etag, kind: 'memory', root,
})

describe('what we write beside a user file', () => {
  it('names the backup after this product, not the one it used to be called', () => {
    edit('updated\n')
    const written = fs.readdirSync(root)
    expect(written.some((f) => f.startsWith('CLAUDE.md.claudesight-') && f.endsWith('.bak')))
      .toBe(true)
    expect(written.filter((f) => f.includes('atlas'))).toEqual([])
  })

  it('still prunes backups left by earlier releases under the old name', () => {
    // A user who edited a file on 0.3.0 has `.atlas-` backups already. If the
    // prune only recognises the new prefix they are never collected again and
    // sit in the config directory forever.
    for (let i = 0; i < 12; i++) {
      fs.writeFileSync(path.join(root, `CLAUDE.md.atlas-2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z.bak`), 'old')
    }
    edit('updated\n')
    const backups = fs.readdirSync(root).filter((f) => f.endsWith('.bak'))
    expect(backups.length).toBe(10)
  })
})

describe('the project reader and the writer agree', () => {
  it('does not list our own backups and locks as artifacts it cannot identify', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-proj-'))
    const dot = path.join(project, '.claude')
    fs.mkdirSync(dot, { recursive: true })
    fs.writeFileSync(path.join(dot, 'settings.json'), '{"model":"opus"}\n')
    fs.writeFileSync(path.join(dot, 'settings.json.claudesight-2026-09-18T04-00-00-000Z.bak'), 'b')
    fs.writeFileSync(path.join(dot, 'settings.json.atlas-2026-09-18T04-00-00-000Z.bak'), 'b')
    fs.writeFileSync(path.join(dot, 'settings.json.claudesight-lock'), '{}')

    const inv = buildProjectInventory(project)
    const other = inv.groups.find((g) => g.kind === 'other')?.items ?? []
    expect(other.map((i) => i.label)).toEqual([])

    // A file the user really did put there is still listed — the filter must
    // exclude our own leavings, not everything that is not a known reader.
    fs.writeFileSync(path.join(dot, 'notes.txt'), 'mine')
    const again = buildProjectInventory(project)
    expect(again.groups.find((g) => g.kind === 'other').items.map((i) => i.label))
      .toEqual(['notes.txt'])

    fs.rmSync(project, { recursive: true, force: true })
  })
})

describe('the former name', () => {
  it('survives in exactly one place, as a legacy constant nobody writes', () => {
    // The guard that was supposed to catch this scanned documentation only,
    // and matched the hyphenated `claude-atlas`. The occurrence that actually
    // shipped was a bare `.atlas-` inside src/. Scan the code, match the bare
    // word, and allow the single deliberate mention.
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return walk(full)
      return /\.(js|jsx|mjs)$/.test(e.name) ? [full] : []
    })
    const shipped = [...walk(path.join(repo, 'src')), ...walk(path.join(repo, 'bin'))]
    const allowed = path.join(repo, 'src/server/sidecar.js')

    for (const file of shipped) {
      const text = fs.readFileSync(file, 'utf8')
      if (file === allowed) continue
      expect(text, `${path.relative(repo, file)} still spells the former name`)
        .not.toMatch(/atlas/i)
    }
    const legacy = fs.readFileSync(allowed, 'utf8')
    expect(legacy.match(/atlas/gi)?.length, 'sidecar.js should name it once, in the legacy list')
      .toBe(1)
  })
})
