// The Claude-file critic is the one place claudesight calls a cloud LLM, so its
// guarantees are the ones worth pinning: it never gets write tools, it never
// gets read tools in the default mode (so untrusted artifact content cannot
// drive an exfiltration), it runs in a neutral cwd (so it does not execute the
// target project's hooks), and it adjudicates repo-claims locally. Every test
// injects the spawn, so none of them touch the network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  preflight, review, buildSeed, buildSystemPrompt, buildPrompt, localVerify,
} from '../src/server/critic.js'

// A fake `claude` that records how it was called and returns a chosen result.
const fakeRun = (result) => {
  const calls = []
  const run = (args, opts) => { calls.push({ args, opts }); return Promise.resolve(result) }
  return { run, calls }
}

// The JSON envelope `claude -p --output-format json` prints, with the model's
// text (our findings JSON) in `.result`.
const envelope = (findingsDoc, extra = {}) => ({
  ok: true, code: 0, stderr: '',
  stdout: JSON.stringify({ result: JSON.stringify(findingsDoc), total_cost_usd: 0.02, ...extra }),
})

const sampleFindings = {
  findings: [{
    id: 'F-001', pass: 'A', action: 'cut', severity: 'medium',
    quote: 'always run tests', problem: 'vague', suggested_change: 'DELETE',
    rationale: 'a hook enforces it', counterargument: 'documents intent', confidence: 'medium',
    verify_against: null,
  }],
  verdict: { verdict: 'needs_work', summary: 'ok', keep_count: 0, review_limitations: [] },
}

const entry = (over = {}) => ({
  kind: 'memory', label: 'CLAUDE.md', path: '/x/CLAUDE.md', root: '/x',
  writability: { class: 'free' }, ...over,
})

describe('preflight', () => {
  it('reports the binary missing when claude is not on PATH', async () => {
    const { run } = fakeRun({ ok: false, code: 'ENOENT', stdout: '', stderr: '' })
    const r = await preflight({ injectedRun: run })
    expect(r.state).toBe('absent')
    expect(r.reason).toMatch(/PATH/)
  })

  it('distinguishes an auth failure from a generic error', async () => {
    const { run } = fakeRun({ ok: false, code: 1, stdout: '', stderr: 'Please run claude to login (OAuth)' })
    const r = await preflight({ injectedRun: run })
    expect(r.state).toBe('auth')
  })

  it('is ok when the probe returns parseable json', async () => {
    const { run } = fakeRun({ ok: true, code: 0, stdout: JSON.stringify({ result: 'ok' }), stderr: '' })
    const r = await preflight({ injectedRun: run })
    expect(r.state).toBe('ok')
  })

  it('the probe never grants any tools', async () => {
    const { run, calls } = fakeRun({ ok: true, code: 0, stdout: '{"result":"ok"}', stderr: '' })
    await preflight({ injectedRun: run })
    const args = calls[0].args
    expect(args).toContain('--strict-mcp-config')
    const disallowed = args[args.indexOf('--disallowedTools') + 1]
    for (const t of ['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob']) expect(disallowed).toContain(t)
  })
})

