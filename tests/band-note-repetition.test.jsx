// @vitest-environment happy-dom
//
// "read-only" is one fact about a group. The header states it, and every band
// inside restated it — ten times on a skills list with nine plugin bands.
// bandsFor already carried two rounds of fixes for saying it twice INSIDE a
// band; nobody checked it against the header above them.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import Inventory from '../src/ui/Inventory.jsx'

afterEach(() => { cleanup(); window.localStorage.clear() })

const locked = (label, plugin) => ({
  id: label, kind: 'skill', label, path: `/p/${label}`, bytes: 1, state: 'ok',
  cycle: false, depthExceeded: false, plugin,
  writability: { class: 'plugin', reason: 'Owned by a plugin' },
})
const free = (label) => ({
  id: label, kind: 'skill', label, path: `/p/${label}`, bytes: 1, state: 'ok',
  cycle: false, depthExceeded: false,
  writability: { class: 'free', reason: 'User-authored' },
})

const count = (re) => screen.queryAllByText(re).length

describe('a group that is entirely read-only', () => {
  it('says so once, not once per band', () => {
    render(<Inventory inv={{ groups: [{ kind: 'skill', label: 'skill', items: [
      locked('a', 'alpha'), locked('b', 'beta'), locked('c', 'gamma'),
    ] }] }} />)
    fireEvent.click(screen.getByText(/skills/i))
    expect(count(/^read-only$/)).toBe(1)
  })

  it('still names each owner, which is what the band is for', () => {
    render(<Inventory inv={{ groups: [{ kind: 'skill', label: 'skill', items: [
      locked('a', 'alpha'), locked('b', 'beta'),
    ] }] }} />)
    fireEvent.click(screen.getByText(/skills/i))
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
  })
})

describe('a mixed group', () => {
  it('keeps the per-band note, because the header no longer answers it', () => {
    // Header reads "1 editable · 2 read-only" — which band is which is a real
    // question, so the notes stay.
    render(<Inventory inv={{ groups: [{ kind: 'skill', label: 'skill', items: [
      free('mine'), locked('a', 'alpha'), locked('b', 'beta'),
    ] }] }} />)
    fireEvent.click(screen.getByText(/skills/i))
    expect(screen.getByText(/1 editable · 2 read-only/)).toBeTruthy()
    expect(count(/^read-only$/)).toBe(2)
  })
})
