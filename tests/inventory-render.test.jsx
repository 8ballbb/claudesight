// @vitest-environment happy-dom
//
// happy-dom, not jsdom: jsdom pulls in undici, which calls
// webidl.util.markAsUncloneable — absent on Node 20, so the whole worker
// fails to start there while passing on Node 22. The engines floor is 20.
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
// id defaults from the label: two fixture items sharing an id are two items
// sharing a React key, which silently renders one of them.
const item = (over = {}) => ({
  id: over.label ?? 'x', kind: 'settings', label: 'config.json', path: '/p/config.json',
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

describe('writability is stated once per band, not once per row', () => {
  const owned = (label) => item({
    label, plugin: 'acme-tools',
    writability: { class: 'redirect', reason: 'Owned by a plugin' },
  })

  it('states "read-only" a number of times that does not grow with the rows', () => {
    // The real property: adding items to an owner band must not add the word.
    // Counting exact occurrences would just encode today's layout.
    const count = (n) => {
      const items = Array.from({ length: n }, (_, i) => owned(`s${i}`))
      render(<Inventory inv={{ groups: [group('skill', items)] }} />)
      fireEvent.click(screen.getByText(/skill/i))
      fireEvent.click(screen.getByText('acme-tools'))
      expect(screen.getByText('s0')).toBeTruthy()       // the band really is open
      const seen = screen.queryAllByText('read-only').length
      cleanup(); window.localStorage.clear()
      return seen
    }
    expect(count(6)).toBe(count(2))
  })

  it('still says it, on the band itself', () => {
    render(<Inventory inv={{ groups: [group('skill', [owned('one')])] }} />)
    fireEvent.click(screen.getByText(/skill/i))
    expect(screen.getAllByText('read-only').length).toBeGreaterThan(0)
  })

  it('keeps per-row chips in your own band, where the class actually varies', () => {
    const mine = [
      item({ label: 'notes.md', writability: { class: 'free', reason: 'yours' } }),
      item({ label: 'hook.sh', writability: { class: 'exec', reason: 'executable' } }),
    ]
    render(<Inventory inv={{ groups: [group('scripts', mine)] }} />)
    fireEvent.click(screen.getByText(/scripts/i))
    // The group header also prints "editable", so the row chip makes two.
    expect(screen.getAllByText('editable').length).toBeGreaterThan(1)
    expect(screen.getByText('executable')).toBeTruthy()
  })

  it('never hides an alarm, which is a fact about one row', () => {
    render(<Inventory inv={{ groups: [group('skill', [
      { ...owned('bad'), broken: true },
    ])] }} />)
    fireEvent.click(screen.getByText(/skill/i))
    fireEvent.click(screen.getByText('acme-tools'))
    expect(screen.getByText('broken')).toBeTruthy()
  })
})

describe('the limits of reading a hook without running it', () => {
  const script = (over = {}) => item({
    kind: 'hookScript', label: 'guard.sh',
    writability: { class: 'exec', reason: 'executable' }, ...over,
  })

  it('always says what it did not check, even when every hook looks fine', () => {
    render(<Inventory inv={{ groups: [group('scripts', [script()])] }} />)
    fireEvent.click(screen.getByText(/scripts/i))
    expect(screen.getByText(/Not checked: exit code, output shape/)).toBeTruthy()
  })

  it('says it whether or not a hook is broken, so a clean list cannot read as a clean bill of health', () => {
    render(<Inventory inv={{ groups: [group('scripts', [script({ broken: true, state: 'absent' })])] }} />)
    fireEvent.click(screen.getByText(/scripts/i))
    expect(screen.getByText(/Nothing here is executed/)).toBeTruthy()
  })

  it('does not put it on unrelated groups', () => {
    render(<Inventory inv={{ groups: [group('memory', [item({ label: 'CLAUDE.md' })])] }} />)
    fireEvent.click(screen.getByText(/memory/i))
    expect(screen.queryByText(/Not checked/)).toBeNull()
  })

  it('shows what a hook can do to a command, in the conditional', () => {
    render(<Inventory inv={{ groups: [group('scripts', [script({
      capabilities: [{ id: 'auto-approves', label: 'can auto-approve' }],
    })])] }} />)
    fireEvent.click(screen.getByText(/scripts/i))
    expect(screen.getByText('can auto-approve')).toBeTruthy()
  })
})

describe('hook rows say true things about themselves', () => {
  // All three of these were found by looking at the page, not by the suite.
  const hookRow = (over = {}) => item({
    kind: 'hookScript', keyPath: 'hooks.PreToolUse.0.hooks.0.command',
    writability: { class: 'exec', reason: 'executable' }, ...over,
  })
  const open = (row) => {
    render(<Inventory inv={{ groups: [group('scripts', [row])] }} />)
    fireEvent.click(screen.getByText(/scripts/i))
  }

  it('explains an unwalkable declaration in its own words, not as a JSON parse error', () => {
    // meta() checked malformed before it checked the kind, so a hooks block of
    // the wrong shape was described as "invalid JSON — the parser did not say
    // where". The settings file parsed perfectly.
    open(hookRow({
      label: 'hooks.SessionStart', keyPath: 'hooks.SessionStart', state: 'malformed',
      broken: true, ownScript: false, reason: 'the value here is not a list of matchers',
    }))
    expect(screen.getByText(/not a list of matchers/)).toBeTruthy()
    expect(screen.queryByText(/invalid JSON/)).toBeNull()
  })

  it('does not call a row executable when it has no script of its own', () => {
    // These rows point at settings.json, which is not a script.
    open(hookRow({ label: 'hooks.PostToolUse', inline: true, state: 'not-declared', ownScript: false }))
    expect(screen.queryByText('executable')).toBeNull()
  })

  it('says "inline" rather than leaking the reader\'s word for it', () => {
    open(hookRow({ label: 'hooks.PostToolUse', inline: true, state: 'not-declared', ownScript: false }))
    expect(screen.getByText('inline')).toBeTruthy()
    expect(screen.queryByText('not-declared')).toBeNull()
  })

  it('still calls a real script executable', () => {
    open(hookRow({ label: 'guard.sh', state: 'ok', ownScript: true }))
    expect(screen.getByText('executable')).toBeTruthy()
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