describe('review — read-only / no-exec guarantees', () => {
  it('default invocation grants NO file tools (allowedTools empty, read/write denied)', async () => {
    const { run, calls } = fakeRun(envelope(sampleFindings))
    await review({ entry: entry(), content: 'always run tests\n', injectedRun: run })
    const args = calls[0].args
    const allowedIdx = args.indexOf('--allowedTools')
    expect(allowedIdx).toBeGreaterThan(-1)
    expect(args[allowedIdx + 1]).toBe('') // no tools at all
    const disallowed = args[args.indexOf('--disallowedTools') + 1]
    for (const t of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash']) expect(disallowed).toContain(t)
  })

  it('runs in a NEUTRAL cwd, never the artifact root (so project hooks cannot fire)', async () => {
    const { run, calls } = fakeRun(envelope(sampleFindings))
    await review({ entry: entry({ root: '/some/project' }), content: 'x\n', injectedRun: run })
    const cwd = calls[0].opts.cwd
    expect(cwd).not.toBe('/some/project')
    expect(cwd).toContain('claudesight-critic')
    expect(calls[0].args).toContain('--strict-mcp-config')
  })

  it('returns parsed findings with a local_verification field attached', async () => {
    const { run } = fakeRun(envelope(sampleFindings))
    const r = await review({ entry: entry(), content: 'always run tests\n', injectedRun: run })
    expect(r.state).toBe('ok')
    expect(r.report.findings).toHaveLength(1)
    expect(r.report.findings[0].local_verification).toBeDefined()
    expect(r.report.files_read).toEqual([]) // default mode reads nothing
    expect(r.report.cost_usd).toBe(0.02)
  })

  it('tolerates the model wrapping JSON in a code fence', async () => {
    const fenced = { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ result: '```json\n' + JSON.stringify(sampleFindings) + '\n```' }) }
    const { run } = fakeRun(fenced)
    const r = await review({ entry: entry(), content: 'x', injectedRun: run })
    expect(r.state).toBe('ok')
  })

  it('refuses an oversize file rather than sending it', async () => {
    const { run } = fakeRun(envelope(sampleFindings))
    const big = 'a'.repeat(300 * 1024)
    const r = await review({ entry: entry(), content: big, injectedRun: run })
    expect(r.state).toBe('error')
    expect(r.reason).toMatch(/limit/)
  })

  it('surfaces a non-parseable critic reply as an error, not an empty clean review', async () => {
    const { run } = fakeRun({ ok: true, code: 0, stderr: '', stdout: JSON.stringify({ result: 'I could not do that' }) })
    const r = await review({ entry: entry(), content: 'x', injectedRun: run })
    expect(r.state).toBe('error')
  })
})

describe('buildSeed / prompts', () => {
  it('seeds claudesight-resolved metadata from the entry', () => {
    const { facts } = buildSeed(entry({ description: 'a skill', kind: 'skill' }), 'body')
    expect(facts.kind).toBe('skill')
    expect(facts.path).toBe('/x/CLAUDE.md')
    expect(facts.description).toBe('a skill')
  })

  it('flags @-imports in memory content', () => {
    const { facts } = buildSeed(entry(), '@./RTK.md\nsome text')
    expect(facts.has_at_imports).toBe(true)
  })

  it('picks a kind-specific rubric and demands JSON-only output', () => {
    expect(buildSystemPrompt('agent')).toMatch(/least-privilege|LEAST-PRIVILEGE/i)
    expect(buildSystemPrompt('settings')).toMatch(/security/i)
    expect(buildSystemPrompt('memory')).toMatch(/ONLY a JSON object/)
  })

  it('embeds the file between markers in the prompt', () => {
    const p = buildPrompt(buildSeed(entry(), 'hello'), 'hello')
    expect(p).toContain('<<<FILE')
    expect(p).toContain('hello')
  })
})

describe('localVerify — the offline adjudicator', () => {
  let root
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesight-verify-'))
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x","dependencies":{"vite":"1"}}')
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('confirms a file that exists and refutes one that does not', () => {
    expect(localVerify({ kind: 'file_exists', path: 'package.json' }, root).state).toBe('confirmed')
    expect(localVerify({ kind: 'file_exists', path: 'webpack.config.js' }, root).state).toBe('refuted')
  })

  it('confirms/refutes a substring in a file', () => {
    expect(localVerify({ kind: 'substring_in_file', path: 'package.json', needle: 'vite' }, root).state).toBe('confirmed')
    expect(localVerify({ kind: 'substring_in_file', path: 'package.json', needle: 'webpack' }, root).state).toBe('refuted')
  })

  it('refuses to escape the artifact root', () => {
    expect(localVerify({ kind: 'file_exists', path: '../../etc/passwd' }, root).state).toBe('unverifiable')
  })

  it('is unchecked for a null or unstructured hint', () => {
    expect(localVerify(null, root).state).toBe('unchecked')
    expect(localVerify('check package.json', root).state).toBe('unchecked')
  })
})
