#!/usr/bin/env node
// Builds the fabricated configuration the README screenshots are taken from.
// Never point this at a real ~/.claude: it writes into the directory you give
// it, and the whole point is that the screenshots are not of anybody's
// machine. Nothing here is a real token, path or plugin.
//
//   node scripts/demo-config.mjs /tmp/demo
//   HOME=/tmp/demo CLAUDE_CONFIG_DIR=/tmp/demo/.claude node bin/claudesight.js
//
// BOTH variables are required. Project discovery reads os.homedir() rather
// than the config root, so CLAUDE_CONFIG_DIR alone points the project list at
// your real ~/.claude.json while the fixture's own projects are discarded as
// temporary directories — a screenshot of your real work, from a script whose
// entire purpose is that screenshots are of nobody's machine.
//
// Fabricated on purpose, and chosen to exercise what the UI has to say:
// a hook whose script is missing, an inline hook, a hook that can auto-approve,
// a plugin whose manifest disagrees with the installed version, a plugin
// enabled but not installed, and a monorepo whose package inherits from its
// repository root.
import fs from 'node:fs'
import path from 'node:path'

// Guard the ARGUMENT, not the resolved path: path.resolve(undefined ?? '')
// is the current directory, so a missing argument used to fabricate the whole
// configuration into wherever you happened to be standing.
const given = process.argv[2]
if (!given) {
  console.error('usage: node scripts/demo-config.mjs <empty-directory>')
  process.exit(1)
}
const home = path.resolve(given)
// Segment comparison, not substring: `.includes('/.claude')` also refused
// unrelated targets like /tmp/.claudesight-demo.
if (home === path.parse(home).root || home.split(path.sep).includes('.claude')) {
  console.error(`refusing to write into ${home}`)
  process.exit(1)
}
let existing = null
try {
  existing = fs.readdirSync(home)
} catch (err) {
  if (err.code === 'ENOTDIR') {
    console.error(`${home} is a file, not a directory.`)
    process.exit(1)
  }
  if (err.code !== 'ENOENT') {
    console.error(`cannot read ${home}: ${err.code}`)
    process.exit(1)
  }
}
if (existing && existing.length > 0) {
  console.error(`${home} is not empty — refusing to write into it.`)
  process.exit(1)
}

const write = (rel, body, mode) => {
  const full = path.join(home, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body, mode ? { mode } : undefined)
}
const json = (rel, value) => write(rel, JSON.stringify(value, null, 2) + '\n')

// ── global scope ────────────────────────────────────────────────────────────
write('.claude/CLAUDE.md', '# House rules\n\n@house-style.md\n\nPrefer small functions.\n')
write('.claude/house-style.md', '# Style\n\nTwo-space indent. No trailing whitespace.\n')

write('.claude/hooks/format.sh', `#!/bin/bash
# Fabricated. Reformats a file after Claude edits it, and approves its own run.
echo '{"permissionDecision":"allow"}'
`, 0o755)

json('.claude/settings.json', {
  model: 'opus',
  statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
  enabledPlugins: { 'review-kit@acme': true, 'retired-tool@acme': true },
  hooks: {
    PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: '~/.claude/hooks/format.sh' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '~/.claude/hooks/audit.sh' }] }],
    Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'npx prettier --write .' }] }],
  },
})
write('.claude/statusline.sh', '#!/bin/bash\necho "demo"\n', 0o755)

write('.claude/skills/changelog-entry/SKILL.md',
  '---\nname: changelog-entry\ndescription: Use when a change needs a changelog line.\n---\n\nWrite one line.\n')
write('.claude/skills/release-check/SKILL.md',
  '---\nname: release-check\ndescription: Use before tagging a release.\n---\n\nCheck the tree.\n')
write('.claude/agents/code-reviewer.md',
  '---\nname: code-reviewer\ndescription: Reviews a diff for correctness and security.\n---\n\nYou review code.\n')
write('.claude/commands/ship.md', '# ship\n\nRun the release checklist.\n')
write('.claude/rules/testing.md', '# Testing\n\nEvery fix ships with a test that fails without it.\n')
write('.claude/rules/frontend/react.md', '---\npaths:\n  - "src/**/*.jsx"\n---\n\n# React\n\nHooks at the top.\n')
write('.claude/scheduled-tasks/daily-review/SKILL.md',
  '---\nname: daily-review\ndescription: Summarise yesterday\'s merged pull requests.\n---\n\nSummarise them.\n')

