import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { capabilitiesOf, extractScripts } from '../src/server/readers/settings.js'

// A PreToolUse hook can return permissionDecision "allow" together with
// updatedInput, which auto-approves the tool call and substitutes a different
// command, silently. The app already reads these script bodies to display
// them; nothing said what they were capable of.

const ids = (body) => capabilitiesOf(body).map((c) => c.id)

describe('reading what a hook script can do', () => {
  it('finds the auto-approve and rewrite pair in a real-shaped hook', () => {
    // The shape of an actual hook on the author's machine.
    const body = `
      UPDATED_INPUT=$(echo "$ORIGINAL_INPUT" | jq --arg cmd "$REWRITTEN" '.command = $cmd')
      jq -n --argjson updated "$UPDATED_INPUT" '{
        hookSpecificOutput: {
          "permissionDecision": "allow",
          "updatedInput": $updated
        }
      }'`
    expect(ids(body)).toContain('auto-approves')
    expect(ids(body)).toContain('rewrites-command')
  })

  it('finds a hard block', () => {
    expect(ids('#!/bin/sh\nif bad; then\n  exit 2\nfi\n')).toContain('blocks')
  })

  it('says nothing about an ordinary script', () => {
    expect(ids('#!/bin/sh\ngit rev-parse --abbrev-ref HEAD\n')).toEqual([])
  })

  it('returns nothing rather than throwing when there is no body to read', () => {
    // The body arrives as a five-state result, so a denied or absent script
    // has no text at all. Passing the result object instead of its .value made
    // the scan silently return [] for every script — it looked like working
    // code that had simply found nothing.
    expect(capabilitiesOf(null)).toEqual([])
    expect(capabilitiesOf(undefined)).toEqual([])
    expect(capabilitiesOf({ state: 'ok', value: 'x' })).toEqual([])
  })

  it('does not fire on the word appearing in prose', () => {
    expect(ids('# this hook never sets permissionDecision on its own\n')).toEqual([])
  })
})

describe('capabilities reach the ref, not just the detector', () => {
  let root
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-caps-'))
    fs.mkdirSync(path.join(root, 'hooks'))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const declare = (script) => {
    const file = path.join(root, 'hooks', 'h.sh')
    fs.writeFileSync(file, script)
    fs.chmodSync(file, 0o755)
    return {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: file }] }] },
    }
  }

  it('attaches what the script can do to the hook the UI renders', () => {
    // The detector was correct and the wiring was not: script bodies arrive as
    // a five-state result, and passing the whole object instead of its .value
    // made every scan return nothing. Unit tests on the detector all passed.
    const settings = declare('#!/bin/sh\necho \'{"permissionDecision": "allow", "updatedInput": {}}\'\n')
    const ref = extractScripts(settings, root, root)[0]
    expect(ref.state).toBe('ok')
    expect(ref.capabilities.map((c) => c.id)).toContain('auto-approves')
  })

  it('leaves an unreadable script with no claims about it either way', () => {
    const settings = declare('#!/bin/sh\nexit 0\n')
    fs.rmSync(path.join(root, 'hooks', 'h.sh'))
    const ref = extractScripts(settings, root, root)[0]
    expect(ref.state).not.toBe('ok')
    expect(ref.capabilities).toEqual([])
  })
})
