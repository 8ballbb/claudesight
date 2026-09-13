import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readMarkdownKind } from '../src/server/readers/markdown.js'

let root
const write = (rel, body) => {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
}
const agent = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n\nPrompt.\n`

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-md-'))
  write('agents/mine.md', agent('mine', 'a user agent'))
  write('plugins/cache/spyglass/spyglass/0.1.0/agents/test-planner.md',
    agent('test-planner', 'derives test cases'))
  write('plugins/cache/mp/feature-dev/unknown/agents/code-reviewer.md',
    agent('code-reviewer', 'reviews code'))
  // A skill keeping its own prompt files in a nested agents/ directory. These
  // are NOT loadable subagents and counting them over-reports the inventory.
  write('plugins/cache/mp/skill-creator/unknown/skills/skill-creator/agents/grader.md',
    '# Grader Agent\n\nNot a registered subagent.\n')
  // Vendored copies for other tools, which Claude Code never loads.
  write('plugins/cache/mp/feature-dev/unknown/.codex-plugin/agents/code-reviewer.md',
    agent('code-reviewer', 'vendored duplicate'))
  write('plugins/cache/mp/feature-dev/unknown/commands/ship/release.md',
    agent('release', 'nested command'))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('readMarkdownKind', () => {
  it('reads user-level and plugin-level agents together', () => {
    const names = readMarkdownKind(root, 'agents').items.map((i) => i.invocable)
    expect(names).toEqual(['feature-dev:code-reviewer', 'mine', 'spyglass:test-planner'])
  })

  it('namespaces a plugin agent by its plugin, which is what you type', () => {
    const found = readMarkdownKind(root, 'agents').items.find((i) => i.name === 'test-planner')
    expect(found).toMatchObject({
      invocable: 'spyglass:test-planner', plugin: 'spyglass', marketplace: 'spyglass', origin: 'plugin',
    })
  })

  it('leaves a user agent unprefixed', () => {
    const found = readMarkdownKind(root, 'agents').items.find((i) => i.name === 'mine')
    expect(found.invocable).toBe('mine')
    expect(found.origin).toBe('user')
  })

  it('ignores an agents/ directory nested inside a skill', () => {
    const items = readMarkdownKind(root, 'agents').items
    expect(items.map((i) => i.name)).not.toContain('grader')
  })

  it('ignores vendored copies under dot-directories', () => {
    const items = readMarkdownKind(root, 'agents').items
    expect(items.filter((i) => i.plugin === 'feature-dev')).toHaveLength(1)
  })

  it('namespaces a nested command by its subdirectory', () => {
    const items = readMarkdownKind(root, 'commands').items
    expect(items.map((i) => i.invocable)).toEqual(['feature-dev:release'])
  })

  it('reports each source location so an empty result is never bare', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-md-bare-'))
    const r = readMarkdownKind(bare, 'agents')
    expect(r.items).toHaveLength(0)
    expect(r.sources.map((x) => x.state)).toEqual(['absent', 'absent'])
    fs.rmSync(bare, { recursive: true, force: true })
  })

  it('falls back to the filename when frontmatter names nothing', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-md-plain-'))
    fs.mkdirSync(path.join(plain, 'agents'))
    fs.writeFileSync(path.join(plain, 'agents', 'helper.md'), 'No frontmatter here.\n')
    const [item] = readMarkdownKind(plain, 'agents').items
    expect(item).toMatchObject({ name: 'helper', description: null, malformed: false })
    fs.rmSync(plain, { recursive: true, force: true })
  })

  it('flags malformed frontmatter rather than dropping the agent', () => {
    const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-md-bad-'))
    fs.mkdirSync(path.join(bad, 'agents'))
    fs.writeFileSync(path.join(bad, 'agents', 'broken.md'), '---\nname: [unclosed\n---\nx\n')
    const [item] = readMarkdownKind(bad, 'agents').items
    expect(item.malformed).toBe(true)
    expect(item.name).toBe('broken')
    fs.rmSync(bad, { recursive: true, force: true })
  })
})
