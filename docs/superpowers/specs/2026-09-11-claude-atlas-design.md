# claude-atlas — Design

**Date:** 2026-09-11
**Revision:** 2 (see §14)
**Status:** In review
**Author:** Andrew Poole (with Claude)

---

## 1. Problem

Claude Code's configuration surface has outgrown the ability to inspect it. Measured on the
author's machine:

- **75** `SKILL.md` files, **zero** in `~/.claude/skills` — all delivered by plugins
- **10** plugins from **6** marketplaces, 5 of them individual GitHub accounts
- **616** session transcripts, **37,420** lines, **113 MB**
- **2,278** MCP server log files in `~/Library/Caches/claude-cli-nodejs/` (15 MB)
- **11** registered projects, **13** session directories, **3** on-disk `.claude/` dirs —
  three sources that disagree about what a "project" is
- **4 of 10** plugins version-drifted right now

Nothing shows this in one place, at global and project scope, with the ability to edit it.

### Motivating failure

`subsy/skill-cabinet` (408★) was tried first and displayed nothing. Root cause, from
`server/scan.js`:

```js
425:  const base = path.join(homeDir(), entry.name);
428:  for (const folder of ["skills", "skill"]) {
429:    add(scopeId, entry.name, path.join(base, folder), "user", false);
432:  if (entry.name === ".cursor") {          // plugins special-case exists
443:    path.join(base, "plugins"),            //   for Cursor ONLY
```

It walks `~/.<tool>/skills` and special-cases `.cursor/plugins`, never `.claude/plugins`.
It reported **0 skills** when the true answer was **75, in a directory it did not look in**.

That bug is the north star: reporting `0` for "I didn't look there" is the failure mode
this project exists to prevent. §10 turns it into an enforced invariant.

---

## 2. Goals and non-goals

### Goals

1. Inventory every Claude Code artifact at **global** and **project** scope
2. Make **provenance** visible: marketplace, repo, version, commit
3. Make **inheritance** visible: what a project inherits, overrides, adds — including
   enterprise managed policy
4. Allow **editing**, gated by what is actually safe to edit
5. Run on macOS and Linux, including a corporate-managed laptop, with no install rights

### Non-goals

- Usage analytics / cost tracking — `ccusage` (18.5k★) does this well
- Being a Claude Code client — this does not start or drive sessions
- Managing non-Claude agent tools (Cursor, Codex) — possible later, not v1
- Reimplementing Claude Code's settings-merge semantics (§6.4)
- Windows support in v1 (paths recorded; resolver shaped to accommodate)

---

## 3. Prior art

| Tool | ★ | Covers | Why insufficient |
|---|---|---|---|
| `mcpware/cross-code-organizer` | 375 | all kinds, both scopes | Closest overlap. Framed around remediation (poisoning scan, dedupe, backup), not browsing. Last push 2026-06-07. |
| `davila7/claude-code-templates` | 30.6k | plugins, analytics, chats | Package manager first; browsing incidental |
| `xingkongliang/skills-manager` | 4.7k | skills across 50+ tools | Skills only |
| `subsy/skill-cabinet` | 408 | skills | Skills only; broken for plugin-based setups |
| `winfunc/opcode` | 22.4k | sessions, agents | Unmaintained since 2025-10 |
| `siteboon/claudecodeui` | 13.7k | remote session driving | Different problem |
| `ccusage/ccusage` | 18.5k | token cost | Different problem |

No popular, maintained tool covers the full artifact surface organized by scope with
editing. Greenfield was chosen over forking cross-code-organizer because its data model is
built around cleanup actions rather than browsing and inheritance; its discovery logic is
nonetheless the closest reference implementation and worth reading before building §6.1.

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

Precedence operates at *key* granularity, so an `effective` field is meaningless on three
of four. The model is therefore:

```
Resource            { id, kind, root, scope, location, writability, read() }
PrecedenceResolver  settings keys only
ProvenanceResolver  plugin-delivered declarations only
```

Resolution layers are **opt-in per kind**, not fields on a god object.

