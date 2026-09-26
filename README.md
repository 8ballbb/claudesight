# claudesight

See and edit every Claude Code artifact on your machine — globally and per project.

**macOS only.** The parts that differ by platform — the Trash mechanism, filesystem case
folding — have only ever run on macOS, so the app refuses to start elsewhere rather than
half-working on files you rely on. Linux support is welcome; see `CONTRIBUTING.md`.

    npx claudesight@latest

Opens a local web UI at `http://127.0.0.1:7717/`. Stop it with Ctrl-C.

Reads `$CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude`. Use `--port 7718` to move it;
the port is fixed rather than ephemeral so the URL survives a restart and can be
bookmarked. If the port is taken the server says so and names an alternative instead of
quietly moving.

`npx` keeps a copy once it has run, so dropping the `@latest` may keep serving the
version you first ran. The `@latest` above forces it to check.

To run the current `main` instead of the last published version:

    npx github:8ballbb/claudesight

Or from a clone, which is what you want if you intend to change anything:

    git clone https://github.com/8ballbb/claudesight
    cd claudesight
    npm install        # also builds the UI
    npm start

![The global view: artifacts grouped by kind, with a hook whose script is missing flagged as broken, an inline hook that names no script, a hook that can auto-approve, and a notice naming a plugin that is enabled but not installed](docs/img/global.jpg)

## What it shows

**Global** — your memory files with `@`-imports resolved, `settings.json`, the hook and
statusline scripts those settings execute, skills, agents, commands, rules, and installed
plugins with drift status. Most of these arrive from plugins rather than from your own
directories, which is why tools that only read `~/.claude/skills` report nothing.

Also the prompt behind each Claude Desktop scheduled task, from
`~/.claude/scheduled-tasks/`. Only the prompt is in that file — the schedule, folder and
model are Desktop's own state — so every row says so rather than implying the app knows
when the task runs.

**Projects** — every directory Claude Code has actually run in, found by reading the
project registry, your prompt history and session transcripts. No filesystem scan. Each
project shows its own memory, settings, MCP servers, skills, agents, commands, rules, and
the hook scripts its settings execute. A repo that publishes a plugin is read in that
layout too, since its artifacts live at the repo root rather than under `.claude/`.

**Configuration inherited from parent directories is listed too**, because Claude Code
loads it. The two boundaries differ and both are taken from the documented behaviour:
`.claude/skills`, `agents` and `commands` are read up to the repository root, closest
name winning; `CLAUDE.md` and `CLAUDE.local.md` are read from every parent above that as
well. An inherited row names the directory it came from — the one you would actually
edit — and a definition that beat others to its name says how many it shadows.

A project whose directory no longer exists is hidden behind a count you can open. It is
never cleaned up: `gone` means "not there right now", which is also what an unmounted
volume and a removed worktree look like.

A filter box at the top of each view narrows every group at once — by name, description, or the command a hook runs — and expands the matches. Items are grouped by kind and banded by owner, because ownership is what decides whether
you can change a thing. Everything starts folded; what you expand is remembered.

![The projects view: discovered projects on the left, the selected package on the right — a CLAUDE.md inherited from the repository root, and an MCP server whose command is not on PATH flagged as broken](docs/img/projects.jpg)

## Settings

If you have no `settings.json`, the settings group offers **+ new settings.json**
to create an empty one. Open a settings file and the form's **add a setting**
search — the first thing in the panel — lets you find any key by name or by what
it does and add it with one click; it then appears under **set here** to give a
value, and you Save.

The settings file holds only what you have set; Claude Code accepts around 140
keys, and you cannot add one you cannot see. Open a `settings.json` and the
editor offers a form view over the same JSON, in three bands: **set here**,
**available to add** (every documented key, searchable by name or by what it
does, with its type, allowed values and a description — one click seeds it), and **not in this
catalogue** (keys present in the file that the catalogue does not recognise,
kept untouched — they may be newer than the catalogue, or a typo). An enum
dropdown shows the documented values; a value outside them is flagged, not
rejected, because the catalogue can lag your installed version.

