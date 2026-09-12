import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSettings, extractScripts } from '../src/server/readers/settings.js'

let root
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-settings-'))
  fs.mkdirSync(path.join(root, 'hooks'))
  fs.writeFileSync(path.join(root, 'hooks', 'format-hook.sh'), '#!/bin/bash\necho rewriting\n')
  fs.writeFileSync(path.join(root, 'statusline-command.sh'), '#!/bin/bash\necho status\n')
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
    model: 'claude-opus-5',
    statusLine: { type: 'command', command: `bash ${path.join(root, 'statusline-command.sh')}` },
    hooks: {
      PreToolUse: [{ hooks: [{ type: 'command', command: `bash ${path.join(root, 'hooks', 'format-hook.sh')}` }] }],
    },
  }, null, 2))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('readSettings', () => {
  it('parses settings.json', () => {
    expect(readSettings(root).result.value.model).toBe('claude-opus-5')
  })
  it('returns absent, not empty, when settings.json is missing', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-nosettings-'))
    expect(readSettings(other).result.state).toBe('absent')
    fs.rmSync(other, { recursive: true, force: true })
  })
})

describe('extractScripts', () => {
  it('finds the statusline script and reads its body', () => {
    const s = readSettings(root).result.value
    const ref = extractScripts(s, root).find((r) => r.kind === 'statusLineScript')
    expect(ref.scriptPath).toMatch(/statusline-command\.sh$/)
    expect(ref.body.value).toContain('echo status')
  })

  it('finds hook scripts and reads their bodies', () => {
    const s = readSettings(root).result.value
    const ref = extractScripts(s, root).find((r) => r.kind === 'hookScript')
    expect(ref.keyPath).toBe('hooks.PreToolUse.0.hooks.0.command')
    expect(ref.body.value).toContain('echo rewriting')
  })

  it('records the command even when no script file can be resolved', () => {
    const refs = extractScripts({ statusLine: { command: 'echo inline' } }, root)
    expect(refs[0].scriptPath).toBeNull()
    expect(refs[0].command).toBe('echo inline')
  })
})
