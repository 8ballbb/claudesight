import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
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

// The bug this fixes: a bare null meant both "no script named" and "the script
// is gone", so callers could only filter, and a broken hook vanished from the
// UI while Claude Code went on executing it.
describe('extractScripts: a declared script that does not resolve', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ref-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const one = (command) => extractScripts({ statusLine: { command } }, dir)[0]

  it('says not-declared when the command names no script at all', () => {
    expect(one('echo hi')).toMatchObject({ state: 'not-declared', scriptPath: null })
  })

  it('says absent when the script is missing, and still reports its path', () => {
    const r = one('bash ./hooks/gone.sh')
    expect(r.state).toBe('absent')
    expect(r.scriptPath).toBe(path.join(dir, 'hooks/gone.sh'))
  })

  it('distinguishes a missing script from a command with no script', () => {
    // The whole point. Before the fix both returned a bare null.
    expect(one('bash ./hooks/gone.sh').state).not.toBe(one('echo hi').state)
  })

  it('says ok and reads the body when the script is there', () => {
    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'hooks/real.sh'), '#!/bin/sh\necho ok\n')
    const r = one('bash ./hooks/real.sh')
    expect(r.state).toBe('ok')
    expect(r.body.state).toBe('ok')
  })

  it('does not mistake an interpreter or a flag for the missing script', () => {
    const r = one('/usr/bin/env node --inspect ./hooks/gone.js')
    expect(r.scriptPath).toBe(path.join(dir, 'hooks/gone.js'))
    expect(r.state).toBe('absent')
  })

  it('reports denied when the script cannot be read', () => {
    const locked = path.join(dir, 'locked')
    fs.mkdirSync(locked)
    fs.writeFileSync(path.join(locked, 'h.sh'), '#!/bin/sh\n')
    fs.chmodSync(locked, 0o000)
    try {
      const r = one(`bash ${path.join(locked, 'h.sh')}`)
      // Running as root defeats the permission bits; only assert where it holds.
      if (r.state !== 'ok') expect(r.state).toBe('denied')
    } finally {
      fs.chmodSync(locked, 0o700)
    }
  })
})
