# claude-atlas

See and edit every Claude Code artifact on your machine — globally and per project.

    npx claude-atlas

Opens a local web UI at `http://127.0.0.1:7717/`. Reads `$CLAUDE_CONFIG_DIR` if set,
otherwise `~/.claude`. Use `--port` to move it.

## What it shows

**Global** — your memory files with `@`-imports resolved, `settings.json`, the hook and
statusline scripts those settings execute, skills, agents, commands, and installed
plugins with drift status. Most of these arrive from plugins rather than from your own
directories, which is why tools that only read `~/.claude/skills` report nothing.

**Projects** — every directory Claude Code has actually run in, found by reading the
project registry, your prompt history and session transcripts. No filesystem scan. Each
project shows its own memory, settings, MCP servers, skills, agents, commands, rules, and
the hook scripts its settings execute. A repo that publishes a plugin is read in that
layout too, since its artifacts live at the repo root rather than under `.claude/`.

Items are grouped by kind and banded by owner, because ownership is what decides whether
you can change a thing. Everything starts folded; what you expand is remembered.

## What it refuses to do

An installed copy inside `plugins/cache/` is not editable — `claude plugin update`
overwrites that directory wholesale, so the app blocks the save rather than letting you
lose the work later. Managed policy, marketplace checkouts, session transcripts and
`~/.claude.json` are likewise read-only, each with the reason stated in the panel.

Deletion moves the file to the Trash. Nothing is unlinked.

## Versions

Editable files can be versioned on demand with an explicit button — not on every save.
Versions live outside your config, in `~/.claude-atlas/versions/`, indexed so any file's
history can be found and restored.

## Safety

- Binds `127.0.0.1` only. No tunnel, no LAN bind, no remote mode.
- Every API request must carry a matching `Origin` and `Host`, and every write must be
  `application/json`. Those three checks are what stop a page on another site from
  driving this API; see §9.2 of the spec for why there is no secret in the URL.
- Writing a file that Claude Code executes as shell requires a second confirmation
  naming the exact command, bound by HMAC to that file and that content.
- Every write is backed up beside the original at mode `0600`, under a lockfile, with a
  compare-and-swap against the on-disk content.

## Development

    npm install
    npm test          # 215 tests
    npm run lint
    npm run build     # required before the CLI can serve the UI

Node 20 or later.

## Design

`docs/superpowers/specs/2026-09-11-claude-atlas-design.md` is the authority on behaviour
and is kept current with revision notes. `CLAUDE.md` records the invariants that are easy
to break and expensive to notice.
