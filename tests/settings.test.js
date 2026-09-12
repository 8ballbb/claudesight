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

  it('expands ~ against the home directory, not the config root', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-home-'))
    try {
      fs.mkdirSync(path.join(home, 'bin'), { recursive: true })
      fs.writeFileSync(path.join(home, 'bin', 'outside.sh'), '#!/bin/bash\necho outside\n')
      const refs = extractScripts({ statusLine: { command: 'bash ~/bin/outside.sh' } }, root, home)
      expect(refs[0].scriptPath).toBe(path.join(home, 'bin', 'outside.sh'))
      expect(refs[0].body.value).toContain('echo outside')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it('still resolves a ~ path that does live under .claude', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-home2-'))
    try {
      fs.mkdirSync(path.join(home, '.claude', 'hooks'), { recursive: true })
      fs.writeFileSync(path.join(home, '.claude', 'hooks', 'h.sh'), '#!/bin/bash\necho hook\n')
      const refs = extractScripts({ statusLine: { command: 'bash ~/.claude/hooks/h.sh' } }, root, home)
      expect(refs[0].scriptPath).toBe(path.join(home, '.claude', 'hooks', 'h.sh'))
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not mistake an interpreter for the script', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-interp-'))
    try {
      fs.mkdirSync(path.join(home, '.claude', 'hooks'), { recursive: true })
      const script = path.join(home, '.claude', 'hooks', 'real.sh')
      fs.writeFileSync(script, '#!/bin/bash\necho real\n')
      const refs = extractScripts({ statusLine: { command: `/usr/bin/env bash ${script}` } }, root, home)
      expect(refs[0].scriptPath).toBe(script)
      expect(refs[0].body.value).toContain('echo real')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
