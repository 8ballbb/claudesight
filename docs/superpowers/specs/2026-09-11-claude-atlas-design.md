# claude-atlas — Design

**Date:** 2026-09-11
**Status:** Approved for planning
**Author:** Andrew Poole (with Claude)

---

## 1. Problem

Claude Code's configuration surface has outgrown the ability to inspect it. On the
author's machine:

- **75** `SKILL.md` files, **zero** of them in `~/.claude/skills` — all delivered by plugins
- **10** plugins from **6** marketplaces, 5 of which are individual GitHub accounts
- **616** session transcripts totalling **113 MB**
- **2,278** MCP server log files in `~/Library/Caches/claude-cli-nodejs/` (15 MB)
- **11** registered projects, **13** session directories, **3** on-disk `.claude/` dirs —
  three sources that disagree about what a "project" is
- **4 of 10** plugins in a version-drifted state right now

Nothing shows this in one place, at both global and project scope, with the ability to
edit what it finds.

### Motivating failure

`subsy/skill-cabinet` (408★) was tried first and displayed nothing. Root cause, from its
`server/scan.js`:

```js
425:  const base = path.join(homeDir(), entry.name);
428:  for (const folder of ["skills", "skill"]) {
429:    add(scopeId, entry.name, path.join(base, folder), "user", false);
432:  if (entry.name === ".cursor") {          // plugins special-case exists
443:    path.join(base, "plugins"),            //   for Cursor ONLY
```

It walks `~/.<tool>/skills` and special-cases `.cursor/plugins`, but never
`.claude/plugins`. It therefore reported **0 skills** when the true answer was **75, in a
directory it did not look in**.

That bug is the design's north star. Reporting `0` for "I didn't look there" is the
failure mode this project exists to avoid.

---

## 2. Goals and non-goals

### Goals

1. Inventory every Claude Code artifact at **global** and **project** scope
2. Make **provenance** visible: which marketplace, repo, version, commit a thing came from
3. Make **inheritance** visible: what a project inherits, overrides, and adds — including
   enterprise managed policy
4. Allow **editing** of artifacts, gated by what is actually safe to edit
5. Run on macOS and Linux, including a corporate-managed laptop, with no install rights

### Non-goals

- Full-text search across session history (deliberately deferred; see §7)
- Usage analytics or cost tracking — `ccusage` (18.5k★) does this well
- Being a Claude Code client — this does not start or drive sessions
- Managing non-Claude agent tools (Cursor, Codex). Possible later; not v1.
- Reimplementing Claude Code's settings-merge semantics (see §6, Tier 3)

---

## 3. Prior art

Researched before committing to a greenfield build.

| Tool | ★ | Covers | Why it isn't enough |
|---|---|---|---|
| `mcpware/cross-code-organizer` | 375 | all artifact types, both scopes | Closest overlap. Framed around remediation (poisoning scan, dedupe, backup), not browsing. Last push 2026-06-07. |
| `davila7/claude-code-templates` | 30.6k | plugins, analytics, chats | Package manager first; browsing is incidental |
| `xingkongliang/skills-manager` | 4.7k | skills across 50+ tools | Skills only |
| `subsy/skill-cabinet` | 408 | skills | Skills only; broken for plugin-based setups |
| `winfunc/opcode` | 22.4k | sessions, agents | Unmaintained since 2025-10 |
| `siteboon/claudecodeui` | 13.7k | remote session driving | Different problem |
| `ccusage/ccusage` | 18.5k | token cost | Different problem |

**Conclusion:** no popular, maintained tool covers the full artifact surface organized by
scope with editing. The large projects are session GUIs or package managers; the one tool
that does inventory properly is small, stale, and framed around cleanup.

---

## 4. Domain model

An early draft used a single unified `Artifact` record. It does not survive contact with
real instances — four incompatible shapes are involved:

| Shape | Example | Provenance | Precedence | Has a path |
|---|---|---|---|---|
| **File** | `CLAUDE.md`, session JSONL | no | no | yes |
| **Declaration** | skill, agent, command | **yes** | shadowing | yes |
| **Settings key** | `model: "opus"` | no | **yes**, per-key | belongs to one, isn't one |
| **Remote object** | published claude.ai artifact | no | no | **no** |

