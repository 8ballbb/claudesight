// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import Inventory, { Notices } from '../src/ui/Inventory.jsx'

// Everything else in this suite reads the UI as text — it would pass if a
// component stopped rendering entirely. These mount it. The invariant they
// guard is the one the whole project rests on: `ok`, `empty`, `absent`,
// `denied` and `malformed` must stay distinguishable ON THE SCREEN, not just
// in the reader that produced them.

// The open/closed state of every group lives in localStorage by design, so
// without this the second test inherits the first test's clicks and "closed by
// default" passes for the wrong reason.
afterEach(() => { cleanup(); window.localStorage.clear() })

const group = (kind, items) => ({ kind, label: kind, items })
// The shape the server actually builds — checked against buildInventory
// output rather than guessed, because a fixture that does not match is a test
// that proves nothing.
const item = (over = {}) => ({
  id: 'x', kind: 'settings', label: 'config.json', path: '/p/config.json',
  bytes: 10, state: 'ok', cycle: false, depthExceeded: false,
  writability: { class: 'free', reason: 'User-authored configuration' },
  ...over,
})

describe('the five states reach the screen as different sentences', () => {
  it('shows where invalid JSON is, when the parser said', () => {
    render(<Inventory inv={{ groups: [group('settings', [
      item({ state: 'malformed', line: 12, column: 5 }),
    ])] }} />)
    fireEvent.click(screen.getByText(/settings/i))
    expect(screen.getByText(/invalid JSON at line 12, column 5/)).toBeTruthy()
  })

  it('admits when the parser did not say where, instead of inventing line 1', () => {
    render(<Inventory inv={{ groups: [group('settings', [
      item({ state: 'malformed', line: null, column: null }),
    ])] }} />)
    fireEvent.click(screen.getByText(/settings/i))
    expect(screen.getByText(/the parser did not say where/)).toBeTruthy()
  })

  it('never collapses "nothing here" into "could not look"', () => {
    const notes = (state) => {
      const { container } = render(<Notices inv={{ sources: [{ label: 'skills', dir: '/p/skills', state }] }} />)
      const text = container.textContent
      cleanup()
      return text
    }
    const absent = notes('absent')
    const denied = notes('denied')
    const empty = notes('empty')
    expect(absent).toMatch(/does not exist/)
    expect(denied).toMatch(/permission denied/)
    expect(empty).toMatch(/is empty/)
    // The distinction is the product. If any two of these ever read the same,
    // the app is lying in the exact way it exists to prevent.
    expect(new Set([absent, denied, empty]).size).toBe(3)
  })
})

describe('what the inventory renders', () => {
  it('opens no group by default', () => {
    render(<Inventory inv={{ groups: [group('memory', [item({ label: 'CLAUDE.md' })])] }} />)
    expect(screen.queryByText('CLAUDE.md')).toBeNull()
  })

  it('reveals the rows once a group is clicked', () => {
    render(<Inventory inv={{ groups: [group('memory', [item({ label: 'CLAUDE.md' })])] }} />)
    fireEvent.click(screen.getByText(/memory/i))
    expect(screen.getByText('CLAUDE.md')).toBeTruthy()
  })

  it('says so plainly when a project holds nothing, rather than drawing an empty page', () => {
    render(<Inventory inv={{ groups: [group('memory', [])] }} />)
    expect(screen.getByText(/No Claude files here/)).toBeTruthy()
  })
})
