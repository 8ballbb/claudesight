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

describe('projects page: list beside detail, and it remembers', () => {
  const jsx = read('Projects.jsx')
  const css = fs.readFileSync('src/ui/app.module.css', 'utf8')

  it('lays the list beside the detail instead of stacking them', () => {
    expect(jsx).toContain('s.projectsSplit')
    expect(css).toContain('.projectsSplit')
    expect(css).toMatch(/\.projectsSplit\s*{[^}]*grid-template-columns/)
  })

  it('keeps the stacked layout and its scroll below the breakpoint', () => {
    // The scrollIntoView treated the symptom of the stacked layout. It is still
    // needed there, and only there.
    expect(jsx).toContain('stacked() && detail.current')
    expect(css).toContain('@media (max-width: 900px)')
  })

  it('remembers the last project, the way fold state is remembered', () => {
    expect(jsx).toContain("const LAST_PROJECT = 'claudesight.lastProject'")
    expect(jsx).toContain('window.localStorage.setItem(LAST_PROJECT, project.path)')
  })

  it('restores only a project that is still discovered and still on disk', () => {
    // A remembered path that has since gone must not come back as a selection
    // the page cannot fill.
    expect(jsx).toMatch(/found\.projects\.find\(\(p\) => p\.path === last && p\.exists\)/)
  })

  it('restores at most once, so it cannot fight a later choice', () => {
    expect(jsx).toContain('if (!found || restored.current) return')
  })

  it('says why the detail pane is empty rather than showing a blank column', () => {
    expect(jsx).toContain('Pick a project to see what is configured in it.')
  })

  it('keeps a project row on one line — the full path lives on a title', () => {
    expect(css).toContain('.projectList .rowTail { flex-wrap: nowrap')
    expect(jsx).toContain('title={p.path}')
  })
})
