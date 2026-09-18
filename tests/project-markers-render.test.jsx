// @vitest-environment happy-dom
//
// Replaces tests/project-markers-ui.test.js, which read Projects.jsx as a
// string and asserted on fragments like `const MARKERS_SHOWN = 4`. A string
// match cannot tell whether the cap ever reaches the screen — the row could
// stop rendering and every assertion would still pass.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Markers } from '../src/ui/Projects.jsx'

afterEach(cleanup)

const all = { memory: true, settings: true, mcp: true, skills: true, claudeDir: true, pluginSource: true, git: true }

describe('a project row never hides markers silently', () => {
  it('caps what it shows and counts what it did not', () => {
    render(<Markers markers={all} />)
    const overflow = screen.getByText(/^\+\d+$/)
    expect(overflow).toBeTruthy()
    // seven markers set, four shown, so three must be accounted for
    expect(overflow.textContent).toBe('+3')
  })

  it('shows no overflow chip when everything already fits', () => {
    render(<Markers markers={{ memory: true, git: true }} />)
    expect(screen.queryByText(/^\+\d+$/)).toBe(null)
  })

  it('keeps every marker reachable through the overflow title', () => {
    render(<Markers markers={all} />)
    const title = screen.getByText(/^\+\d+$/).getAttribute('title')
    for (const label of ['CLAUDE.md', 'settings', '.mcp.json', 'skills', '.claude', 'plugin source', 'git']) {
      expect(title, `${label} should be reachable`).toContain(label)
    }
  })

  it('renders nothing at all for a project with no markers', () => {
    const { container } = render(<Markers markers={{}} />)
    expect(container.textContent).toBe('')
  })

  it('survives a project row that carries no markers field', () => {
    const { container } = render(<Markers markers={undefined} />)
    expect(container.textContent).toBe('')
  })
})
