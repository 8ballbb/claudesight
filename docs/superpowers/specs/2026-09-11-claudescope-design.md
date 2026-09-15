# claudescope — Design

**Date:** 2026-09-11
**Revision:** 6 (see §14)
**Status:** In review
**Author:** Andrew Poole (with Claude)

---

## 1. Problem

Claude Code's configuration surface has outgrown the ability to inspect it. Measured:

- **23** active `SKILL.md`, **zero** in `~/.claude/skills` — all plugin-delivered. (75 SKILL.md
  exist under `~/.claude` in total, but 52 sit in `plugins/marketplaces` — git checkouts
  holding skills for 35 plugins that are **not installed**. Only `plugins/cache` holds
  loadable copies. Revisions 1-3 of this spec quoted the naive 75; see §14.)
- **10** plugins from **6** marketplaces, 5 of them individual GitHub accounts
- **1** plugin genuinely version-drifted (`spyglass` recorded `0.1.0`, manifest `0.3.3`);
  **3** more with no recorded version at all
- **152** session transcripts plus **468** subagent transcripts, 105 MiB
- **5** auto-memory directories, 4 `MEMORY.md`, 14 topic files
- **11** registered projects, **13** session directories, **3** on-disk `.claude/` dirs —
  three sources that disagree about what a "project" is
- A global `CLAUDE.md` of **8 bytes** whose entire content is `@NOTES.md` — the real
  instructions live in a file no listing shows
- A `PreToolUse` hook whose executable body is `~/.claude/hooks/format-hook.sh`, and a
  `statusLine.command` running `~/.claude/statusline-command.sh` — both shell, both
  invisible to every existing tool

Nothing shows this in one place, at global and project scope, **and lets you edit it**.

### Motivating failure

`subsy/skill-cabinet` (408★) displayed nothing. Root cause, `server/scan.js`:

```js
428:  for (const folder of ["skills", "skill"]) {
429:    add(scopeId, entry.name, path.join(base, folder), "user", false);
432:  if (entry.name === ".cursor") {          // plugins special-case exists
443:    path.join(base, "plugins"),            //   for Cursor ONLY
```

It reported **0 skills** when the answer was **23, in a directory it did not look in**.

**Revision 2 of this spec reproduced that exact bug twice**: it placed `memoryStore` at a
path that does not exist and declared the kind absent, when 5 populated memory directories
were sitting at the real path; and its deep scan swallowed 124 permission-denied directories
as "not found." §10 now makes the invariant structural rather than aspirational.

---

## 2. Goals and non-goals

### Goals

1. Inventory every Claude Code artifact at **global** and **project** scope
2. **Edit** what is safe to edit, in place — the differentiator (§3)
3. Make **provenance** visible: marketplace, repo, version, commit
4. Make **inheritance** visible, including enterprise managed policy
5. Run on macOS and Linux, including a corporate-managed laptop, with no install rights

### Non-goals

- Usage analytics / cost tracking — `ccusage` does this
- Being a Claude Code client — does not start or drive sessions
- Managing non-Claude agent tools — not v1
- Reimplementing Claude Code's settings-merge semantics beyond the enumerated set (§6.4)
- Windows support in v1 (paths recorded; resolver shaped for it)

---

## 3. Prior art — and the honest differentiator

| Tool | ★ | Covers |
|---|---|---|
| `mcpware/cross-code-organizer` (CCO) | 375 | **all kinds, both scopes, browser dashboard via npx, scope side-by-side, precedence badges (`GLOBAL`/`ANCESTOR`/`SHADOWED`/`⚠ CONFLICT`), per-item token counts via `ai-tokenizer`** |
| `davila7/claude-code-templates` | 30.6k | package manager; analytics; chats |
| `xingkongliang/skills-manager` | 4.7k | skills only, 50+ tools |
| `subsy/skill-cabinet` | 408 | skills only; broken for plugin setups |
| `winfunc/opcode` | 22.4k | sessions; unmaintained since 2025-10 |
| `ccusage/ccusage` | 18.5k | token cost |

**Revision 2 claimed CCO was "framed around remediation, not browsing." That was
rationalisation and is withdrawn.** CCO ships a browsing dashboard covering five of the six
screens in §11, with the same `npx` delivery model, actively maintained.

What CCO does **not** do is **edit**. It moves and deletes; it marks config and plugins
*Locked*. Editing artifacts in place is the user's explicit requirement and the one thing
genuinely absent from the market.

**Therefore: editing is not a later phase, it is the product.** If claudescope is not an
editor in its first shippable version, it has no reason to exist over `npx
@mcpware/cross-code-organizer`. §13 is phased accordingly.

Secondary differentiators, in order of defensibility: resolving `@`-imports so memory is
actually readable; surfacing hook and statusline **script bodies**; the declared-vs-used
join (§11).

---

## 4. Domain model