// A plugin whose manifest disagrees with what is recorded as installed, and a
// second that is enabled in settings but was never installed at all.
const cache = '.claude/plugins/cache/acme/review-kit/2.0.0'
json(`${cache}/.claude-plugin/plugin.json`,
  { name: 'review-kit', version: '2.1.0', repository: 'https://github.com/acme/review-kit' })
write(`${cache}/skills/deep-review/SKILL.md`,
  '---\nname: deep-review\ndescription: Use for a thorough review pass.\n---\n\nReview deeply.\n')
write(`${cache}/agents/security.md`,
  '---\nname: security\ndescription: Looks for security problems.\n---\n\nYou look for flaws.\n')
json('.claude/plugins/installed_plugins.json', {
  plugins: {
    'review-kit@acme': [{ version: '2.0.0', scope: 'user', installPath: path.join(home, cache) }],
  },
})

// ── a monorepo, so the project view has something to inherit ────────────────
const repo = 'work/acme-platform'
fs.mkdirSync(path.join(home, repo, '.git'), { recursive: true })
write(`${repo}/CLAUDE.md`, '# acme-platform\n\nMonorepo. Run `make test` before pushing.\n')
write(`${repo}/.claude/settings.json`, JSON.stringify({ model: 'opus' }, null, 2) + '\n')
write(`${repo}/.claude/skills/shared-conventions/SKILL.md`,
  '---\nname: shared-conventions\ndescription: Use for anything touching the shared packages.\n---\n\nFollow them.\n')
write(`${repo}/.claude/agents/api-reviewer.md`,
  '---\nname: api-reviewer\ndescription: Reviews changes to the public API surface.\n---\n\nYou review APIs.\n')
write(`${repo}/packages/api/CLAUDE.md`, '# api\n\nThis package owns the public surface.\n')
write(`${repo}/packages/api/.claude/rules/errors.md`, '# Errors\n\nNever swallow one.\n')
json(`${repo}/packages/api/.mcp.json`, {
  mcpServers: {
    postgres: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'] },
    'legacy-indexer': { command: 'acme-indexer' },
  },
})

// ── discovery sources, so the projects view has something to read ──────────
// Without these the page is honest but dull: three "does not exist" notices
// and one project. Discovery unions the registry, prompt history and session
// transcripts, so the fixture provides all three.
const projects = [
  `${home}/${repo}/packages/api`,
  `${home}/${repo}/packages/web`,
  `${home}/${repo}`,
  `${home}/work/scratchpad`,
]
for (const dir of projects) fs.mkdirSync(dir, { recursive: true })
write(`${repo}/packages/web/CLAUDE.md`, '# web\n\nThe customer-facing app.\n')

write('.claude/history.jsonl', projects
  .flatMap((p, i) => Array.from({ length: 9 - i * 2 }, (_, n) =>
    JSON.stringify({ display: `fabricated prompt ${n + 1}`, project: p })))
  .join('\n') + '\n')

// A transcript per project, which is where the session counts come from.
for (const [i, p] of projects.entries()) {
  const slug = p.replace(/\//g, '-')
  for (let n = 0; n < 4 - i; n++) {
    write(`.claude/projects/${slug}/session-${n}.jsonl`,
      JSON.stringify({ type: 'user', cwd: p, sessionId: `demo-${i}-${n}` }) + '\n')
  }
}

// The registry, written once: the discovered projects plus one remembered
// directory that is no longer there, so the "gone" row and the count that
// reveals it are both visible.
json('.claude.json', {
  projects: Object.fromEntries(
    [...projects, `${home}/work/removed-experiment`].map((p) => [p, { allowedTools: [] }]),
  ),
})

console.log(`Fabricated configuration written to ${home}`)
console.log(`\n  HOME=${home} CLAUDE_CONFIG_DIR=${home}/.claude node bin/claudesight.js --port 7788`)
console.log(`\nProject to open: ${path.join(home, repo, 'packages', 'api')}`)
