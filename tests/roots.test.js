import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveRoot } from '../src/server/roots.js'

describe('resolveRoot', () => {
  it('defaults to $HOME/.claude', () => {
    const r = resolveRoot({}, '/Users/x')
    expect(r.path).toBe(path.join('/Users/x', '.claude'))
    expect(r.source).toBe('default')
  })

  it('honours CLAUDE_CONFIG_DIR and reports it as the source', () => {
    const r = resolveRoot({ CLAUDE_CONFIG_DIR: '/tmp/work-profile' }, '/Users/x')
    expect(r.path).toBe('/tmp/work-profile')
    expect(r.source).toBe('CLAUDE_CONFIG_DIR')
  })

  it('resolves a relative CLAUDE_CONFIG_DIR to absolute', () => {
    expect(path.isAbsolute(resolveRoot({ CLAUDE_CONFIG_DIR: './rel' }, '/Users/x').path)).toBe(true)
  })

  it('treats an empty CLAUDE_CONFIG_DIR as unset', () => {
    expect(resolveRoot({ CLAUDE_CONFIG_DIR: '' }, '/Users/x').source).toBe('default')
  })
})