### 4.1 Artifact kinds

Every path below is taken from official documentation (`/docs/en/claude-directory`,
`/docs/en/settings`) or observed on disk — **not inferred from help strings**. Revision 1
asserted five kinds with no verified location; this table corrects that.

| Kind | Global path | Project path | Evidence |
|---|---|---|---|
| `settings` | `~/.claude/settings.json` | `.claude/settings.json`, `.claude/settings.local.json` | docs + observed |
| `managedSettings` | §6.1 table | — | docs |
| `memory` | `~/.claude/CLAUDE.md` | `CLAUDE.md` | observed |
| `memoryStore` | `~/.claude/memory/`, `MEMORY.md` | `<project>/memory/`, `agent-memory/` | docs |
| `skill` | `~/.claude/skills/` | `.claude/skills/` | docs (0 here; 75 via plugins) |
| `agent` | `~/.claude/agents/` | `.claude/agents/` | docs + observed in plugins |
| `command` | `~/.claude/commands/` | `.claude/commands/` | docs + observed in plugins |
| `hook` | `settings.json` → `hooks` | same | observed (1 `PreToolUse`) |
| `mcp` | `~/.claude.json` → `mcpServers` | `.mcp.json`, per-project in `~/.claude.json` | docs + observed |
| `plugin` | `~/.claude/plugins/` | — | observed (10) |
| `marketplace` | `~/.claude/plugins/marketplaces/` | — | observed (6) |
| `outputStyle` | `~/.claude/output-styles/` | — | **docs** (absent here) |
| `workflow` | `~/.claude/workflows/` | `.claude/workflows/` | **docs** (absent here) |
| `rule` | `~/.claude/rules/` | `.claude/rules/` (nests, e.g. `rules/frontend/react.md`) | **docs** (absent here) |
| `theme` | `~/.claude/themes/` | — | **docs** (absent here) |
| `keybinding` | `~/.claude/keybindings.json` | — | **docs** (absent here) |
| `lsp` | plugin-provided | — | `claude plugin details` output |
| `session` | `~/.claude/projects/**/*.jsonl` | — | observed (616) |
| `mcpLog` | `~/Library/Caches/claude-cli-nodejs/` (`~/.cache/` Linux) | — | observed (2,278) |
| `worktreeConfig` | — | `.worktreeinclude` | docs |

Nine kinds are absent from the author's machine. They are implemented against documented
paths and exercised by fixtures (§12) — a fixture built from a documented path tests the
documentation, not a guess. Where the format is undocumented, the reader ships as
**inventory-only** (name, path, size, mtime) and does not attempt structured parsing.

---

## 5. Architecture

Single Node process. `npx claude-atlas` serves an API and SPA on `127.0.0.1`. Chosen over a
desktop app or static binary because it needs no install rights, no code-signing and no MDM
exception on a corporate laptop.

```
npx claude-atlas
  │
  ├─ Security       per-run token, Origin/Host enforcement  (§9 — gates all writes)
  ├─ RootResolver   CLAUDE_CONFIG_DIR → $HOME/.claude; N roots
  ├─ ScopeRegistry  reconciles .claude.json ⊕ projects/ ⊕ optional scan → classified scopes
  ├─ Oracle         shells the Claude Code CLI for authoritative facts; cached
  ├─ Readers[kind]  one per §4.1 kind
  ├─ Writer         writability policy → validate → backup → atomic write  (§8)
  └─ HTTP           /api/* + static SPA
```

---

## 6. Discovery

### 6.1 RootResolver

Order: `CLAUDE_CONFIG_DIR` → `$HOME/.claude`. Never hardcoded. `CLAUDE_CONFIG_DIR`
relocates settings, session history *and* plugins wholesale and is commonly used to separate
work from personal profiles, so N roots are supported.

**Multi-root UX:** roots are a top-level switcher, not a merge. Each root gets its own
scope rail; artifacts are never blended across roots, because a "skill" in the work profile
and one in the personal profile are unrelated objects that happen to share a name. A
side-by-side compare view is explicitly deferred to v2.

