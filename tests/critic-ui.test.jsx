// @vitest-environment happy-dom
//
// These mount the real Review UI. The guarantees they hold to the screen: no
// Review button unless the feature is ON and the preflight PASSED; a failed
// preflight shows its specific reason, never a dead button; and no file is
// sent without the per-click consent actually being confirmed.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ReviewPanel, ReviewToggle } from '../src/ui/critic.jsx'

afterEach(() => { cleanup(); window.localStorage.clear() })

const item = (over = {}) => ({
  id: 'abc', kind: 'memory', label: 'CLAUDE.md', path: '/p/CLAUDE.md',
  writability: { class: 'free' }, ...over,
})
const critic = (over = {}) => ({
  enabled: true, preflight: { state: 'ok' }, enable() {}, disable() {}, recheck() {}, ...over,
})
const report = {
  verdict: { verdict: 'needs_work', summary: 'Trim it.', review_limitations: ['could not see the repo'] },
  findings: [{
    id: 'F-001', pass: 'A', action: 'cut', severity: 'high', quote: 'always run tests',
    problem: 'a hook already enforces this', suggested_change: 'DELETE', rationale: 'redundant',
    confidence: 'medium', local_verification: { state: 'confirmed', checked: 'hook present' },
  }],
  context_seeded: ['kind', 'path'], files_read: [], cost_usd: 0.021,
}

describe('ReviewPanel gating', () => {
  it('renders nothing when the feature is off', () => {
    const { container } = render(<ReviewPanel item={item()} post={vi.fn()} critic={critic({ enabled: false })} />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing for a non-editable artifact', () => {
    const { container } = render(<ReviewPanel item={item({ writability: { class: 'readonly' } })} post={vi.fn()} critic={critic()} />)
    expect(container.textContent).toBe('')
  })

  it('shows the preflight reason, not a button, when claude -p is unavailable', () => {
    render(<ReviewPanel item={item()} post={vi.fn()} critic={critic({ preflight: { state: 'absent', reason: 'not on PATH' } })} />)
    expect(screen.getByText(/not on PATH/)).toBeTruthy()
    expect(screen.queryByText('Review this file')).toBeNull()
  })

  it('shows the Review button when enabled and preflight ok', () => {
    render(<ReviewPanel item={item()} post={vi.fn()} critic={critic()} />)
    expect(screen.getByText('Review this file')).toBeTruthy()
  })
})

describe('per-click consent + report', () => {
  it('does not send until the consent dialog is confirmed', async () => {
    const post = vi.fn().mockResolvedValue({ state: 'ok', report })
    render(<ReviewPanel item={item()} post={post} critic={critic()} />)

    fireEvent.click(screen.getByText('Review this file'))
    // Consent dialog is up; nothing sent yet.
    expect(screen.getByText(/Send this file to Anthropic/)).toBeTruthy()
    expect(post).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Send & review'))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/critic/review', { id: 'abc', confirmed: true }))
  })

  it('cancelling the consent dialog sends nothing', () => {
    const post = vi.fn()
    render(<ReviewPanel item={item()} post={post} critic={critic()} />)
    fireEvent.click(screen.getByText('Review this file'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(post).not.toHaveBeenCalled()
  })

  it('renders the findings and the honest egress line after a review', async () => {
    const post = vi.fn().mockResolvedValue({ state: 'ok', report })
    render(<ReviewPanel item={item()} post={post} critic={critic()} />)
    fireEvent.click(screen.getByText('Review this file'))
    fireEvent.click(screen.getByText('Send & review'))
    await waitFor(() => expect(screen.getByText(/a hook already enforces this/)).toBeTruthy())
    expect(screen.getByText(/confirmed/)).toBeTruthy()
    expect(screen.getByText(/Sent to Anthropic/)).toBeTruthy()
    expect(screen.getByText('Review again')).toBeTruthy()
  })

  it('shows the failure reason instead of a silent empty review', async () => {
    const post = vi.fn().mockResolvedValue({ state: 'error', reason: 'the review timed out' })
    render(<ReviewPanel item={item()} post={post} critic={critic()} />)
    fireEvent.click(screen.getByText('Review this file'))
    fireEvent.click(screen.getByText('Send & review'))
    await waitFor(() => expect(screen.getByText(/timed out/)).toBeTruthy())
  })
})

describe('ReviewToggle enablement', () => {
  it('turning it on requires confirming the enable dialog', () => {
    const enable = vi.fn()
    render(<ReviewToggle critic={critic({ enabled: false, enable })} />)
    fireEvent.click(screen.getByText('review: off'))
    expect(screen.getByText(/Turn on Review/)).toBeTruthy()
    expect(enable).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Turn it on'))
    expect(enable).toHaveBeenCalled()
  })

  it('when on, clicking turns it back off immediately', () => {
    const disable = vi.fn()
    render(<ReviewToggle critic={critic({ enabled: true, disable })} />)
    fireEvent.click(screen.getByText('review: on'))
    expect(disable).toHaveBeenCalled()
  })
})
