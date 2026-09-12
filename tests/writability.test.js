import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { classify } from '../src/server/writability.js'

const root = '/Users/x/.claude'
const at = (p, kind) => classify({ path: path.join(root, p), kind, root })

describe('classify', () => {
  it('marks user memory and skills freely editable', () => {
    expect(at('CLAUDE.md', 'memory').class).toBe('free')
    expect(at('skills/mine/SKILL.md', 'skill').class).toBe('free')
  })

  it('redirects plugins/cache rather than allowing a doomed edit', () => {
    const r = at('plugins/cache/spyglass/spyglass/0.1.0/skills/x/SKILL.md', 'skill')
    expect(r.class).toBe('redirect')
    expect(r.reason).toMatch(/overwritten/i)
  })

  it('redirects skills/synced — overwritten on next sync', () => {
    expect(at('skills/synced/foo/SKILL.md', 'skill').class).toBe('redirect')
  })

  it('guards ~/.claude.json because it holds the auth session', () => {
    expect(classify({ path: '/Users/x/.claude.json', kind: 'clauderc', root }).class).toBe('guarded')
  })

  it('does not confuse ~/.claude.json with a file inside ~/.claude', () => {
    expect(classify({ path: '/Users/x/.claude.json', kind: 'clauderc', root }).class).not.toBe('free')
    expect(at('settings.json', 'settings').class).toBe('free')
  })

  it('marks managed policy read-only', () => {
    const r = classify({
      path: '/Library/Application Support/ClaudeCode/managed-settings.json',
      kind: 'managedSettings', root,
    })
    expect(r.class).toBe('readonly')
  })

  it('marks session transcripts guarded', () => {
    expect(at('projects/-Users-x/abc.jsonl', 'session').class).toBe('guarded')
  })

  it('marks hook and statusline scripts exec-class', () => {
    expect(at('hooks/format-hook.sh', 'hookScript').class).toBe('exec')
    expect(at('statusline-command.sh', 'statusLineScript').class).toBe('exec')
  })
})