The catalogue is a JSON Schema from [SchemaStore](https://www.schemastore.org/claude-code-settings.json)
(Apache-2.0), **bundled, not fetched** — the app makes no network requests — and
refreshed out-of-band by `scripts/refresh-settings-schema.mjs`. The editor
states which Claude Code version it reflects against the one you have installed,
so staleness is visible rather than assumed. List settings (like `permissions.allow`) get add/remove rows, string maps get
key/value rows, and a small object like `permissions` renders as a form of
those — its allow/deny/ask lists and its mode dropdown. `env` gets its own searchable editor — its ~340 documented variables plus any
custom ones, in set / add-documented / add-custom bands. Genuinely deep or
irregular shapes (`hooks`, MCP server lists) stay in the JSON view, labelled,
because a fabricated form for them would promise more than it can keep. The form is always a convenience over the JSON: the raw view edits
anything the catalogue does not model, and every save still goes through the
same backup, compare-and-swap and executable-write confirmation as any other
edit — editing `permissions`, for instance, shows the change and asks before
it writes.

## Adding artifacts

Five kinds can be created, at either scope: `CLAUDE.md`, a rule, a skill, a subagent, and an empty `settings.json` for when you have none yet.
Each asks for only what it needs — a rule for a name, a skill and a subagent for a
description as well, `CLAUDE.md` for nothing, since its filename is fixed. What is written
is the minimum valid file and nothing more: no `permissionMode`, no `hooks`, and no
`paths:` filter on a rule, which would quietly scope it to files you never named. The
scaffold is saved as the file's first version, so you can always get back to it.

Commands are deliberately **not** creatable, although the app lists the ones you have.
Claude Code's documentation marks `.claude/commands/*.md` deprecated in favour of skills,
and a creator that steers you onto a deprecated mechanism is worse than no creator.
Hook scripts are not creatable either — writing a file that runs as shell is the riskiest
act in this family. A scheduled task's prompt can be edited but a task cannot be created:
its schedule and folder live in Claude Desktop, so the file alone would not make one.

## What it refuses to do

An installed copy inside `plugins/cache/` is not editable — `claude plugin update`
overwrites that directory wholesale, so the app blocks the save rather than letting you
lose the work later. Managed policy, marketplace checkouts, session transcripts and
`~/.claude.json` are likewise read-only, each with the reason stated in the panel.

Deletion moves the file to the Trash via `/usr/bin/trash`. If that is unavailable the
deletion is refused — nothing here ever unlinks a file as a fallback, because the point of
deleting through this app is that it stays recoverable outside it.

## Broken configuration, said out loud

A hook whose script has been deleted is shown as broken rather than dropped — Claude Code
still fires it. A `settings.json` or `.mcp.json` that will not parse keeps its row and
reports the parse position, or says the parser did not give one rather than guessing. A
directory that could not be read is named, not counted. A plugin whose installed version
differs from its manifest says which is which.

The same goes for configuration that points at something absent. Every MCP server in a
`.mcp.json` gets its own row saying whether its command could be found — with three
answers, not two: found, searched-for-and-absent, and *unknown* where no answer is
possible, such as a server addressed by URL. A plugin switched on in `settings.json` but
not installed is named, since nothing loads for it. A setting a managed policy overrides
says so, because yours will never take effect.

## Editing

Unsaved edits survive every way of leaving a file — the close button, Escape, clicking
another artifact, switching page — each asks first.

**Preview changes** shows what a save would do before it touches disk, and the same diff
appears inside the confirmation for any file Claude Code executes as shell.

## Versions

Editable files can be versioned on demand with an explicit button — not on every save.
Versions live outside your config, in `~/.claudesight/versions/`, indexed so any file's
history can be found and restored.

**Compare** shows what restoring a version would change, before you restore it. Both
diffs are stated in the direction of the action: a `+` line is one the action adds. When
a comparison cannot be computed — an unreadable side, binary content, a file past the
size limit — it says so and why, and is never reported as "no change".

## Review

An **opt-in** critic. With Review turned on (the `review: off/on` control in the header), an
editable artifact's panel gains a **Review this file** button that asks a fresh `claude -p`
for a one-shot, read-only critique — what to cut, tighten, or (rarely) add, each with a
reason. It suggests; it never edits. You apply anything worth applying through the normal
editor.

It is the only thing in claudesight that leaves the machine, so it is deliberately careful.
It is off until you turn it on, and **every review is confirmed before it sends**, naming
the file. The critic gets **no write tools and no file-read tools** and runs in a neutral
directory, so it cannot change anything, read other files, or fire the reviewed project's
hooks. The button only appears once a quick check confirms `claude -p` is usable, and says
why — not on PATH, not signed in — when it is not. claudesight assembles the artifact's
resolved context (kind, precedence, the facts it already knows) and, after the critique,
verifies any repo-specific claim locally, so a guess about a stale reference is checked
against the real files rather than trusted.

## Safety

- Binds `127.0.0.1` only. No tunnel, no LAN bind, no remote mode.
- Every API request must carry a matching `Origin` and `Host`, and every write must be
  `application/json`. Those three checks are what stop a page on another site from
  driving this API; see §9.2 of the spec for why there is no secret in the URL.
- No outbound requests. No telemetry, no account, no cloud — with one exception you turn
  on and confirm every time: **Review** (see below). With it off, nothing leaves the machine.
- Writing a file that Claude Code executes as shell requires a second confirmation
  naming the exact command, bound by HMAC to that file and that content. That covers
  markdown as well as JSON: a subagent's frontmatter can declare `hooks`, or turn the
  approval prompt off, and those take the same confirmation.
- Every write is backed up beside the original at mode `0600`, under a lockfile, with a
  compare-and-swap against the on-disk content.

## Development

    npm install
    npm test
    npm run lint
    npm run build     # required before the CLI can serve the UI

Node 20 or later, on macOS.

> Screenshots use a fabricated configuration, not a real one. Regenerate it with
> `node scripts/demo-config.mjs <empty-dir>`, which prints the command to serve it.

[![CI](https://github.com/8ballbb/claudesight/actions/workflows/ci.yml/badge.svg)](https://github.com/8ballbb/claudesight/actions/workflows/ci.yml)

## Contributing

`CONTRIBUTING.md` for how to run it and what the codebase expects. `SECURITY.md` for the
threat model and how to report a vulnerability privately.

## Design

`docs/superpowers/specs/2026-09-11-claudesight-design.md` is the authority on behaviour
and is kept current with revision notes. `CLAUDE.md` records the invariants that are easy
to break and expensive to notice. Plans under `docs/superpowers/plans/completed/` are
spent history, not guidance.

## Licence

MIT. See `LICENSE`.
