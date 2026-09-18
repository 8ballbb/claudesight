// @vitest-environment happy-dom
//
// Configuration inherited from a parent directory is loaded into every
// session, so it belongs on the page — but listed without a marker it reads
// as a file in this project, and the reader has no way to tell where it came
// from or which directory to edit.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import Inventory from '../src/ui/Inventory.jsx'

afterEach(() => { cleanup(); window.localStorage.clear() })

const row = (over = {}) => ({
  id: over.label ?? 'x', kind: 'memory', label: 'CLAUDE.md', path: '/repo/CLAUDE.md',
  bytes: 10, state: 'ok', cycle: false, depthExceeded: false,
  writability: { class: 'free', reason: 'User-authored' },
  ...over,
})

describe('inherited configuration', () => {
  it('is marked as coming from somewhere else', () => {
    render(<Inventory inv={{ groups: [{ kind: 'memory', label: 'memory', items: [
      row({ label: 'CLAUDE.md', fromAncestor: true, declaredIn: '/repo' }),
    ] }] }} />)
    fireEvent.click(screen.getByText(/memory/i))
    expect(screen.getByText(/inherited/i)).toBeTruthy()
  })

  it('names the directory it came from, which is the one you would edit', () => {
    render(<Inventory inv={{ groups: [{ kind: 'memory', label: 'memory', items: [
      row({ label: 'CLAUDE.md', fromAncestor: true, declaredIn: '/a/b/monorepo' }),
    ] }] }} />)
    fireEvent.click(screen.getByText(/memory/i))
    expect(screen.getByText(/monorepo/)).toBeTruthy()
  })

  it('says when it shadows a definition further up, rather than hiding it', () => {
    render(<Inventory inv={{ groups: [{ kind: 'skill', label: 'skill', items: [
      row({ kind: 'skill', label: 'dup', shadows: ['/repo/.claude/skills/dup/SKILL.md'] }),
    ] }] }} />)
    fireEvent.click(screen.getByText(/skills/i))
    expect(screen.getByText(/shadows 1/i)).toBeTruthy()
  })

  it('leaves an ordinary project file unmarked', () => {
    render(<Inventory inv={{ groups: [{ kind: 'memory', label: 'memory', items: [row()] }] }} />)
    fireEvent.click(screen.getByText(/memory/i))
    expect(screen.queryByText(/inherited/i)).toBe(null)
  })
})
