# Contributing

    git clone https://github.com/8ballbb/claude-atlas
    cd claude-atlas
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
relax the guard in `bin/claude-atlas.js`, **and add CI that runs the suite on that platform
in the same change.** A platform without CI is a claim nobody has checked.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: lint, the suite on Node 20
and 22, and then three checks the suite cannot make. That a clean `npm ci` produces a
servable `dist/`, that the server actually answers on its fixed port, and that a
cross-origin read, a form-shaped write and a rebinding attempt are refused — 403, 415, 403.

macOS runners only, matching the app. Adding a platform means adding its runner in the
same change.

## Pull requests

Small and self-contained beats comprehensive. Say what you changed and why; if you found a
defect, say what it does to a user rather than what line it is on. `npm test`, `npm run
lint` and `npm run build` should all be clean.

Commit messages here are longer than usual on purpose — they carry the reasoning, because
`git log` has repeatedly been the thing that explained why something is the way it is.
Match that if you can.

## Security

Do not open a public issue for a vulnerability. See `SECURITY.md`.
