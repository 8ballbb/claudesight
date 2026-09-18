// @vitest-environment happy-dom
//
// A join computed and not shown is the same as not computing it. These are
// the two new declared-vs-used answers reaching the screen.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Notices } from '../src/ui/Inventory.jsx'

afterEach(() => { cleanup(); window.localStorage.clear() })

describe('a plugin enabled in settings but not installed', () => {
  it('is named, not left as a silent no-op', () => {
    render(<Notices inv={{ joins: { danglingPlugins: ['ghost@market'] } }} />)
    expect(screen.getByText(/ghost@market/)).toBeTruthy()
  })

  it('says nothing at all when every enabled plugin is installed', () => {
    render(<Notices inv={{ joins: { danglingPlugins: [] } }} />)
    expect(screen.queryByText(/not installed/i)).toBe(null)
  })
})

describe('settings overridden by managed policy', () => {
  it('names the keys of yours that will never take effect', () => {
    render(<Notices inv={{ joins: { managedOverrides: [
      { file: '/Library/Application Support/ClaudeCode/managed-settings.json', state: 'ok', keys: ['model', 'env'] },
    ] } }} />)
    expect(screen.getByText(/model/)).toBeTruthy()
    expect(screen.getByText(/env/)).toBeTruthy()
  })

  it('stays silent when a policy exists but overrides nothing of yours', () => {
    render(<Notices inv={{ joins: { managedOverrides: [{ file: '/p/managed-settings.json', state: 'ok', keys: [] }] } }} />)
    expect(screen.queryByText(/overridden/i)).toBe(null)
  })

  it('reports a policy file it could not read, rather than ignoring it', () => {
    render(<Notices inv={{ joins: { managedOverrides: [{ file: '/p/managed-settings.json', state: 'malformed', keys: [] }] } }} />)
    expect(screen.getByText(/managed-settings\.json/)).toBeTruthy()
  })

  it('says nothing when there is no policy file at all', () => {
    render(<Notices inv={{ joins: { managedOverrides: null } }} />)
    expect(screen.queryByText(/policy/i)).toBe(null)
  })
})
