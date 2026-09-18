# Security

## Reporting

Report anything you think is a vulnerability privately, through
[GitHub's private advisory form](https://github.com/8ballbb/claudesight/security/advisories/new),
not as a public issue. There is no bounty and no formal SLA — this is one person's
project — but a report will be read and answered.

## What this app can do, which is the reason to care

claudesight reads your Claude Code configuration and **writes files that Claude Code
later executes as shell** — hook commands, status-line scripts, and subagent definitions
whose frontmatter can declare hooks of their own or switch the approval prompt off. A
flaw that lets something else drive this API is a local code-execution flaw, and is
treated as one.

It binds `127.0.0.1` only. It makes no outbound requests: no telemetry, no account, no
cloud, no LLM calls. Nothing you open here leaves the machine.

## The model

**Localhost is not a boundary against your own browser.** Any page you have open can send
requests to `127.0.0.1`. Three checks refuse them, and together they are the whole
defence:

| Check | Stops |
|---|---|
| `Origin` must be ours | any cross-origin request, read or write |
| `Host` must be `127.0.0.1:<port>` | DNS rebinding pointing a hostile domain at us |
| Writes must be `application/json` | form POSTs, the one shape that skips CORS preflight |

There is deliberately **no secret in the URL**. Earlier revisions had one — a token, then
a single-use nonce exchanged for a cookie. It defended only against non-browser local
clients, which can read and write `~/.claude` directly and never needed the API, while
making the launch link one-shot. See §9.2 of the design doc.

**Writing something executable takes a second confirmation.** The confirmation token is
HMAC-bound to both the target and the content, so approving one command cannot be used to
install another. The dialog names the exact command and shows the file's full diff.

This is not limited to JSON. A markdown file's YAML frontmatter is scanned for the same
capabilities — `hooks:`, and a `permissionMode` that stops Claude Code asking — because
a subagent definition can carry them, and for a long time the gate only looked at
`.json`. `tools: Bash` is deliberately not gated: omitting `tools` inherits everything
including Bash, so warning about the explicit spelling while ignoring the permissive
default would warn about the safer of the two.

**Writes are defensive.** A lockfile, a compare-and-swap against the on-disk content, and
a `0600` backup beside the original. Deletion moves to the Trash and is refused outright
if no trash mechanism is available; nothing here unlinks a file as a fallback.

**Paths are contained.** Case-folded comparison against the configuration root, so
`/users/...` cannot be used to escape `/Users/...`. Managed policy, marketplace checkouts,
session transcripts and `~/.claude.json` are read-only by class.

## Out of scope

Anything requiring an attacker to already have code execution as your user — they can read
and write `~/.claude` directly and do not need this app. The threat model is a hostile web
page, not a hostile local process.

## Dependencies

Runtime dependencies are `react`, `react-dom` and `yaml`. `npm audit` currently reports
zero vulnerabilities. If you find that is no longer true, an issue is fine — that is not
sensitive.