Managed policy roots — read, never written:

| OS | Path |
|---|---|
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Linux / WSL | `/etc/claude-code/managed-settings.json` |
| Windows | `C:\Program Files\ClaudeCode\managed-settings.json` |

Also `managed-settings.d/` drop-ins and `managed-mcp.json` in the same directory. The legacy
Windows path `C:\ProgramData\ClaudeCode\` is **not** read by Claude Code and must never be
shown as live policy. Windows registry policy and server-managed settings from the claude.ai
console are surfaced as "may exist, not inspected."

### 6.2 ScopeRegistry

"Project" has three disagreeing definitions, reconciled into one classified list:

| Status | Definition | Example |
|---|---|---|
| **Configured** | has `.claude/` with real config | `Desktop/projects/payments-api` |
| **Active** | has sessions, no local config | `Desktop/projects/spyglass` |
| **Orphaned** | config on disk, unknown to Claude Code | `vault/.claude` |
| **Stale** | registered or has sessions, directory gone | detected on scan |
| **Noise** | temp dirs, `$HOME`, `~/.claude`, fixtures, vendored | 4 `/private/*` entries |

Noise is **collapsed, never hidden** — one expandable "N filtered" row, with visible,
overridable rules. Silently dropping entries is the skill-cabinet failure in a new costume.

Discovery is **registry-first**: `~/.claude.json` yields exact paths at zero cost. Filesystem
scan is opt-in, for orphans only, because it is slow *and* noisy:

| Scan | Time | Hits | Genuine |
|---|---|---|---|
| Bounded (depth 6; skip `Library`/`node_modules`/`.git`) | 0.23 s | 12 | ~4 |
| Deep (skip `node_modules`/`.git`) | 8.1 s | 30 | ~4 |

Known false positives to classify rather than display raw: VS Code extensions shipping their
own `.claude/` and `CLAUDE.md`; plugin marketplace checkouts that are themselves Claude Code
projects.

### 6.3 Oracle — the CLI is authoritative

| Command | Output | Cost |
|---|---|---|
| `claude plugin list --json` | machine-readable inventory | fast |
| `claude plugin details <name>` | component inventory **and projected token cost** | 0.54 s, **text only** |
| `claude mcp list` | configured MCP servers | fast |
| `claude doctor` | installation health | fast |

`plugin details` already produces per-plugin token costs. Reimplementing that estimator would
be strictly worse — it is Anthropic's tokenizer and loading rules.

**The gap is aggregation.** `plugin details` is per-plugin, one at a time, in a terminal,
plugins only — not user skills, not MCP servers (usually the largest consumer), not
`CLAUDE.md`. Total always-on cost currently requires ten invocations and mental arithmetic.

Cache key: `(plugin name, version, install mtime)`. Ten plugins ≈ 5.4 s cold, refreshed in
background, never blocking first paint.

**Extraction fragility (revision 2).** `plugin details` has no `--json`, so the Oracle must
parse human-formatted aligned text (`~650 tok`, `~22.1k`). The *source* is authoritative; the
*extraction* is the most brittle code in the system. Mitigations, all required:

1. Parser asserts against a recorded golden sample per supported CLI version range
2. On parse failure, degrade to **inventory-only** and show costs as `—`; never guess
3. `claude --version` recorded alongside cached results; mismatch invalidates cache
4. `plugin list --json` (stable, machine-readable) is the primary source; `details` enriches

### 6.4 Trust tiers

- **Tier 1 — authoritative.** Shelled from the CLI, cached, subject to §6.3's mitigations.
- **Tier 2 — raw, unambiguous.** Parsed without interpretation: `SKILL.md` frontmatter,
  `plugin.json`, `installed_plugins.json`, JSONL records.
- **Tier 3 — derived, visibly marked as inference.** Precedence layering, unused-skill joins,
  drift. Rendered in a distinct "computed" treatment with a "verify in CLI" action.

Tier 3 exists because settings-merge semantics are **not uniform per key**: arrays such as
`permissions.allow` merge across scopes while scalars override; `availableModels` never merges
across managed sources; and security-sensitive exceptions let a *stricter* value from a *lower*
scope beat managed policy. A naive "highest scope wins" engine gets these wrong and drifts
every release.

claude-atlas therefore **shows the layers** — every scope a key appears in, in precedence
order, with its source file — and declines to name a winner where the merge rule is ambiguous.

---

## 7. Sessions

**Revision 2 correction.** Revision 1 claimed metadata was derivable by streaming head and
tail. That is false: only **1 of 20** sampled files carries a tail summary, and no cumulative
token field exists anywhere. But the conclusion drawn from it — that an index would therefore
be needed — was also wrong. Measured:

| Operation | Scope | Time |
|---|---|---|
| `stat` all sessions | 616 files | 0.67 s |
| line count, no parse | 113 MB | 0.35 s |
| **full JSON parse, whole corpus** | **616 files / 37,420 lines / 113 MB** | **0.75 s** |
| full parse, single 13 MB session | 5,576 lines | 0.055 s |

Zero unparseable lines across the corpus. **Full parse is affordable**, so no SQLite, no
FTS index, no background indexer, and no staleness machinery.

Design: parse lazily on first view; cache derived metadata (message count, models, token
totals, date range, git branch, cwd) in a sidecar keyed on `(path, size, mtime)`. A full
corpus warm costs under a second and may run in background on idle.

Full-text search is deferred to v2 but is now cheap to add — a linear scan of 113 MB is
sub-second, so it likely never needs an index either.

---

## 8. Editing

The user requirement is management, not just viewing. Revision 1 specified *who* may write
but not *how*; this section supplies it.

### 8.1 Writability classes

| Class | Examples | Treatment |
|---|---|---|
| **Freely editable** | `settings.json`, `CLAUDE.md`, `settings.local.json`, user-authored skills/agents/commands/rules | Full edit; validate; backup; atomic write |
| **Redirect** | anything under `plugins/cache/` | Edit **refused** with a link to the marketplace checkout or a "fork to user scope" action — the cache copy is overwritten on next plugin update, so editing it is nearly always a mistake |
| **Read-only** | `managed-settings.json` (root-owned), marketplace git checkouts | View, with reason shown; no write path |
| **Guarded** | session JSONL (breaks `--resume`), `~/.claude.json` (holds auth session) | View only; editing behind an explicit typed confirmation |

Revision 1 allowed `plugins/cache/` edits behind a warning banner. That was a footgun; it is
now a redirect.

### 8.2 Editor surface

- **Structured form + raw toggle** for files with a known schema (`settings.json`,
  `keybindings.json`). Raw is always reachable; the form never blocks an unknown key.
- **Raw text with syntax highlighting** for Markdown artifacts (`CLAUDE.md`, `SKILL.md`,
  rules) and for any file whose schema is unknown.
- **No editor at all** for Guarded and Read-only classes.

### 8.3 Validation

Claude Code **silently ignores** malformed settings in `-p` mode, so an invalid save fails
invisibly. Validation is therefore mandatory before write, not advisory:

- JSON parse check on every JSON artifact; save blocked on failure with line/column
- Schema validation where a published schema exists — `keybindings.json` has one at
  `schemastore.org/claude-code-keybindings.json`. Unknown keys warn, never block, because
  the tool must not stop the user configuring a newer Claude Code than it knows about.
- `SKILL.md` frontmatter checked for required `name` / `description`
- Post-write verification: re-read and re-parse; report mismatch loudly

### 8.4 Concurrency

Claude Code writes these files while the app is open. Every write is therefore
compare-and-swap on `(size, mtime, content hash)` captured at read time. On mismatch the save
is refused and a three-way view offered (your edit / on-disk / original). No silent
last-writer-wins.

### 8.5 Deletion

Revision 1 implied deletion ("Stale scopes offered for cleanup") without specifying it.
v1 scope:

- **Only** Stale scope registry entries and orphaned backups may be deleted
- Artifacts themselves are **never** deleted in v1 — no skill/agent/plugin removal
- Plugin removal is delegated to `claude plugin uninstall`, surfaced as a copyable command
- All deletions go through the same backup path and are listed in an undo log

skill-cabinet's "Delete removes the skill from disk... There is no undo" is the behaviour
being avoided.

### 8.6 Backups and retention

Backups land in `~/.claude-atlas/backups/<ISO-timestamp>/<original-path>`. Retention: last 50
revisions per file, or 30 days, whichever is larger; plus a hard 500 MB cap, oldest evicted
first. Guarded-class files (multi-MB session JSONL) are excluded from automatic backup and
require explicit opt-in per save, since a single edit would otherwise copy 13–40 MB.

---

## 9. Security

**Added in revision 2.** Revision 1 had no security model, which was its most serious defect:
the app binds a local HTTP server that writes files, and `hook` is a writable artifact kind —
hooks execute shell on every tool use. An unauthenticated localhost writer is therefore a
remote code execution primitive.

Required, all of them:

1. **Per-run bearer token.** A random token is generated at startup, embedded in the URL the
   browser opens, and required on every `/api/*` request. Not persisted between runs.
2. **Origin and Host enforcement.** Requests whose `Origin` is not the exact bound origin are
   rejected; `Host` must match `127.0.0.1:<port>`. This blocks DNS-rebinding attacks, which
   defeat IP-based checks alone.
3. **Writes are token-gated and same-origin only.** `GET` may be read-only-permissive;
   anything mutating requires token + origin + a non-simple content type.
4. **Bind `127.0.0.1` explicitly**, never `0.0.0.0`. No tunnel, no LAN exposure, no remote
   mode — cross-code-organizer and claude-code-templates both offer tunnels; this does not.
5. **Hook writes require a second confirmation** naming the shell command being installed,
   because that is the one artifact class that converts a write into execution.
6. **No eval of artifact content.** Skills, hooks and settings are rendered as inert text;
   nothing read from disk is ever executed or interpolated into a shell command.

Threat model explicitly excluded: a local attacker who already has the user's UID can edit
`~/.claude` directly and does not need this app. The defence is against *browser-originated*
and *other-process* access to the local port, not against local root.

---

## 10. Error handling

Core invariant: **absent ≠ empty ≠ unreadable ≠ malformed.** Readers return a discriminated
result, never a bare array, so the distinction is enforced at the type level.

| State | Forbidden rendering | Required rendering |
|---|---|---|
| Directory does not exist | "0 skills" | *"No user-level skills dir — yours come from plugins"* |
| Exists but empty | "0 skills" | *"Empty"* |
| Permission denied | "0 skills" | *"Present, unreadable (root-owned)"* |
| Malformed JSON | silently skipped | *"Parse error at line N"*, inline, with raw file |

Other degradations: `claude` absent from `PATH` → Oracle marked unavailable, costs show `—`;
scope directory deleted → `Stale`, offered for cleanup, never dropped; version drift
(`cachedir 0.1.0` vs `manifest 0.3.3`) → surfaced as a Tier 3 finding.

---

## 11. Interface

**Added in revision 2.** Revision 1 specified no screens for a project whose premise is a UI.

**Shell:** left rail = root switcher (§6.1) then scope list; main pane = selected scope;
persistent global search across every artifact in the active root.

| Screen | Content |
|---|---|
| **Scope overview** | Artifact kinds present at this scope with counts, each row stating absent / empty / unreadable per §10. Entry point to everything. |
| **Inheritance** | For a project scope: every settings key rendered as managed → project-local → shared project → user, with source file per layer and no asserted winner (§6.4). The screen that justifies organizing by scope. |
| **Context budget** | Aggregate always-on token cost across plugins, skills, MCP, `CLAUDE.md`, ranked descending, sourced from the Oracle. The aggregation `claude plugin details` cannot do. |
| **Supply chain** | Plugins and marketplaces with repo, version, commit SHA, install date, drift status, and which of them ship hooks. |
| **Artifact detail** | Content, provenance, writability class, and the editor per §8. |
| **Sessions** | Per-scope session list; metadata per §7; read-only transcript view. |

Deferred to v2: declared-vs-used join (requires the session parse of §7 to be routine
first), side-by-side root compare, snapshot diffing over time.

---

## 12. Testing

Input is an arbitrary user's filesystem, untestable unless fabricated. The repo commits
**fixture trees** exercised in CI:

| Fixture | Exercises |
|---|---|
| `empty/` | fresh install, nothing configured |
| `plugins-only/` | author's real shape: 0 loose skills, 75 plugin-delivered, 6 marketplaces |
| `managed/` | enterprise policy present, root-owned, unreadable |
| `relocated/` | `CLAUDE_CONFIG_DIR` pointed elsewhere |
| `orphans/` | `.claude` unknown to registry, plus VS Code extension false positive |
| `malformed/` | broken JSON, dangling symlinks, version drift |
| `rare-kinds/` | the nine kinds absent from the author's machine, at documented paths |
| `linux/` | `~/.cache/claude-cli-nodejs`, `/etc/claude-code/` |

- Golden-output tests on `ScopeRegistry` — the reconciler is where subtle bugs live
- Oracle mocked with recorded real CLI output, plus a malformed-output case proving §6.3's
  degrade path
- Writer tested against a temp tree: validation, backup, atomic rename, read-only refusal,
  redirect path, CAS conflict
- **Security tests are mandatory, not optional**: missing token rejected, wrong `Origin`
  rejected, rebinding `Host` rejected, hook write without second confirmation rejected

---

## 13. Delivery phases

Revision 1 had no phasing; 20 kinds plus reconciler, oracle, writer, SPA and 8 fixtures is
not one increment.

| Phase | Contents | Exit criterion |
|---|---|---|
| **1 — See it** | Security baseline (§9), RootResolver, ScopeRegistry, readers for settings/memory/skill/agent/command/hook/mcp/plugin/marketplace, scope overview + artifact detail, read-only | Author's machine renders all 75 skills and 10 plugins correctly |
| **2 — Trust it** | Oracle + context budget + supply chain + inheritance view | Aggregate token cost matches the sum of ten `plugin details` runs |
| **3 — Change it** | Writer: validation, backup, CAS, redirect, guarded classes | Round-trip edit of `settings.json` under a live Claude Code session refuses cleanly |
| **4 — Complete it** | Sessions, mcpLogs, the nine rare kinds, cloud artifacts | `rare-kinds/` fixture green |

Phase 1 is independently useful and is the honest MVP.

---

## 14. Revision history

**Revision 2 — 2026-09-11.** Adversarial review of revision 1 found twelve defects; the
material fixes:

1. **§7 rewritten.** R1 claimed head/tail streaming yields metadata — false (1 of 20 files).
   But the remedial conclusion "therefore an index is needed" was also false: full parse of
   the whole 113 MB corpus is **0.75 s**. No index, no database, measured not assumed.
2. **§9 added.** R1 had no security model while writing files that execute shell. Token +
   origin enforcement + hook double-confirmation are now required.
3. **§4.1 corrected.** R1 asserted five kinds from a `--safe-mode` help string with no
   verified location. All now carry documented paths, and four further kinds were found that
   R1 missed entirely (`memoryStore`, project `.mcp.json`, `worktreeConfig`, `MEMORY.md`).
4. **§11 added.** R1 described no screens for a UI project.
5. **§8 added.** R1 specified who may write, never how. Adds validation, concurrency (CAS),
   deletion scope, backup retention.
6. **§6.3 mitigations added** for text-scraping `plugin details` — R1 called Tier 1
   "authoritative" while its parser was the most fragile code in the system.
7. **§8.1 `plugins/cache/`** changed from warn-and-allow to redirect.
8. **§6.1 multi-root UX** defined rather than asserted.
9. **§13 added** — phasing and an MVP cut.

Open: the rail-vs-tabs layout question, and the name.
