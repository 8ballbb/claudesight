// @vitest-environment happy-dom
//
// The count was a dead end: six directories were dropped and the page could
// not say which. The server always knew. Clicking the count now shows them,
// grouped by the reason they were dropped.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FilteredNote } from '../src/ui/Projects.jsx'

afterEach(() => { cleanup(); window.localStorage.clear() })

const paths = [
  { path: '/Users/x', reason: 'your home directory, not a project' },
  { path: '/Users/x/.claude', reason: 'inside the Claude configuration directory' },
  { path: '/tmp/scratch', reason: 'a temporary directory' },
]

describe('the filtered count', () => {
  it('still states the number', () => {
    render(<FilteredNote filtered={3} filteredPaths={paths} />)
    expect(screen.getByText(/3 filtered/)).toBeTruthy()
  })

  it('names the directories once opened', () => {
    render(<FilteredNote filtered={3} filteredPaths={paths} />)
    fireEvent.click(screen.getByText(/3 filtered/))
    expect(screen.getByText('/tmp/scratch')).toBeTruthy()
    expect(screen.getByText('/Users/x')).toBeTruthy()
  })

  it('gives the reason each one was dropped', () => {
    render(<FilteredNote filtered={3} filteredPaths={paths} />)
    fireEvent.click(screen.getByText(/3 filtered/))
    expect(screen.getByText(/a temporary directory/)).toBeTruthy()
    expect(screen.getByText(/your home directory, not a project/)).toBeTruthy()
  })

  it('is not a button when nothing was filtered', () => {
    render(<FilteredNote filtered={0} filteredPaths={[]} />)
    expect(screen.queryByRole('button')).toBe(null)
  })

  it('survives a server that sends only the count', () => {
    // An older server, or a shape change: show the number, offer no disclosure
    // rather than rendering an empty list that implies nothing was dropped.
    render(<FilteredNote filtered={4} filteredPaths={undefined} />)
    expect(screen.getByText(/4 filtered/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBe(null)
  })
})