Precedence operates at *key* granularity, not file granularity, so an `effective` field is
meaningless on three of four. The model is therefore:

```
Resource            { id, kind, root, scope, location, writability, read() }
  └─ implemented by 16 readers (§5)

PrecedenceResolver  operates on settings keys only
ProvenanceResolver  operates on plugin-delivered declarations only
```

Resolution layers are **opt-in per kind**, not fields on a god object.

### Artifact kinds (17)

Derived from `claude --safe-mode`'s own enumeration plus `claude plugin details` output —
i.e. Anthropic's canonical list, not a guess:

`settings` · `memory` (CLAUDE.md) · `skill` · `agent` · `command` · `hook` · `mcp` ·
`plugin` · `marketplace` · `outputStyle` · `workflow` · `rule` · `theme` · `keybinding` ·
`lsp` · `session`

Plus a 17th, `mcpLog`, from `~/Library/Caches/claude-cli-nodejs/` (`~/.cache/` on Linux) —
derived rather than canonical, since Claude Code does not list it as a customization.

Five of these (`outputStyle`, `workflow`, `rule`, `theme`, `keybinding`) do not exist on
the author's machine. Each ships with a fixture test rather than manual verification.

---

## 5. Architecture

Single Node process. `npx claude-atlas` serves an API and SPA on `127.0.0.1`.
Chosen over a desktop app or static binary because it needs no install rights,
no code-signing, and no MDM exception on a corporate laptop.

```
npx claude-atlas
  │
  ├─ RootResolver     CLAUDE_CONFIG_DIR → $HOME/.claude; supports N roots
  │                   (work + personal profiles side by side)
  ├─ ScopeRegistry    reconciles .claude.json ⊕ projects/ ⊕ optional disk scan
  │                   → classified scopes
  ├─ Oracle           shells the Claude Code CLI for authoritative facts; cached
  ├─ Readers[kind]    one per artifact kind (§4)
  ├─ Writer           writability policy → backup → atomic write
  └─ HTTP             /api/* + static SPA
```

### 5.1 RootResolver

Resolution order: `CLAUDE_CONFIG_DIR` → `$HOME/.claude`. Never hardcoded. `CLAUDE_CONFIG_DIR`
relocates settings, session history *and* plugins wholesale, and is commonly used to keep
work and personal profiles separate — so N roots are supported and viewable side by side.

Managed policy roots, read but never written:

| OS | Path |
|---|---|
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Linux / WSL | `/etc/claude-code/managed-settings.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-settings.json` |

