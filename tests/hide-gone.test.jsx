// @vitest-environment happy-dom
//
// A project whose directory no longer exists cannot be opened, so it is
// clutter on a list you use to pick something. It is still a fact, though,
// and "gone" is a claim about right now — an unmounted volume, a removed
// worktree, a renamed folder. So these rows are hidden, never deleted, and
// the count stays on screen: a list quietly shorter than the truth is the
// failure this whole app exists to prevent.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ProjectList } from '../src/ui/Projects.jsx'

afterEach(() => { cleanup(); window.localStorage.clear() })

const p = (path, exists) => ({ path, exists, sessions: 3, markers: exists ? { git: true } : null, configured: exists })
const projects = [
  p('/work/alive', true),
  p('/work/also-alive', true),
  p('/work/deleted', false),
  p('/work/unplugged', false),
]
const list = (over = {}) => <ProjectList projects={projects} selected={null} onPick={() => {}} {...over} />

describe('projects whose directory is gone', () => {
  it('are not listed among the ones you can open', () => {
    render(list())
    expect(screen.getByText('/work/alive')).toBeTruthy()
    expect(screen.queryByText('/work/deleted')).toBe(null)
  })

  it('are still counted on screen, never silently dropped', () => {
    render(list())
    expect(screen.getByText(/2 gone/)).toBeTruthy()
  })

  it('can be brought back, because gone is a claim about right now', () => {
    render(list())
    fireEvent.click(screen.getByRole('button', { name: /gone/i }))
    expect(screen.getByText('/work/deleted')).toBeTruthy()
    expect(screen.getByText('/work/unplugged')).toBeTruthy()
  })

  it('hides again once shown', () => {
    render(list())
    const toggle = screen.getByRole('button', { name: /gone/i })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /gone/i }))
    expect(screen.queryByText('/work/deleted')).toBe(null)
  })

  it('remembers the choice across a remount', () => {
    const { unmount } = render(list())
    fireEvent.click(screen.getByRole('button', { name: /gone/i }))
    unmount()
    render(list())
    expect(screen.getByText('/work/deleted')).toBeTruthy()
  })

  it('says nothing at all when every project is present', () => {
    render(list({ projects: [p('/work/alive', true)] }))
    expect(screen.queryByText(/gone/i)).toBe(null)
  })

  it('never removes a live project, whatever its markers say', () => {
    render(list())
    expect(screen.getByText('/work/alive')).toBeTruthy()
    expect(screen.getByText('/work/also-alive')).toBeTruthy()
  })
})

describe('what hiding must not do', () => {
  it('deletes nothing — the same array is still rendered from', () => {
    const given = [...projects]
    render(list({ projects: given }))
    expect(given.length).toBe(4)
    expect(given.filter((x) => !x.exists).length).toBe(2)
  })

  it('still shows a gone row as gone once revealed, not as ordinary', () => {
    render(list())
    fireEvent.click(screen.getByRole('button', { name: /gone/i }))
    expect(screen.getAllByText('gone').length).toBe(2)
  })
})
