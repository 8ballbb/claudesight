// Sessions are the transcripts under <root>/projects/<slug>/. They are listed
// from file stats plus a capped title read — never a full parse, because the
// store is huge — and a session's detail shows metadata and the human prompts,
// not the assistant's replies. The dir is found by the cwd recorded inside its
// files, because the slug that names it is a lossy encoding of the path.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listSessions, readSession } from '../src/server/readers/sessions.js'

let root
const projectA = '/work/acme_app' // an underscore, so the slug is NOT the path
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-sess-'))) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

// Write a transcript as JSONL. `slug` is the (possibly lossy) dir name.
const transcript = (slug, id, lines) => {
  const dir = path.join(root, 'projects', slug)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return path.join(dir, `${id}.jsonl`)
}
const userLine = (text, at) => ({ type: 'user', timestamp: at, cwd: projectA, message: { role: 'user', content: text } })
const asstLine = (at, model = 'claude-opus-5') => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', model, content: [{ type: 'text', text: 'ok' }] } })

describe('listSessions', () => {
  it('finds a project through the slug, mapping / _ . to - as Claude Code does', () => {
    // The dir name maps the underscore to a dash — the path is not the slug.
    transcript('-work-acme-app', 's1', [userLine('hello', '2026-09-20T10:00:00Z')])
    const r = listSessions(root, projectA)
    expect(r.state).toBe('ok')
    expect(r.sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('is absent when no transcript recorded this project', () => {
    transcript('-other-place', 's1', [{ type: 'user', cwd: '/somewhere/else', message: { content: 'x' } }])
    expect(listSessions(root, projectA).state).toBe('absent')
  })

  it('carries last activity and size without parsing content', () => {
    transcript('-work-acme-app', 's1', [userLine('hello', '2026-09-20T10:00:00Z')])
    const [s] = listSessions(root, projectA).sessions
    expect(s.bytes).toBeGreaterThan(0)
    expect(s.lastActivity).toMatch(/^\d{4}-/)
  })

  it('titles from the newest ai-title when present', () => {
    transcript('-work-acme-app', 's1', [
      userLine('first thing', '2026-09-20T10:00:00Z'),
      { type: 'ai-title', aiTitle: 'Old title' },
      { type: 'ai-title', aiTitle: 'Refactor the parser' },
    ])
    expect(listSessions(root, projectA).sessions[0].title).toBe('Refactor the parser')
  })

  it('falls back to the first human prompt when there is no ai-title', () => {
    transcript('-work-acme-app', 's1', [userLine('add a dark mode toggle', '2026-09-20T10:00:00Z')])
    expect(listSessions(root, projectA).sessions[0].title).toBe('add a dark mode toggle')
  })

  it('sorts newest first', () => {
    transcript('-work-acme-app', 'old', [userLine('a', '2026-09-01T10:00:00Z')])
    // touch mtimes so ordering is deterministic
    const older = path.join(root, 'projects', '-work-acme-app', 'old.jsonl')
    fs.utimesSync(older, new Date('2026-09-01'), new Date('2026-09-01'))
    transcript('-work-acme-app', 'new', [userLine('b', '2026-09-20T10:00:00Z')])
    fs.utimesSync(path.join(root, 'projects', '-work-acme-app', 'new.jsonl'), new Date('2026-09-20'), new Date('2026-09-20'))
    expect(listSessions(root, projectA).sessions.map((s) => s.id)).toEqual(['new', 'old'])
  })
})

describe('readSession', () => {
  const build = () => transcript('-work-acme-app', 's1', [
    userLine('build the thing', '2026-09-20T10:00:00Z'),
    asstLine('2026-09-20T10:00:05Z'),
    // a tool result is role "user" but not a human prompt — must be excluded
    { type: 'user', timestamp: '2026-09-20T10:00:06Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'output' }] } },
    userLine('now test it', '2026-09-20T10:01:00Z'),
    asstLine('2026-09-20T10:01:05Z'),
    { type: 'ai-title', aiTitle: 'Build and test' },
  ])

  it('returns metadata: title, times, model, message count, cwd', () => {
    build()
    const r = readSession(root, projectA, 's1')
    expect(r.state).toBe('ok')
    expect(r.title).toBe('Build and test')
    expect(r.firstTs).toBe('2026-09-20T10:00:00Z')
    expect(r.lastTs).toBe('2026-09-20T10:01:05Z')
    expect(r.model).toBe('claude-opus-5')
    expect(r.messageCount).toBe(5) // 2 user prompts + 1 tool-result-user + 2 assistant
    expect(r.cwd).toBe(projectA)
  })

  it('returns the human prompts in order, excluding tool results', () => {
    build()
    const r = readSession(root, projectA, 's1')
    expect(r.prompts.map((p) => p.text)).toEqual(['build the thing', 'now test it'])
  })

  it('refuses an id that tries to escape the project dir', () => {
    build()
    expect(readSession(root, projectA, '../../../etc/passwd').state).toBe('absent')
    expect(readSession(root, projectA, 'nonexistent').state).toBe('absent')
  })
})

describe('titles and prompts ignore messages no one typed', () => {
  const t = (id, lines) => transcript('-work-acme-app', id, lines)
  it('prefers the aiTitle field Claude Code writes', () => {
    t('s1', [userLine('hi', '2026-09-20T10:00:00Z'), { type: 'ai-title', aiTitle: 'Wire the parser' }])
    expect(listSessions(root, projectA).sessions[0].title).toBe('Wire the parser')
    expect(readSession(root, projectA, 's1').title).toBe('Wire the parser')
  })
  it('does not title a session with a local-command caveat', () => {
    t('s1', [userLine('<local-command-caveat>Caveat: messages below were generated…', '2026-09-20T10:00:00Z')])
    expect(listSessions(root, projectA).sessions[0].title).toBe(null)
  })
  it('keeps a slash command as a prompt, unwrapped to its name', () => {
    t('s1', [
      userLine('<local-command-caveat>Caveat…', '2026-09-20T10:00:00Z'),
      userLine('<command-name>/code-review</command-name>\n<command-message>review</command-message>', '2026-09-20T10:00:01Z'),
      userLine('now ship it', '2026-09-20T10:01:00Z'),
    ])
    expect(readSession(root, projectA, 's1').prompts.map((p) => p.text)).toEqual(['/code-review', 'now ship it'])
  })
  it('drops a compaction continuation from the prompts', () => {
    t('s1', [
      userLine('This session is being continued from a previous conversation that ran out of context.', '2026-09-20T10:00:00Z'),
      userLine('carry on', '2026-09-20T10:01:00Z'),
    ])
    expect(readSession(root, projectA, 's1').prompts.map((p) => p.text)).toEqual(['carry on'])
  })
})
