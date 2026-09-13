import { describe, it, expect } from 'vitest'
import { whyFor } from '../src/ui/Editor.jsx'

const at = (cls, reason) => ({ kind: 'agent', writability: { class: cls, reason } })

describe('whyFor', () => {
  it('leads with what actually overwrites this file, not a generic guess', () => {
    const why = whyFor(at('redirect', 'Synced from claude.ai — overwritten on the next sync'))
    expect(why.text).toMatch(/^Synced from claude\.ai/)
    expect(why.text).not.toMatch(/plugin/)
  })

  it('still explains why the app refuses rather than just naming the cause', () => {
    const why = whyFor(at('redirect', 'Inside the plugin cache — overwritten on the next plugin update'))
    expect(why.text).toContain('Inside the plugin cache')
    expect(why.text).toContain('refuses the save')
  })

  it('falls back to the class text when the item carries no reason', () => {
    expect(whyFor(at('redirect', undefined)).text).toContain('refuses the save')
  })

  it('says nothing at all for a file you can edit', () => {
    expect(whyFor(at('free', 'User-authored configuration'))).toBe(null)
  })

  it('keeps the managed-policy and transcript explanations distinct', () => {
    expect(whyFor(at('readonly')).text).toContain('organisation')
    expect(whyFor(at('guarded')).text).toContain('resuming')
  })
})
