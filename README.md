# claude-atlas

See and edit every Claude Code artifact on your machine, at global scope.

    npx claude-atlas

Opens a local web UI on an ephemeral `127.0.0.1` port. Reads
`$CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude`.

## Phase 1 scope

Shows skills (including the plugin-delivered ones no other tool finds),
memory with `@`-imports resolved, `settings.json`, hook and statusline
script bodies, and installed plugins with drift status. Lets you edit
anything safe to edit.

Not yet: project scope, token costs, sessions, deletion.

## Safety

- Binds `127.0.0.1` only. No tunnel, no LAN, no remote mode.
- Every API request needs a cookie issued from a single-use launch nonce,
  plus matching `Origin` and `Host`. Missing headers are rejected.
- Writes that install an executable command require a second confirmation
  naming the exact command.
- Every write is backed up beside the original at mode `0600` and performed
  under a lockfile with a compare-and-swap against the on-disk content.

## Development

    npm install
    npm test
    npm run build