Three shapes, not four (revision 2's fourth existed to accommodate two cloud objects):

| Shape | Example | Provenance | Precedence |
|---|---|---|---|
| **File** | `CLAUDE.md`, `format-hook.sh`, session JSONL | no | no |
| **Declaration** | skill, agent, command | yes | shadowing |
| **Settings key** | `model`, `statusLine.command` | no | yes, per-key |

Cloud artifacts (§12) are a fourth, degenerate case handled entirely in one reader.

```
Resource   { id, kind, root, scope, location, writability, read() }
```

`id` is an **opaque server-side handle** from a scan-time table — never path-derived and
never path-reconstructed (§9.4). Precedence and provenance are functions over resources,
not fields on them.

### 4.1 Artifact kinds

Every path verified against `code.claude.com/docs` or observed on disk. Revision 2's table
contained four wrong paths and omitted eleven artifacts present on this machine.

| Kind | Global | Project | Notes |
|---|---|---|---|
| `settings` | `~/.claude/settings.json` | `.claude/settings.json`, `.claude/settings.local.json` | |
| `managedSettings` | §6.1 ranked sources | — | four sources, not one |
| `managedMemory` | `<managed dir>/CLAUDE.md` + `claudeMd` key | — | **cannot be excluded by user settings** |
| `memory` | `~/.claude/CLAUDE.md` | `CLAUDE.md`, `./.claude/CLAUDE.md`, `CLAUDE.local.md`, **and every ancestor dir to repo root** | `@`-imports depth 4; `claudeMdExcludes` |
| `autoMemory` | `~/.claude/projects/<project>/memory/{MEMORY.md,*.md}` | — | relocatable via `autoMemoryDirectory`; **subtree of the session root** |
| `agentMemory` | `~/.claude/agent-memory/` | `.claude/agent-memory/`, `.claude/agent-memory-local/` | three variants by `memory:` frontmatter |
| `skill` | `~/.claude/skills/`, **`~/.claude/skills/synced/`** | `.claude/skills/` + nested + ancestors | `synced/` is claude.ai-sourced ⇒ Redirect class |
| `agent` | `~/.claude/agents/` | `.claude/agents/` + ancestors | |
| `command` | `~/.claude/commands/` | `.claude/commands/` + ancestors | |
| `hook` | `settings.json` → `hooks` | same, **plus plugin `hooks/hooks.json`** | types: `command`, `http`, `mcp_tool`, `prompt`, `agent` |
| **`hookScript`** | `~/.claude/hooks/*.sh` | any path a hook names | **executable body — new in r3** |
| **`statusLineScript`** | path named by `statusLine.command` | — | **executable body — new in r3** |
| `mcp` | `~/.claude.json` → `mcpServers` | `.mcp.json`, `~/.claude.json` → `projects[].mcpServers` | **plus plugin `.mcp.json` and claude.ai connectors, which are in no local file** |
| `plugin` | `~/.claude/plugins/` | `enabledPlugins` in project settings | install scope: user/project/local |
| `marketplace` | `~/.claude/plugins/marketplaces/` | `extraKnownMarketplaces` | |
| `outputStyle` | `~/.claude/output-styles/` | `.claude/output-styles/` + ancestors, closest wins | |
| `workflow` | `~/.claude/workflows/` | `.claude/workflows/` + ancestors | `.js`, `meta.name`/`meta.description` parseable |
| `rule` | `~/.claude/rules/` | `.claude/rules/**` + ancestors | recursive |
| `theme` | `~/.claude/themes/` | — | |
| `keybinding` | `~/.claude/keybindings.json` | — | schema on schemastore |
| `lsp` | plugin `.lsp.json` / `lspServers` | — | plugin-only |
| `session` | `~/.claude/projects/<project>/<session>.jsonl` | — | **depth-2 only** |
| `subagentTranscript` | `…/<session>/subagents/*.jsonl` | — | 468 here; separate kind |
| `worktreeConfig` | — | `.worktreeinclude` at repo root | |
| `mcpLog` | `~/Library/Caches/claude-cli-nodejs/` (`~/.cache/` Linux) | — | diagnostics panel only (§12) |

Plugins additionally ship `themes/`, `output-styles/`, `rules/`, `monitors/monitors.json`,
`bin/` — the plugin reader handles all component dirs generically.

**Rare kinds are config-driven, not hand-coded.** Kinds with no instance on the author's
machine are declared as `(kind, path, glob, parser?)` rows and rendered inventory-only when
no parser exists. Revision 2's per-kind `rare-kinds/` fixture is deleted — it tested guesses.

---

## 5. Architecture

Single Node process, run with `npx`, API + SPA on `127.0.0.1`. Chosen for needing no
install rights, code-signing or MDM exception. Published as
`npx @andrewpoolejames/claudescope`, or `npx github:8ballbb/claudescope` to run the
current main. The package is scoped because npm rejects the bare name `claudescope` as
too similar to an unrelated `claude-scope`; a 404 on the registry means unregistered,
not available, and the two differ only at publish time.

**Stack decided** (revision 2 left it open; that is where side projects stall): Vite +
React + plain CSS modules. No component library, no state manager. ~7 screens.

```
claudescope
  ├─ Security      Origin/Host/JSON gate, CSP, value-shape write gate       (§9)
  ├─ RootResolver  CLAUDE_CONFIG_DIR → $HOME/.claude                        (§6.1)
  ├─ ScopeRegistry reconciles registry ⊕ sessions ⊕ default bounded scan    (§6.2)
  ├─ Oracle        CLI fan-out, bounded concurrency 8                       (§6.3)
  ├─ Readers[kind] config-driven table (§4.1)
  ├─ Writer        classify → validate → gate → lock → backup → atomic      (§8)
  ├─ Workers       session parsing off the main thread                      (§7)
  └─ HTTP          /api/* + static SPA
```

---

## 6. Discovery

### 6.1 RootResolver

`CLAUDE_CONFIG_DIR` → `$HOME/.claude`. It relocates settings, session history, plugins
**and `~/.claude.json`** — everything. Honoured as a single root; **no multi-root switcher**
(revision 2 designed a UI for a configuration not in evidence; the work-laptop requirement
is a second *machine*, which `npx` already satisfies).

**Managed policy is four ranked sources, not one file.** Under the default
`managedSourcesBehavior: "first-wins"`, Claude Code uses the highest-ranked source
delivering a policy key and **silently ignores the rest**:

1. Remote / server-managed — cached locally at `~/.claude/remote-settings.json`, plus `~/.claude/policy-limits.json`
2. **MDM/OS policy** — macOS managed-preferences domain `com.anthropic.claudecode` (readable via `plutil`); Windows `HKLM\SOFTWARE\Policies\ClaudeCode`
3. `managed-settings.json` + `managed-settings.d/*.json` + `managed-mcp.json`, in the system dir
4. `HKCU\SOFTWARE\Policies\ClaudeCode`

System dir: macOS `/Library/Application Support/ClaudeCode/`, Linux/WSL `/etc/claude-code/`,
Windows `C:\Program Files\ClaudeCode\`. The legacy `C:\ProgramData\ClaudeCode\` is **not**
read and must never be shown as live policy.

On a corporate macOS laptop with an MDM profile — the exact target scenario — rendering
`managed-settings.json` as live policy is **wrong**. A file outranked by a higher source is
labelled **"present but skipped — MDM outranks it."** `/status`'s `Setting sources` line is
the ground truth.

### 6.2 ScopeRegistry

| Status | Definition | Example |
|---|---|---|
| **Configured** | has `.claude/` with real config | `code/payments-api` |
| **Active** | has sessions, no local config | `Desktop/projects/spyglass` |
| **Orphaned** | config on disk, unknown to Claude Code | `vault/.claude` |
| **Stale** | registered, directory gone | on scan |
| **Noise** | temp dirs, `$HOME`, `~/.claude`, vendored, fixtures | 4 `/private/*` |

Noise is **collapsed, never hidden**, with visible overridable rules.

**The bounded scan runs by default** (revision 2 made it opt-in). It measures 0.054–0.23 s
and finds orphans the registry cannot; hiding a quarter-second behind a toggle is the
"didn't look there" failure relocated from code into defaults. Deep scan (3.7–8.1 s) stays
opt-in.

**Scan results are a discriminated result, not a list.** A deep walk of `$HOME` hits **124
permission-denied directories** on this machine (`~/Library/Messages`, `~/Library/Safari`,
…), and on a fresh install macOS TCC additionally gates `~/Desktop`, `~/Documents`,
`~/Downloads` — where the author's own projects live. The scanner returns
`{scanned, denied[]}` and the UI renders *"N directories unreadable (macOS privacy
protection)"* with a Full Disk Access hint. Silently returning fewer results is forbidden.

Project scope is **not one `.claude/` at the repo root**: skills, agents, commands, rules,
workflows and output-styles load from every directory between cwd and repo root, closest
wins.

### 6.3 Oracle

| Command | Output | Measured |
|---|---|---|
| `claude plugin list --json` | array of `{id, version, scope, enabled, installPath, installedAt, lastUpdated}` | 0.20 s |
| `claude plugin marketplace list --json` | `{name, source, repo/url, installLocation}` | fast |
| `claude auth status --json` | JSON by default | fast |
| `claude auto-mode config` | **effective config as JSON** | fast |
| `claude agents --json` | sessions as JSON | fast |
| `claude doctor` | health, text | 0.81 s |
| `claude plugin details <n>` | inventory + token cost, **text only** | 0.44–0.53 s |
| `claude mcp list` | **health-checks 7 remote endpoints**, text only | **4.5–5.5 s, side-effecting** |

**Fan out with bounded concurrency 8.** Measured: 10 plugins sequentially 4.86 s, in
parallel **0.95 s**, byte-identical output, zero contention. Revision 2's "5.4 s cold,
requires background refresh" was a design choice mistaken for a constraint.

`claude mcp list` is **never** on a paint path — it opens network/OAuth connections per
server and will hang behind a corporate proxy or captive portal. §10 carries a degradation
row for it.

**Parse minimally.** The high-value line is one regex:
`Always-on:\s+~(\d+) tok`. Revision 2 specified a parser for the full aligned
per-component table plus golden samples per CLI version — a permanent maintenance
liability against upstream's human-readable formatting. That parser is cut. Hooks are
already annotated `(harness-only — no model context cost)` and must not be double-counted.

Cache key: `(id, lastUpdated, installPath mtime, claude --version)`. **Not `version`** — it
is literally `"unknown"` for 3 of 10 plugins and never changes for them.

Shell-out is `execFile('claude', ['plugin','details','--',name], {shell:false, timeout:
15000, maxBuffer})` with `claude` resolved to an absolute path at startup. Plugin names are
validated against `^[a-z0-9][a-z0-9._-]{0,63}$` before reaching `argv` (they are arbitrary
strings from third-party repos); failures surface as supply-chain findings, never sanitised
silently. Errors are detected by **process exit code**, not output text.

**What the CLI already aggregates.** Revision 2 claimed "the gap is aggregation." That is
false: `/context` already breaks down system prompt, tools, MCP tools, subagents, memory
files and skills for the running session. The real, narrower gap: `/context` is
**in-session, not machine-readable, and describes the session that is running rather than
what a given scope would load**. Also authoritative and worth surfacing: `/skills`,
`/hooks`, `/mcp`, `/permissions`, `/memory`, `/status`, and the `InstructionsLoaded` hook,
which logs exactly which instruction files load and why.

### 6.4 Inference policy

Two tiers, not three (revision 2's three-tier epistemology was ceremony):

- **Known** — from the CLI, or parsed without interpretation.
- **Computed** — marked with one visual treatment and a "verify in CLI" action.

**Effective values are named, not withheld.** Revision 2 declined to name a precedence
winner anywhere. That made the user do the merge in their head, and the ambiguity is
enumerable rather than general:

- **Scalars override** — the overwhelming majority. Winner is named.
- **Lists merge** across scopes (`permissions.allow` etc.), unless managed
  `allowManagedPermissionRulesOnly` disables it. Layers shown, no single winner.
- **Never merge, highest source wins whole**: `availableModels`, `fallbackModel`,
  `modelPicker` (ignored entirely in project/local), `modelSettings`.
- **Stricter-lower-scope-wins exceptions**, flagged by name: `disableClaudeAiConnectors`,
  `enableArtifact`/`disableArtifact`, `isolatePeerMachines`, `remoteControlAtStartup`,
  `crossSessionInbound`, `useAutoModeDuringPlan`, `syncClaudeAiSkills`, `maxEffortLevel`.
- `permissions.defaultMode` values `auto`/`bypassPermissions` do not take effect from
  project/local at all.

Outside this enumerated set, layers are shown without a winner.

---

## 7. Sessions

**Counts corrected.** Revision 2 said "616 sessions." Of 620 `*.jsonl`, only **152** are
session transcripts (`<project>/<session>.jsonl`); **468** are subagent transcripts under
`<session>/subagents/`. Also present and excluded: `.orphaned-*`, `.jsonl.superseded-*`,
`tool-results/`.

**Format stability.** Claude Code's docs state the entry format is *"internal… and changes
between versions, so scripts that parse these files directly can break on any release."*
Revision 2 filed JSONL as "raw, unambiguous." It is **Computed**, and carries the same
mitigations as the Oracle: version-pinned golden samples, degrade to `stat`-only metadata on
schema mismatch, `claude --version` in the cache key. Documented alternatives to prefer
where possible: `--output-format json`, `/export`, the `transcript_path` given to hooks.

**Parsing is affordable but must not block.** Measured: full corpus parse 0.22–0.31 s warm
in Node (faster than Python), 0.92 s in a cold process from JIT. But in a single-threaded
server it is **head-of-line blocking**: every concurrent request measured the *full* parse
duration — 949 ms at 1×, 5,980 ms at 10×. Parsing therefore runs in a `worker_threads` pool,
never on the main thread. An event-loop budget assertion (>50 ms blocked in any `/api/*`
handler) fails CI.

**Sidecar cache** keyed on `(path, size, mtime)`, with the ordering fixed: **stat → read →
re-stat**, committing only if both stats agree, keyed on the first. Revision 2's read-then-
stat ordering permanently poisons the cache for any file appended mid-read — confirmed
reproducible, and live appends are real (6 growth events observed in 25 s). Byte offsets are
recorded so growing files resume incrementally. Warm stat-only pass: **7 ms**.

Growth ceiling stated honestly: at 10× corpus the first fill is 3.7–6.2 s. "No index" holds
for today and remains correct **provided the first fill is off-thread, incremental and
resumable**. A trailing line without a newline is skipped, not reported as a parse error.

---

## 8. Editing

The product (§3). Revision 2 deferred it to phase 3; it is now phase 1.

### 8.1 Writability classes

| Class | Examples | Treatment |
|---|---|---|
| **Freely editable** | `CLAUDE.md` + imports, user skills/agents/commands/rules, `settings.json` keys **not** matching §9.3 | validate → backup → atomic write |
| **Executable-bearing** | `hooks.**.command`, `hookScript` bodies, `statusLineScript`, `apiKeyHelper`, `*Helper`, `awsCredentialExport`, `awsAuthRefresh`, `env.*`, `mcpServers.*.{command,args,env}`, `.mcp.json`, `enabledMcpjsonServers` | §9.3 gate: server-side two-step confirmation naming the exact command |
| **Redirect** | `plugins/cache/**`, `skills/synced/**` | refuse; offer "open marketplace copy" or "fork to user scope" |
| **Read-only** | managed policy (root-owned), marketplace checkouts | view with reason |
| **Guarded** | session/subagent JSONL, `~/.claude.json` | view only; typed confirmation to edit |

### 8.2 Editor surface

Structured form + raw toggle where a schema exists (`settings.json`, `keybindings.json`,
plugin manifests, marketplace manifests — **all four have published schemas on schemastore,
vendored at build time, never fetched at runtime**). Raw text with highlighting for Markdown
and unknown formats. No editor for Read-only or Guarded.

**`@`-imports are resolved recursively** (depth 4) and the resolved tree rendered with
per-file byte and token contribution, each file editable in place. Without this the memory
screen renders 8 bytes on the author's own machine.

### 8.3 Validation

Claude Code **silently ignores** malformed settings in `-p` mode, so validation is mandatory
before write: JSON parse with line/column; schema validation where vendored (unknown keys
warn, never block); `SKILL.md` frontmatter requires `name`/`description`; post-write re-read
and re-parse.

### 8.4 Concurrency

Revision 2's compare-and-swap was measured to give **zero** protection: 200/200 trials
silently clobbered, because the ~14 µs check sits before a ~4.2 ms fsync-dominated write
window. Corrected: verify and rename happen **inside an `O_EXCL` lockfile** held across the
whole operation, with the CAS `fstat` taken on the open descriptor, and a final re-stat
immediately before `rename()`. Atomic rename gives crash-consistency, not mutual exclusion —
the spec now says so. On conflict: refuse and offer "reload and re-apply." (Revision 2's
three-way merge UI is cut as premature.)

### 8.5 Deletion

Only Stale registry entries and orphaned backups. Artifacts are **never** deleted in v1;
plugin removal is surfaced as a copyable `claude plugin uninstall` command.

### 8.6 Comparison

Two surfaces, one engine (`src/server/linediff.js`, no dependency, runs in both Node and
the browser). **Preview changes** diffs the buffer against what was on disk when the file
was opened; **Compare** diffs a stored version against the current file. Both are computed
in the direction of the action, so `add` always means "this action adds this line" — the
view never flips signs.

The engine returns three states. `identical` and `changed` are self-explanatory;
`unverifiable` carries a reason and is **never** downgraded to `identical`. A restore or a
save proceeds whether or not the diff engine understood the file, so silence would read as
"nothing will change" — §5's invariant, one level down. It covers an unreadable side,
binary content, and files past a line or byte limit; when a limit bites, the size is named
rather than a truncated prefix being presented as the whole.

For a file that Claude Code executes, the diff is embedded in the §9.3 confirmation. The
key list there names which values become executable; it says nothing about the rest of the
file the user is agreeing to install.

### 8.7 Unsaved edits

Every path that unmounts or remounts the editor routes through one guard: the close
button, Escape, selecting another artifact (a remount, since the editor is keyed on the
item id), both nav tabs, and switching project. `dirty` was previously computed and used
only to disable a button, so five paths discarded the buffer silently. The file-writing
discipline in §8.4 and §8.6 protects the file; nothing protected what had been typed.

### 8.8 Backups

`<original>.atlas-<timestamp>.bak` **beside the original**, inheriting that directory's
permissions and any corporate DLP or Time Machine exclusion already covering `~/.claude`.
Revision 2's `~/.claudescope/backups/` created a new plaintext-secret store outside every
existing exclusion, with a three-policy retention GC and no mode specified — with `umask
022` that yields world-readable copies of `settings.json`'s `env` block and
`~/.claude.json`'s `oauthAccount`.

Every backup is opened `fs.open(path,'wx',0o600)` and `fstat`-verified after write; a mode
other than `0600` aborts the operation. Guarded-class files are excluded by default —
size *and* confidentiality. Retention: keep the last 10 per file; no global GC.

---

## 9. Security

The app binds a local HTTP server that writes files which execute shell. That is a remote
code execution primitive and is treated as one.

### 9.1 Transport

Bind `127.0.0.1` on a **fixed port**, 7717 by default, `--port` to change it. The URL is
derived from `server.address()` only. A fixed port is what makes the URL bookmarkable
across restarts; revisions 2-4 used an ephemeral one, so every restart handed the user a
new address. `EADDRINUSE` is fatal and names the alternative — never a silent fallback,
since a tool whose address moves on its own is the problem this replaced, and a port
squatter must not be able to stand in for us. No tunnel, no LAN bind, no remote mode, and
no outbound requests of any kind.

### 9.2 Authentication

**The URL carries no secret.** The server listens on a fixed port (7717 by default,
`--port` to change it) and the launch URL is plain `http://127.0.0.1:7717/`.

Revisions 2–4 put a credential in the URL: first a long-lived token, then a single-use
nonce exchanged for an `HttpOnly; SameSite=Strict` cookie. Both are now removed, because
the credential defended against a threat the other checks already close. A hostile *page*
never gets past `Origin` and `Host`; a hostile *local process* can read and write
`~/.claude` directly and never needed the API. What the nonce did accomplish was making
the launch link one-shot — whoever opened it first claimed the server, which locked the
author out of their own running instance and forced a restart to mint another.

The remaining checks carry the whole defence, and every `/api/*` request — **including
`GET`** — is subject to all of them. Revision 2's "GET may be read-only-permissive"
carve-out allowed any web page to trigger
`<img src="http://127.0.0.1:PORT/api/scan?deep=1">`, a cross-origin disk walk and
process-spawn primitive. All side-effecting endpoints are `POST`.

A fixed port is what makes the URL bookmarkable across restarts. On collision the server
**refuses to move** and names the alternative — a tool whose address silently changes is
the problem this replaced.

Checks **fail closed**: `Origin` present but not ours → 403, and absent on a write → 403 (browsers always send it on writes, so absence there is a non-browser client); `Host` ≠ `127.0.0.1:<port>` → 403 (reject
`localhost`, `[::1]`, `127.1`, `0x7f000001`, trailing dot); `Content-Type` not
`application/json` → 415 **before reading the body**, defeating the `enctype="text/plain"`
JSON-CSRF. WebSocket/SSE, if used, validate `Origin` on the handshake — and must not fall
back to a query-string token because `EventSource` cannot set headers.

### 9.3 Write gating is on value shape, not artifact kind

Revision 2 confirmed only `hook` writes, "because that is the one artifact class that
converts a write into execution." **That is false**, verified against the shipping binary:
`statusLine.command` (populated on this machine), `apiKeyHelper`, `otelHeadersHelper`,
`awsCredentialExport`, `awsAuthRefresh` all execute shell; `env.NODE_OPTIONS` and `env.PATH`
achieve execution with no key named "command"; `.mcp.json` and `mcpServers.*` are literal
`execve` specs. And §8.3's warn-never-block policy guaranteed the list would grow silently
every release.

Gating is therefore on the **diff's value shape**: any write introducing or modifying a
string at a known-executable key path, **or** heuristically executable (resolves to an
existing executable, contains shell metacharacters, begins with a path), triggers
confirmation. The confirmation is a **server-side two-step** — `POST` → `409
confirmation_required` + `confirmToken` → `POST` with that token — never a client-side modal, which a
direct API call bypasses. The token is HMAC-bound to both the target and the content, so approving one string
cannot install another. Since revision 5 the confirmation also carries the file's full
diff (§8.6): the key list names which values become executable, not the rest of what is
being installed. It renders the exact before/after string, and branches by hook
`type`, since `http`/`mcp_tool`/`prompt`/`agent` hooks have no shell command to name.

### 9.4 Path handling

Artifact ids are opaque handles mapped through a scan-time table. Where a path must be
validated, containment is `path.relative(root, fs.realpathSync(p))` with
`rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)`, **case-folded on darwin**
(this filesystem is case-insensitive, so `startsWith` comparisons fail open on `/users/…`)
and NFC-normalised. Note `startsWith('~/.claude')` also matches `~/.claude.json` — the file
that must stay Guarded.

Writes open the final component `O_NOFOLLOW` after an `lstat` walk rejecting symlinked
components (one symlink exists in the plugin tree today), with the temp file created in the
target's own directory via `fs.open(tmp,'wx',0o600)`.

### 9.5 Rendering untrusted content

Skills, manifests and memory come from six third-party GitHub repos and are rendered in a
page holding write credentials — XSS here is RCE.

CSP on every response: `default-src 'none'; script-src 'self'; style-src 'self'; img-src
'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors
'none'; form-action 'none'`. No `'unsafe-inline'`. Plus `X-Content-Type-Options: nosniff`
and `Referrer-Policy: no-referrer`.

Markdown is `markdown-it` with `{html:false, linkify:false}` piped through DOMPurify —
named library, named options, not "rendered as inert text." `innerHTML` /
`dangerouslySetInnerHTML` are banned in lint and enforced in CI. URLs are `new URL()`-parsed
and allowlisted to `http:`/`https:` (a `javascript:` `homepage` is one click from a write
call), rendered `rel="noopener noreferrer"`.

### 9.6 Secret handling

One `redact()` chokepoint on every error payload **and** every log line, with a key-path
deny-list (`env.*`, `*Helper`, `oauthAccount`, `userID`, `machineID`,
`/token|key|secret|password|credential/i`) and a byte-window cap. §10's malformed-JSON
rendering shows `line:col` only for secret-bearing files, with raw content behind a separate
confirmed request. Raw `JSON.parse` error messages are never logged — Node embeds input
context in them, so a default `console.error` writes secrets to scrollback and any corporate
log shipper.

### 9.7 Threat model

In scope: browser-originated access to the port, and **different-UID local processes** (MDM
agents, EDR, second accounts, containers with host networking — 127.0.0.1 is not
UID-scoped). Out of scope: same-UID local attackers, who can edit `~/.claude` directly.
Revision 2 stated this exclusion broadly enough to dismiss all local attackers, which is what
let the argv token leak through.

---

## 10. Error handling

Core invariant: **absent ≠ empty ≠ unreadable ≠ malformed.** Enforced as a discriminated
union at the type level — and extended in revision 3 from readers to **directory traversal**,
which is where it was violated.

| State | Forbidden | Required |
|---|---|---|
| Directory absent | "0 skills" | *"No user-level skills dir — yours come from plugins"* |
| Empty | "0 skills" | *"Empty"* |
| Permission denied | "0 skills" | *"Present, unreadable (root-owned)"* / *"124 dirs unreadable — macOS privacy protection"* |
| Malformed JSON | silently skipped | *"Parse error at line N"* (redacted per §9.6) |

Degradations: `claude` absent → Oracle unavailable, costs `—`; `claude mcp list` timeout or
proxy failure → *"MCP status unavailable (network)"*; managed file outranked → *"present but
skipped"*; version drift → Computed finding.

---

## 11. Interface

Primary axis is **artifact kind**, with scope as a badge and filter. Revision 2 made scope
the primary rail; measured across all 11 registered projects there are **2**
`settings.local.json`, **2** project `CLAUDE.md` (one of them `~/.claude` itself), and
**zero** project skills, agents, commands, rules or `.mcp.json`. The setup is ~98% global,
so scope cannot carry the navigation.

| Screen | Content | Phase |
|---|---|---|
| **Loaded now** | Every artifact active at user scope, grouped by kind: name, source path, provenance, always-on cost, **inline editor** for freely-editable rows. Renders 23 skills, 10 plugins, the hook *with `format-hook.sh` inline*, statusline script, 2 MCP servers, `settings.json`, `CLAUDE.md` **with `@NOTES.md` resolved** | 1 |
| **Declared vs used** | Which of the 23 active skills / 13 agents ever fired, joined from transcripts | 2 |
| **Supply chain** | Plugins + marketplaces: repo, version, commit, drift, which ship hooks | 2 |
| **Scopes** | Project list per §6.2; inheritance per §6.4 with named winners | 3 |
| **Sessions** | Transcript list + read-only viewer | 3 |
| **Diagnostics** | MCP logs (2,278 files, 15 MB — reveal in Finder), doctor output, denied dirs | 3 |

**Declared-vs-used is promoted to phase 2.** Revision 2 deferred it to v2 *"because it
requires the session parse of §7 to be routine first"* — three sections after §7 measured
that parse at 0.3 s. It is a join, roughly a day's work, and it is the question no
competitor answers.

---

## 12. Cloud artifacts

Retained because "everything" was an explicit requirement, but minimised. Credentials are in
the macOS Keychain, Linux differs, and no `claude artifacts` subcommand exists — the only
clean path is shelling `claude -p`, costing a model call and seconds for 2 objects. Manual
Refresh button only, never automatic, last phase. Documented as a wart.

---

## 13. Delivery phases

Revision 2's Phase 1 was estimated by review at ~31 working days, with an exit criterion
achievable in an afternoon — the contents were not derived from the criterion. Re-cut so
each phase ships something the user would actually run.

| Phase | Contents | Exit criterion |
|---|---|---|
| **1 — Loaded now, editable** (~1 week) | Security baseline (§9), single root, config-driven reader table, `@`-import resolution, hook/statusline script bodies, one screen, inline editing of the freely-editable class with validation + lockfile + backup | Author edits `NOTES.md` and a skill in-browser; `settings.json` edit during a live session refuses cleanly |
| **2 — Why it costs that** | Oracle fan-out, always-on cost regex, supply chain, declared-vs-used | Aggregate cost reconciles with `/context` |
| **3 — Scopes and history** | ScopeRegistry + bounded scan + denied-dirs, inheritance with named winners, sessions in workers, diagnostics | `tcc-denied` and concurrency harnesses green |
| **4 — Completeness** | Rare kinds via config table, managed-policy sources, cloud artifacts | Corporate laptop renders MDM policy correctly |

`ScopeRegistry` is deliberately **not** in phase 1: it is the hardest component, renders no
pixels, and its edge cases are best learned from real failures rather than anticipated.

---

## 14. Revision history

**Revision 3 — 2026-09-11.** Four independent adversarial reviews (security, systems,
domain-accuracy, product). Material changes:

1. **§9.3 inverted** — gate on value shape, not artifact kind. Revision 2's hook-only
   confirmation guarded one of eight verified write-to-execute paths, several through files
   it classed freely-editable.
2. **§4.1 `autoMemory` corrected** — real path `~/.claude/projects/<project>/memory/`, and
   the kind is **present** (5 dirs, 4 `MEMORY.md`, 14 files), not absent. Revision 2
   reproduced the skill-cabinet bug it was written to prevent.
3. **§6.2 denied-directory reporting added** — a deep walk hits 124 EPERM dirs here and
   revision 2 would have reported them as absent. Same bug, second instance.
4. **§7 counts corrected** — 152 transcripts + 468 subagent transcripts, not "616 sessions."
5. **§7 JSONL re-tiered** — docs state the format is internal and breaks between releases.
6. **§7 worker threads** — full parse blocks every concurrent request for its whole duration
   (949 ms at 1×, 5,980 ms at 10×).
7. **§7 sidecar ordering fixed** — read-then-stat permanently poisons the cache on live files.
8. **§8.4 CAS corrected** — measured 200/200 silent clobbers; now lockfile-held.
9. **§8.6 backups relocated** beside the original at `0600`; revision 2's new directory was
   a world-readable secret store outside every existing DLP exclusion.
10. **§3 rationalisation withdrawn** — CCO ships five of six screens. Editing is the
    differentiator, and is now phase 1 rather than phase 3.
11. **§6.3 `/context` acknowledged** — "the gap is aggregation" was falsifiable; the real gap
    is narrower and stated as such. Per-component table parser cut to one regex.
12. **§6.3 fan-out** — 10 plugins in 0.95 s parallel vs 4.86 s sequential.
13. **§6.1 managed policy is four ranked sources**, MDM outranking the file on the exact
    corporate-macOS scenario this targets.
14. **§6.4 names winners for scalars**, with the full exception set enumerated.
15. **§1 numbers corrected** — 1 genuine drift, not 4.
16. **§4.1 adds** `hookScript`, `statusLineScript`, `CLAUDE.local.md`, ancestor loading,
    `@`-imports, `skills/synced/`, plugin `hooks.json`, claude.ai MCP connectors,
    `agentMemory` variants, project paths for `outputStyle`/`plugin`/`marketplace`.
17. **Cut**: multi-root switcher, three-way merge UI, backup GC, three-tier epistemology,
    `rare-kinds/` per-kind fixtures, golden-sample-per-version parser.
18. **§5 stack decided** — Vite + React + CSS modules.

**Revision 6 — 2026-09-14.** Scope narrowed to macOS. The platform-dependent paths — the
Trash mechanism and filesystem case folding — had only ever executed on darwin, and the
Linux XDG trash branch had never run outside the test suite. `bin/claudescope.js` now
refuses to start elsewhere; the directory-move implementation survives as the `folder`
mechanism, named for what it is. Case folding in `writability.js` is unconditional: it
only ever makes more paths match a protected prefix, so it errs toward refusing a write
on a case-sensitive volume too.

**Revision 5 — 2026-09-14 (post-Phase-1, feature work).** Changes driven by four
tournaments of competing agents and, in every case, by verifying their claims against a
running program:

1. **§9.2 rewritten** — the URL credential removed entirely and the port fixed. The
   single-use nonce defended only against non-browser local clients, which can read and
   write `~/.claude` directly, while making the launch link one-shot and locking the author
   out of a running server.
2. **§8.6 added** — comparison, with `unverifiable` as a first-class state. Four
   independent researchers found this gap in four unrelated product families.
3. **§8.7 added** — the unsaved-edit guard.
4. **§5 invariant applied in four new places** — a hook whose script is missing, a
   malformed `settings.json` that previously produced no item at all, denied directories
   named rather than counted, and plugin drift stated as versions rather than a word.
5. **§10 correction** — `positionOf` returned line 1, column 1 whenever V8 reported no
   position, which it does for most multi-line JSON errors. Unknown is now null, and the
   UI says the parser gave no position rather than inventing one. A confident wrong answer
   is worse than an admitted gap.
6. **Agents, commands and plugin-source repos read** — on a machine with no
   `~/.claude/agents`, all 20 loadable agents come from plugins; a reader that looked only
   at the user directory reported an honest-looking zero.

**Revision 4 — 2026-09-12 (during implementation).** One correction, found by Task 4's
real-machine verification:

19. **The skill count was wrong in every prior revision.** §1 claimed 75 active skills.
    Measured: `plugins/cache` = **23** (the 10 installed plugins), `plugins/marketplaces` =
    52 more, which are git checkouts holding skills for 35 plugins that are **not
    installed**, plus duplicates. Only cache holds loadable copies — `enabledPlugins` →
    `installed_plugins.json` → `installPath` all point there. §1 of revision 1 warned that
    "a naive scan double-counts everything" and then quoted the double-counted figure in
    the same breath. Corrected in §1, §11 and in the Phase 1 plan.

**Revision 7 — 2026-09-15.** Releasing automated, and the published name settled.

20. **§5 the package is scoped.** npm refuses the bare name `claudescope`, judging it too
    similar to an unrelated `claude-scope`. This was not visible in advance: the registry
    returns 404 for the name, and 404 means unregistered, not available — the two are only
    distinguished by attempting a publish. The binary is still `claudescope`; nothing but
    the package identifier changed.
21. **Releasing is a push to main.** The version is derived from commit subjects since the
    last `v*` tag by `scripts/release-version.js` rather than typed by hand, because the
    manual step is the one that gets skipped and skipping it is invisible — the repo moves
    on and the registry does not. A push touching only docs, tests or CI publishes nothing.
    Below 1.0.0 a breaking change is a minor bump: declaring stability is a decision, not a
    consequence of punctuation.

Open: none blocking. The name is settled: `claudescope` as the command and the repository,
`@andrewpoolejames/claudescope` on npm.
