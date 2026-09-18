# Contributing

    git clone https://github.com/8ballbb/claudesight
    cd claudesight
    npm install        # also builds the UI
    npm test           # 293 tests
    npm start          # http://127.0.0.1:7717/ — Ctrl-C to stop

Node 20 or later, on macOS. The app refuses to start elsewhere; see below.

**Read `CLAUDE.md` first.** It is short, and it holds the things that are not obvious from
reading the code: the one invariant, the conventions that look wrong but are correct, and
the specific mistakes this codebase has already made. `docs/superpowers/specs/` is the
authority on behaviour, kept current with revision notes.

## The one rule

**A reader never reports a bare zero.** Readers return `ok` / `empty` / `absent` / `denied`
/ `malformed`, and those stay distinguishable all the way to the screen. "There is nothing
here" and "I could not look" are different answers. An indicator must never promise more
than the page shows.

Most of this project's bugs have been one shape: the app already held a fact and dropped
it on the last step to the screen. A missing hook script, an unsaved buffer, the paths
behind a denied count, a parse position. When looking for something to improve, look first
for what is already computed and not surfaced.

## Two habits this repo expects

**A test must fail against the reverted code.** The repeated failure here was a correct fix
guarded by a test that passed either way. Before saying a fix is covered, revert the
production change and watch the test go red. If it stays green, the test is decorative.

**Look at the page.** Several defects reached "all tests pass" and were obvious on screen:
a row that hung on `EISDIR`, a theme that painted in the previous palette, a panel drawn
below the fold, a diff whose `+` lines rendered red. `npm run build` before `npm start` —
the server serves `dist/`, so source edits are invisible until you build.

## Adding a platform

The app is macOS-only and refuses to start elsewhere, because the platform-dependent paths
— the Trash mechanism, filesystem case folding — have only ever run on darwin. An earlier
XDG trash implementation shipped for months without ever executing outside the test suite;
that is the same class of claim as a bare zero.

If you add Linux or Windows: start from the `folder` mechanism in `src/server/trash.js`,
relax the guard in `bin/claudesight.js`, **and add CI that runs the suite on that platform
in the same change.** A platform without CI is a claim nobody has checked.

## Screenshots

The two images in the README come from a fabricated configuration, never from a real
machine. `scripts/demo-config.mjs <empty-dir>` builds it and prints the command to serve
it; it refuses a directory that is not empty, and refuses anything under a `.claude`
path. The fixture is chosen to exercise what the UI has to say — a hook whose script is
missing, an inline hook, a hook that can auto-approve, a plugin whose manifest disagrees
with the installed version, a plugin enabled but never installed, a monorepo package
that inherits from its repository root, an MCP server that is not on PATH, and a
remembered directory that is gone. If you change what a row says, regenerate both
images.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: lint, the suite on Node 20
and 22, and then three checks the suite cannot make. That a clean `npm ci` produces a
servable `dist/`, that the server actually answers on its fixed port, and that a
cross-origin read, a form-shaped write and a rebinding attempt are refused — 403, 415, 403.

macOS runners only, matching the app. Adding a platform means adding its runner in the
same change.

## Releasing

There is no release ritual. A push to `main` that changes anything the package ships is
published to npm automatically, by the `release` job in the same workflow — after the
matrix and the audit are green, never before.

The version is derived from the commit messages since the last `v*` tag, by
`scripts/release-version.js`:

| Commits since the last tag | Result |
|---|---|
| Nothing outside docs, tests, CI | no release at all |
| Anything else | patch |
| A `feat:` commit | minor |
| A `!` subject or a `BREAKING CHANGE:` footer | minor while the version is below 1.0.0 |

That last row is deliberate: reaching 1.0.0 should be a decision, not a side effect of a
commit message. Run the workflow manually with a forced bump when you mean it.

A commit whose subject follows no convention still counts as a patch. Failing toward
shipping a fix is recoverable; failing toward silence leaves a fix unreleased with nothing
to say why. That logic has tests in `tests/release-version.test.js` — it decides what
reaches users, so it is held to the same standard as the app.

The job commits the new version, the lockfile and a `CHANGELOG.md` entry back to `main`,
tags it, publishes with npm provenance, and opens a GitHub release. There is no publish
token: npm trusts this repository, the workflow file `ci.yml` and the `release`
environment, and issues a short-lived credential per run. Renaming any of those three
breaks publishing and the trusted publisher has to be recreated on npmjs.com.

To release without a qualifying commit — to re-publish after a failed publish, or to cut
a version deliberately — run the CI workflow from the Actions tab and choose a bump. A
forced bump skips the ships-changed gate, because choosing one by hand is not an accident. It publishes **after**
everything reversible has already succeeded locally, because the publish is the only step
that cannot be undone.

## Naming

`node scripts/check-name.mjs <name>` before adopting any npm name. A 404 from
`npm view` means unregistered, which is weaker than available: npm also refuses a name
whose punctuation-stripped form collides with an existing package. This project was named
`claudescope` on the strength of a 404 and could not be published, because `claude-scope`
already existed. The script reproduces that rejection, so it is testable rather than folklore.

## Pull requests

Small and self-contained beats comprehensive. Say what you changed and why; if you found a
defect, say what it does to a user rather than what line it is on. `npm test`, `npm run
lint` and `npm run build` should all be clean.

Commit messages here are longer than usual on purpose — they carry the reasoning, because
`git log` has repeatedly been the thing that explained why something is the way it is.
Match that if you can.

## Security

Do not open a public issue for a vulnerability. See `SECURITY.md`.
