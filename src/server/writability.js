import path from 'node:path'

const MANAGED_DIRS = [
  '/Library/Application Support/ClaudeCode',
  '/etc/claude-code',
]

// This filesystem is case-insensitive on darwin and win32, so a case-exact
// string comparison fails open: /users/... and /Users/... are the same file.
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32'
const fold = (p) => (CASE_INSENSITIVE ? p.normalize('NFC').toLowerCase() : p.normalize('NFC'))

// Note: a plain startsWith(root) also matches "~/.claude.json" and
// "~/.claude-atlas". Compare on path segments. Spec §9.4.
function isUnder(child, parent) {
  const rel = path.relative(fold(path.resolve(parent)), fold(path.resolve(child)))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function classify({ path: target, kind, root }) {
  const abs = path.resolve(target)

  if (MANAGED_DIRS.some((d) => isUnder(abs, d) || abs === path.join(d, 'managed-settings.json'))) {
    return { class: 'readonly', reason: 'Managed policy — root-owned, deployed by your organization' }
  }

  if (fold(path.basename(abs)) === '.claude.json' && !isUnder(abs, root)) {
    return { class: 'guarded', reason: 'Holds your sign-in session and per-project state' }
  }

  if (kind === 'session' || kind === 'subagentTranscript' || abs.endsWith('.jsonl')) {
    return { class: 'guarded', reason: 'Editing a transcript breaks --resume' }
  }

  if (isUnder(abs, path.join(root, 'plugins', 'cache'))) {
    return {
      class: 'redirect',
      reason: 'Inside the plugin cache — overwritten on the next plugin update',
      redirectTo: path.join(root, 'plugins', 'marketplaces'),
    }
  }

  if (isUnder(abs, path.join(root, 'plugins', 'marketplaces'))) {
    return { class: 'readonly', reason: 'Marketplace git checkout — managed by claude plugin update' }
  }

  if (isUnder(abs, path.join(root, 'skills', 'synced'))) {
    return {
      class: 'redirect',
      reason: 'Synced from claude.ai — overwritten on the next sync',
      redirectTo: path.join(root, 'skills'),
    }
  }

  if (kind === 'hookScript' || kind === 'statusLineScript') {
    return { class: 'exec', reason: 'This file is executed as shell by Claude Code' }
  }

  // Anything that resolves outside the configuration root is not ours to write.
  // This comes after the hookScript/statusLineScript check above, because those
  // legitimately live elsewhere (e.g. ~/bin/statusline.sh).
  if (!isUnder(abs, root)) {
    return { class: 'readonly', reason: 'Outside the Claude configuration root' }
  }

  return { class: 'free', reason: 'User-authored configuration' }
}
