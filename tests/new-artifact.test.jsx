// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { NewArtifact } from '../src/ui/NewArtifact.jsx'

afterEach(cleanup)

const setup = (kind, over = {}) => {
  const post = vi.fn().mockResolvedValue({ ok: true, id: 'x' })
  const onCreated = vi.fn()
  render(<NewArtifact kind={kind} post={post} onCreated={onCreated} {...over} />)
  return { post, onCreated }
}
const openForm = (label) => fireEvent.click(screen.getByText(new RegExp(`new ${label}`, 'i')))

describe('what each kind asks for', () => {
  it('asks a skill for a name and a description', () => {
    setup('skill'); openForm('skill')
    expect(screen.getByLabelText(/skill name/i)).toBeTruthy()
    expect(screen.getByLabelText(/skill description/i)).toBeTruthy()
  })

  it('asks a subagent for both too, since delegation is chosen by description', () => {
    setup('agent'); openForm('subagent')
    expect(screen.getByLabelText(/subagent description/i)).toBeTruthy()
  })

  it('asks a rule for a name only', () => {
    setup('rule'); openForm('rule')
    expect(screen.getByLabelText(/rule name/i)).toBeTruthy()
    expect(screen.queryByLabelText(/description/i)).toBe(null)
  })

  it('asks CLAUDE.md for nothing, because its filename is fixed', () => {
    setup('memory'); openForm('CLAUDE.md')
    expect(screen.queryByLabelText(/name/i)).toBe(null)
    expect(screen.queryByLabelText(/description/i)).toBe(null)
  })

  it('renders nothing for a kind that cannot be created', () => {
    const { container } = render(<NewArtifact kind="command" post={vi.fn()} onCreated={vi.fn()} />)
    expect(container.textContent).toBe('')
  })
})

describe('submitting', () => {
  it('sends the kind and the typed values', async () => {
    const { post } = setup('agent'); openForm('subagent')
    fireEvent.change(screen.getByLabelText(/subagent name/i), { target: { value: 'reviewer' } })
    fireEvent.change(screen.getByLabelText(/subagent description/i), { target: { value: 'reviews code' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1]).toMatchObject({ kind: 'agent', name: 'reviewer', description: 'reviews code' })
  })

  it('carries the project when there is one, and omits it at global scope', async () => {
    const { post } = setup('rule', { project: '/work/app' }); openForm('rule')
    fireEvent.change(screen.getByLabelText(/rule name/i), { target: { value: 'testing' } })
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1].project).toBe('/work/app')
  })

  it('will not submit a skill with no description', () => {
    setup('skill'); openForm('skill')
    fireEvent.change(screen.getByLabelText(/skill name/i), { target: { value: 'a' } })
    expect(screen.getByText('Create').disabled).toBe(true)
  })

  it('submits CLAUDE.md with nothing typed at all', async () => {
    const { post } = setup('memory'); openForm('CLAUDE.md')
    expect(screen.getByText('Create').disabled).toBe(false)
    fireEvent.click(screen.getByText('Create'))
    await waitFor(() => expect(post).toHaveBeenCalled())
    expect(post.mock.calls[0][1].kind).toBe('memory')
  })

  it('shows the server reason instead of swallowing a refusal', async () => {
    const post = vi.fn().mockResolvedValue({ ok: false, reason: 'already exists' })
    render(<NewArtifact kind="rule" post={post} onCreated={vi.fn()} />)
    openForm('rule')
    fireEvent.change(screen.getByLabelText(/rule name/i), { target: { value: 'a' } })
    fireEvent.click(screen.getByText('Create'))
    expect(await screen.findByText(/already exists/)).toBeTruthy()
  })
})

describe('offering only what can succeed', () => {
  it('omits the CLAUDE.md creator when one already exists at this scope', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    const inv = { groups: [{ kind: 'memory', items: [{ label: 'CLAUDE.md' }] }] }
    expect(creatorsFor({ inv, onCreated: vi.fn(), post: vi.fn() }).memory).toBe(undefined)
  })

  it('offers it when the memory group holds only other files', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    const inv = { groups: [{ kind: 'memory', items: [{ label: 'CLAUDE.local.md' }] }] }
    expect(creatorsFor({ inv, onCreated: vi.fn(), post: vi.fn() }).memory).toBeTruthy()
  })

  it('offers it when there is no memory group at all', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    expect(creatorsFor({ inv: { groups: [] }, onCreated: vi.fn(), post: vi.fn() }).memory).toBeTruthy()
  })

  it('always offers the named kinds, which can have many', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    const c = creatorsFor({ inv: { groups: [] }, onCreated: vi.fn(), post: vi.fn() })
    expect(Object.keys(c).sort()).toEqual(['agent', 'memory', 'rule', 'settings', 'skill'])
  })
})

describe('the absent CLAUDE.md row', () => {
  it('still offers the creator, because the file is not actually there', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    // The memory group carries a row for CLAUDE.md even when it does not
    // exist — "absent" is a state this app shows rather than hides. Keying
    // the suppression on the label alone hid the button exactly when it was
    // the useful one.
    const inv = { groups: [{ kind: 'memory', items: [{ label: 'CLAUDE.md', state: 'absent' }] }] }
    expect(creatorsFor({ inv, onCreated: vi.fn(), post: vi.fn() }).memory).toBeTruthy()
  })

  it('omits it once the file really exists', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    const inv = { groups: [{ kind: 'memory', items: [{ label: 'CLAUDE.md', state: 'ok' }] }] }
    expect(creatorsFor({ inv, onCreated: vi.fn(), post: vi.fn() }).memory).toBe(undefined)
  })
})

describe('creating settings.json when a user has none', () => {
  it('offers the creator when the settings group has no real file', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    const inv = { groups: [{ kind: 'settings', items: [] }] }
    expect(creatorsFor({ inv, onCreated: vi.fn(), post: vi.fn() }).settings).toBeTruthy()
  })
  it('offers it when only an absent row is shown', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    const inv = { groups: [{ kind: 'settings', items: [{ label: 'settings.json', state: 'absent' }] }] }
    expect(creatorsFor({ inv, onCreated: vi.fn(), post: vi.fn() }).settings).toBeTruthy()
  })
  it('withholds it once a real settings.json exists', async () => {
    const { creatorsFor } = await import('../src/ui/NewArtifact.jsx')
    const inv = { groups: [{ kind: 'settings', items: [{ label: 'settings.json', state: 'ok' }] }] }
    expect(creatorsFor({ inv, onCreated: vi.fn(), post: vi.fn() }).settings).toBe(undefined)
  })
  it('the form for settings asks for nothing, like CLAUDE.md', () => {
    setup('settings'); openForm('settings.json')
    expect(screen.queryByLabelText(/name/i)).toBe(null)
    expect(screen.queryByLabelText(/description/i)).toBe(null)
  })
})