Also `managed-settings.d/` drop-ins and `managed-mcp.json` in the same directory. The
legacy Windows path `C:\ProgramData\ClaudeCode\` is **not** read by Claude Code and must
not be shown as live policy. Windows registry policy (`HKLM`/`HKCU
\SOFTWARE\Policies\ClaudeCode`) and server-managed settings from the claude.ai console are
out of scope for v1 and surfaced as "may exist, not inspected."

### 5.2 ScopeRegistry

"Project" has three disagreeing definitions. The registry reconciles them into one
classified list:

| Status | Definition | Example on author's machine |
|---|---|---|
| **Configured** | has `.claude/` with real config | `Desktop/projects/payments-api` |
| **Active** | has sessions, no local config | `Desktop/projects/spyglass` |
| **Orphaned** | config on disk, unknown to Claude Code | `vault/.claude` |
| **Stale** | registered or has sessions, directory gone | detected on scan |
| **Noise** | temp dirs, `$HOME`, `~/.claude` itself, fixtures, vendored | 4 `/private/*` entries |

Noise is **collapsed, never hidden** — a single expandable "N filtered" row. Classification
rules are visible and overridable. Silently dropping entries is the skill-cabinet failure
in a different costume.

Discovery is **registry-first**: `~/.claude.json` yields exact project paths at zero cost.
A filesystem scan is an opt-in button for orphans only, because measurement showed it is
both slow and noisy:

| Scan | Time | Hits | Genuine |
|---|---|---|---|
| Bounded (depth 6, skip `Library`/`node_modules`/`.git`) | 0.23 s | 12 | ~4 |
| Deep (skip `node_modules`/`.git` only) | 8.1 s | 30 | ~4 |

Known false positives to classify, not display raw: VS Code extensions shipping their own
`.claude/` and `CLAUDE.md`; plugin marketplace checkouts that are themselves Claude Code
projects.

### 5.3 Oracle — the CLI is authoritative

Claude Code already computes things this tool must not re-derive. Measured:

| Command | Output | Cost |
|---|---|---|
| `claude plugin list --json` | machine-readable inventory | fast |
| `claude plugin details <name>` | component inventory **and projected token cost**, per-component, always-on vs on-invoke | 0.54 s, **text only** (no `--json`) |
| `claude mcp list` | configured MCP servers | fast |
| `claude doctor` | installation health | fast |

`plugin details` already produces the per-plugin token-cost breakdown. Reimplementing that
estimator would be strictly worse — it is Anthropic's tokenizer and loading rules.

**The gap is aggregation.** `plugin details` is per-plugin, one at a time, in a terminal,
and covers plugins only — not user-level skills, not MCP servers (usually the largest
context consumer), not `CLAUDE.md`. Total always-on cost across all sources requires ten
invocations and mental arithmetic. claude-atlas aggregates and ranks what the CLI computes.

Caching: keyed on `(plugin name, version, install mtime)`. Ten plugins ≈ 5.4 s cold,
refreshed in background, never blocking first paint.

Degradation: if `claude` is not on `PATH`, the Oracle tier is marked **unavailable** and
token costs render as `—`. They are never replaced with guesses.

### 5.4 Trust tiers

Every fact in the UI carries the tier it came from:

- **Tier 1 — authoritative.** Shelled from the CLI, cached. Never contradicted by the app.
- **Tier 2 — raw, unambiguous.** Parsed without interpretation: `SKILL.md` frontmatter,
  `plugin.json`, `installed_plugins.json`, JSONL metadata.
- **Tier 3 — derived, visibly marked as inference.** Precedence layering, unused-skill
  joins, drift. Rendered in a distinct "computed" treatment with a "verify in CLI" action.
  Never asserted as fact.

Tier 3 exists because settings-merge semantics are **not uniform per key**: arrays such as
`permissions.allow` merge across scopes while scalars override; `availableModels` never
merges across managed sources; and there are security-sensitive exceptions where a
*stricter* value from a *lower* scope beats managed policy. A naive "highest scope wins"
engine gets these wrong and drifts every release. A tool whose pitch is showing the truth
about configuration must not fabricate it.

Consequently claude-atlas **shows the layers** — every scope a key appears in, in
precedence order, with its source file — and declines to name a winner where the merge
rule is ambiguous.

### 5.5 Writer

Editing is gated by a per-artifact writability class:

| Class | Examples | Treatment |
|---|---|---|
| **Freely editable** | `settings.json`, `CLAUDE.md`, `.claude/settings.local.json`, user-authored skills/agents | Full edit; backup before write |
| **Editable, will be clobbered** | anything under `plugins/cache/` | Edit allowed; persistent banner: *next plugin update overwrites this* |
| **Read-only** | `managed-settings.json` (root-owned), plugin marketplace git checkouts | View, with the reason shown; no write path |
| **Do not hand-edit** | session JSONL (breaks `--resume`), `~/.claude.json` (holds auth session) | View only; editing behind an explicit unlock |

All writes are backup-then-atomic (`write temp → fsync → rename`). Backups land in
`~/.claude-atlas/backups/<timestamp>/` with the original path preserved.

---

## 6. Data flow

Staged so the UI is never blocked on the slow tier:

```
t=0ms     resolve roots, read registry files          → UI renders, scopes listed
t≈50ms    parse global config, skills, agents, hooks  → detail panes populate
t=bg      Oracle: plugin list --json, then details    → token costs stream in per card
on-demand orphan scan (0.23 s) · session parse · MCP logs · cloud artifacts
```

Usable screen in under 100 ms; authoritative data fills in behind it. Nothing waits on
113 MB or on subprocess spawns.

File-watching covers the config plane only (~50 files). `~/.claude/projects/` is watched
at directory level for new sessions, never at content level.

---

## 7. Session handling

Browse and metadata only. No index, no database, no full-text search in v1.

All 616 transcripts are centralised in `~/.claude/projects/` — verified that none exist
outside it — so listing is a directory read, not a search. Metadata (date, size, message
count, model, token totals) is derived by streaming the head and tail of each JSONL;
full parse happens only on click.

Full-text search across sessions is a deliberate deferral, not an oversight. It would
require SQLite FTS5, a background indexer, staleness handling and a first-run build cost.
The reader interface is designed so it can be added without redesign.

---

## 8. Cloud artifacts — known wart

Published claude.ai artifacts cannot be read the way on-disk artifacts can:

- Credentials live in the macOS Keychain (`Claude Code-credentials`), not a file; Linux
  uses an entirely different mechanism
- There is no `claude artifacts` subcommand
- Lifting a token against an undocumented internal API is brittle and out of bounds

The only clean path is shelling out to `claude -p` headless and letting Claude Code's own
authenticated tooling do the listing. That costs a model call and several seconds for what
is, on the author's machine, two artifacts.

**Decision:** manual "Refresh" button. Never automatic, never on startup. Documented as a
wart rather than disguised as a feature.

---

## 9. Error handling

The core rule: **absent ≠ empty ≠ unreadable ≠ malformed.** Readers return a discriminated
result, never a bare array, so the distinction is enforced at the type level.

| State | Forbidden rendering | Required rendering |
|---|---|---|
| Directory does not exist | "0 skills" | *"No user-level skills dir — yours come from plugins"* |
| Exists but empty | "0 skills" | *"Empty"* |
| Exists, permission denied | "0 skills" | *"Present, unreadable (root-owned)"* |
| Exists, malformed JSON | silently skipped | *"Parse error at line N"*, inline, with raw file |

Other degradations:

- `claude` not on `PATH` → Oracle tier marked unavailable; costs show `—`
- Scope directory deleted since registration → `Stale`, offered for cleanup, not dropped
- Version drift (`cachedir 0.1.0` vs `manifest 0.3.3`) → surfaced as a Tier 3 finding

---

## 10. Portability

| Concern | macOS | Linux | Notes |
|---|---|---|---|
| Config root | `$HOME/.claude` | `$HOME/.claude` | `CLAUDE_CONFIG_DIR` overrides both |
| Managed policy | `/Library/Application Support/ClaudeCode/` | `/etc/claude-code/` | root-owned, read-only |
| MCP logs | `~/Library/Caches/claude-cli-nodejs/` | `~/.cache/claude-cli-nodejs/` | 15 MB / 2,278 files observed |
| Credentials | Keychain | libsecret / file | not read directly; see §8 |

Windows is not a v1 target but paths are recorded so the resolver's shape accommodates it.

macOS TCC may restrict a Node process reading `~/Desktop`, `~/Documents`, `~/Downloads`
depending on how it was launched. Permission denials must render as "unreadable", per §9,
never as absence.

---

## 11. Testing

The input is an arbitrary user's filesystem, which is untestable unless fabricated. The
repo commits **fixture trees**, one per scenario, exercised in CI:

| Fixture | Exercises |
|---|---|
| `empty/` | fresh install, nothing configured |
| `plugins-only/` | author's real shape: 0 loose skills, 75 plugin-delivered, 6 marketplaces |
| `managed/` | enterprise policy present, root-owned, unreadable |
| `relocated/` | `CLAUDE_CONFIG_DIR` pointed elsewhere |
| `orphans/` | `.claude` dirs unknown to registry, plus VS Code extension false positive |
| `malformed/` | broken JSON, dangling symlinks, version drift |
| `linux/` | `~/.cache/claude-cli-nodejs`, `/etc/claude-code/` paths |

- Golden-output tests on `ScopeRegistry` — the reconciler is where subtle bugs live
- Oracle mocked with recorded real CLI output (`plugin list --json`, `plugin details`)
- Writer tested against a temp tree: backup, atomic rename, read-only refusal,
  clobber-warning path

The `managed/` fixture makes corporate-laptop behaviour testable from a personal machine.

---

## 12. Open questions

1. Whether `GLOBAL` and project scopes share one rail or split into two top-level tabs —
   a UI decision, deferred to implementation.
2. Name. `claude-atlas` is a working title.

Windows is **not** an open question: §10 settles it as out of scope for v1, with paths
recorded so the resolver's shape accommodates it later.
