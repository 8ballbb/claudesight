import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

// The guard is a hook, and this repo has no DOM test environment. What can be
// checked without one — and what actually regressed before — is that no exit
// path bypasses it. Every one of these five used to call setOpen directly.
const read = (f) => fs.readFileSync(`src/ui/${f}`, 'utf8')

describe('unsaved-edit guard: no unguarded exit remains', () => {
  it('routes the editor close button through the guard on both pages', () => {
    for (const f of ['App.jsx', 'Projects.jsx']) {
      expect(read(f), f).toContain('onClose={() => guard.request(null)}')
      expect(read(f), f).not.toContain('onClose={() => setOpen(null)}')
    }
  })

  it('routes clicking another artifact through the guard — it remounts the editor', () => {
    for (const f of ['App.jsx', 'Projects.jsx']) {
      expect(read(f), f).toContain('onOpen={guard.request}')
      expect(read(f), f).not.toContain('onOpen={setOpen}')
    }
  })

  it('routes both nav tabs through the guard, not just the close paths', () => {
    const src = read('App.jsx')
    expect(src).toContain("guard.request(null, () => setPage('global'))")
    expect(src).toContain("guard.request(null, () => setPage('projects'))")
    expect(src).not.toMatch(/setPage\('(global|projects)'\); setOpen\(null\)/)
  })

  it('routes switching project through the guard', () => {
    expect(read('Projects.jsx')).toMatch(/setSelected\(project\)\s*\n\s*guard\.request\(null\)/)
  })

  it('keeps Escape in one place, where it can tell close from dismiss', () => {
    // App had its own listener calling setOpen(null); two listeners would race
    // and the second would discard the prompt the first had just raised.
    expect(read('App.jsx')).not.toContain("e.key === 'Escape'")
    expect(read('closeGuard.jsx')).toContain("e.key !== 'Escape'")
  })

  it('reports dirty upward rather than deciding in the editor', () => {
    // Editor is unmounted by the very transitions being guarded, so it cannot
    // own the decision.
    expect(read('Editor.jsx')).toContain('onDirtyChange?.(Boolean(dirty))')
    expect(read('closeGuard.jsx')).toContain('dirty.current')
  })

  it('never references a bare `open` — window.open is always truthy', () => {
    // Removing local `open` state left `${open ? s.split : ''}` resolving to
    // window.open, so the split layout was permanently applied and nothing
    // errored. A free identifier that happens to be a browser global is the
    // one kind of undefined that neither the linter nor the build complains about.
    for (const f of ['App.jsx', 'Projects.jsx']) {
      const bare = read(f).match(/\$\{open[\s?.]/g) ?? []
      expect(bare, `${f} uses a bare open`).toHaveLength(0)
    }
  })

  it('offers keeping the edits before discarding them', () => {
    const src = read('closeGuard.jsx')
    expect(src).toContain('Keep editing')
    expect(src).toContain('Discard and close')
    expect(src.indexOf('Keep editing')).toBeLessThan(src.indexOf('Discard and close'))
  })
})
