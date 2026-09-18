// A declared MCP server whose command is not on PATH fails at launch and the
// configuration says nothing. The file was reported as one row carrying a
// count of servers — a number standing in for the thing you wanted to know.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveCommand, readMcpServers } from '../src/server/mcp.js'

let tmp, bin
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-mcp-')))
  bin = path.join(tmp, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'present'), '#!/bin/sh\n', { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'notexec'), 'data\n', { mode: 0o644 })
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const env = () => ({ PATH: bin })
const write = (body) => {
  const f = path.join(tmp, '.mcp.json')
  fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body))
  return f
}

describe('resolveCommand', () => {
  it('finds a command that is on PATH', () => {
    expect(resolveCommand('present', env())).toMatchObject({ resolved: true })
  })

  it('reports one that is not, and says why', () => {
    expect(resolveCommand('absent', env())).toMatchObject({ resolved: false, reason: 'not found on PATH' })
  })

  it('does not count a file that is present but not executable', () => {
    expect(resolveCommand('notexec', env())).toMatchObject({ resolved: false })
  })

  it('checks an explicit path directly instead of searching PATH', () => {
    expect(resolveCommand(path.join(bin, 'present'), env())).toMatchObject({ resolved: true })
    expect(resolveCommand(path.join(bin, 'missing'), env())).toMatchObject({ resolved: false, reason: 'no such file' })
  })

  it('answers "unknown" rather than "missing" when PATH is unavailable', () => {
    expect(resolveCommand('present', {})).toMatchObject({ resolved: null })
  })
})

describe('readMcpServers', () => {
  it('lists every declared server by name', () => {
    const f = write({ mcpServers: { a: { command: 'present' }, b: { command: 'absent' } } })
    expect(readMcpServers(f, env()).servers.map((s) => s.name)).toEqual(['a', 'b'])
  })

  it('says which one will fail to launch', () => {
    const f = write({ mcpServers: { good: { command: 'present' }, bad: { command: 'absent' } } })
    const byName = Object.fromEntries(readMcpServers(f, env()).servers.map((s) => [s.name, s]))
    expect(byName.good.resolved).toBe(true)
    expect(byName.bad.resolved).toBe(false)
  })

  it('does not claim a URL-addressed server is missing', () => {
    const f = write({ mcpServers: { remote: { type: 'sse', url: 'https://example.test/sse' } } })
    const [s] = readMcpServers(f, env()).servers
    expect(s.resolved).toBe(null)
    expect(s.reason).toMatch(/URL/)
  })

  it('keeps a malformed file distinguishable from an empty one', () => {
    expect(readMcpServers(write('{ not json'), env()).state).toBe('malformed')
    expect(readMcpServers(write({}), env()).state).toBe('empty')
    expect(readMcpServers(write({ mcpServers: {} }), env()).state).toBe('empty')
  })

  it('survives an entry that is not an object instead of throwing', () => {
    const f = write({ mcpServers: { weird: 'just a string' } })
    const [s] = readMcpServers(f, env()).servers
    expect(s.resolved).toBe(null)
    expect(s.name).toBe('weird')
  })

  it('reports an absent file as absent, not as no servers', () => {
    expect(readMcpServers(path.join(tmp, 'nope.json'), env()).state).toBe('absent')
  })
})
