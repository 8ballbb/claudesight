// @vitest-environment happy-dom
//
// The caveat must reach the screen. A task listed without it implies the app
// knows when the task runs, which it cannot: the schedule is Desktop's state.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import Inventory from '../src/ui/Inventory.jsx'

afterEach(() => { cleanup(); window.localStorage.clear() })

const row = (over = {}) => ({
  id: 'x', kind: 'scheduledTask', label: 'nightly', path: '/p/SKILL.md',
  state: 'ok', cycle: false, depthExceeded: false,
  description: 'Review yesterday',
  note: 'prompt only — the schedule, folder and model live in Claude Desktop',
  writability: { class: 'free', reason: 'User-authored configuration' },
  ...over,
})

describe('a scheduled task row', () => {
  it('appears under its own group', () => {
    render(<Inventory inv={{ groups: [{ kind: 'scheduledTask', label: 'scheduledTask', items: [row()] }] }} />)
    expect(screen.getByText(/scheduled tasks/i)).toBeTruthy()
  })

  it('says the schedule is not in this file', () => {
    render(<Inventory inv={{ groups: [{ kind: 'scheduledTask', label: 'scheduledTask', items: [row()] }] }} />)
    fireEvent.click(screen.getByText(/scheduled tasks/i))
    expect(screen.getByText(/the schedule, folder and model live in Claude Desktop/)).toBeTruthy()
  })

  it('still names what the task is for', () => {
    render(<Inventory inv={{ groups: [{ kind: 'scheduledTask', label: 'scheduledTask', items: [row()] }] }} />)
    fireEvent.click(screen.getByText(/scheduled tasks/i))
    expect(screen.getByText(/Review yesterday/)).toBeTruthy()
  })
})
