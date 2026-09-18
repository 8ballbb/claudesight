// @vitest-environment happy-dom
//
// These behaviours were previously asserted by reading the JSX as a string —
// `expect(src).toContain('title={p}')` and friends. Such a test passes when
// the component has stopped rendering entirely, which is how a feature once
// shipped inert here with a full green suite. Every assertion below mounts
// the component and reads the screen.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import Inventory, { Notices } from '../src/ui/Inventory.jsx'

afterEach(() => { cleanup(); window.localStorage.clear() })

const item = (over = {}) => ({
  id: over.label ?? 'x', kind: 'settings', label: 'settings.json', path: '/p/settings.json',
  bytes: 10, state: 'ok', cycle: false, depthExceeded: false,
  writability: { class: 'free', reason: 'User-authored configuration' },
  ...over,
})
const group = (kind, items) => ({ kind, label: kind, items })
const open = (re) => fireEvent.click(screen.getByText(re))

describe('a directory that could not be read', () => {
  it('shows the paths themselves, not just a count', () => {
    render(<Notices inv={{ denied: ['/locked/one', '/locked/two'] }} />)
    expect(screen.getByText('/locked/one')).toBeTruthy()
    expect(screen.getByText('/locked/two')).toBeTruthy()
  })

  it('gives each path a title, so a truncated one is still recoverable', () => {
    render(<Notices inv={{ denied: ['/very/long/path/that/may/truncate'] }} />)
    const li = screen.getByText('/very/long/path/that/may/truncate')
    expect(li.getAttribute('title')).toBe('/very/long/path/that/may/truncate')
  })

  it('shows a short list outright, without making you ask for it', () => {
    render(<Notices inv={{ denied: ['/a', '/b'] }} />)
    expect(screen.getByText('/a')).toBeTruthy()
  })

  it('folds a long list behind a control rather than flooding the page', () => {
    const many = ['/a', '/b', '/c', '/d', '/e']
    render(<Notices inv={{ denied: many }} />)
    expect(screen.queryByText('/e')).toBe(null)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('/e')).toBeTruthy()
  })

  it('carries the errno beside a path that failed unexpectedly', () => {
    render(<Notices inv={{ errors: [{ path: '/broken', errno: 'EISDIR' }] }} />)
    expect(screen.getByText(/EISDIR/)).toBeTruthy()
    expect(screen.getByText(/\/broken/)).toBeTruthy()
  })
})

describe('a settings file Claude Code cannot parse', () => {
  it('says where the parse failed instead of reporting a key count', () => {
    render(<Inventory inv={{ groups: [group('settings', [
      item({ state: 'malformed', keys: 0, line: 12, column: 5 }),
    ])] }} />)
    open(/settings/i)
    expect(screen.getByText(/invalid JSON at line 12, column 5/)).toBeTruthy()
  })

  it('admits it when the parser gave no position, rather than claiming line 1', () => {
    render(<Inventory inv={{ groups: [group('settings', [
      item({ state: 'malformed', keys: 0, line: null, column: null }),
    ])] }} />)
    open(/settings/i)
    expect(screen.getByText(/the parser did not say where/)).toBeTruthy()
  })

  it('marks it as broken, not as a passing caution', () => {
    render(<Inventory inv={{ groups: [group('settings', [
      item({ state: 'malformed', keys: 0 }),
    ])] }} />)
    open(/settings/i)
    const chip = screen.getByText('malformed')
    expect(chip.className).toMatch(/alarm/)
  })
})

describe('a plugin whose installed version disagrees with its manifest', () => {
  it('names both versions rather than saying only "drift"', () => {
    render(<Inventory inv={{ groups: [group('plugin', [
      item({
        kind: 'plugin', label: 'thing', drift: 'drifted', plugin: 'acme',
        recordedVersion: '1.2.0', manifestVersion: '1.3.0',
        writability: { class: 'readonly', reason: 'Owned by a plugin' },
      }),
    ])] }} />)
    open(/plugins/i)
    open('acme')   // read-only rows sit inside an owner band, collapsed by default
    expect(screen.getByText(/manifest says/)).toBeTruthy()
    expect(screen.getByText(/1\.2\.0 installed, manifest says 1\.3\.0/)).toBeTruthy()
  })
})
