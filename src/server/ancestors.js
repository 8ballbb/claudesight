import fs from 'node:fs'
import path from 'node:path'

// Where Claude Code looks for project configuration, which is not only the
// directory you launched it in.
//
// Two different boundaries, both taken from the documented behaviour rather
// than guessed, because reporting a file as loaded when it is not — or missing
// one that is — is the failure this app exists to prevent:
//
//   .claude/skills, agents, commands   the launch directory and every parent
//                                      up to the REPOSITORY ROOT, and where a
//                                      name collides the closest one wins.
//
//   CLAUDE.md, CLAUDE.local.md         the launch directory and EVERY parent
//                                      above it, all concatenated, none of
//                                      them overriding another.
//
// The second walk goes further than the first. That asymmetry is real: a
// CLAUDE.md above your repository is still loaded, a .claude/agents above it
// is not.

// The nearest ancestor holding `.git`. It is a file, not a directory, in a
// worktree or a submodule, so presence is what is tested, not type.
export function repoRootOf(dir) {
  let cur = path.resolve(dir)
  const top = path.parse(cur).root
  for (;;) {
    try { if (fs.existsSync(path.join(cur, '.git'))) return cur } catch { /* unreadable is not a root */ }
    if (cur === top) return null
    cur = path.dirname(cur)
  }
}

// `from` and each parent above it, nearest first, stopping after `stop`.
// A `stop` that is not an ancestor of `from` yields `from` alone rather than
// walking to the filesystem root by accident.
function chain(from, stop) {
  const start = path.resolve(from)
  const out = [start]
  if (stop === null || start === stop) return out
  let cur = start
  const top = path.parse(start).root
  while (cur !== top) {
    const parent = path.dirname(cur)
    if (parent === cur) break
    out.push(parent)
    if (parent === stop) return out
    cur = parent
  }
  // `stop` was never reached: it does not lie above `from`.
  return stop === undefined ? out : [start]
}

// Directories whose `.claude/<kind>/` Claude Code loads for this project.
// Outside a repository there is no root to walk to, so only the project.
export function artifactDirs(projectPath) {
  const root = repoRootOf(projectPath)
  if (root === null) return [path.resolve(projectPath)]
  return chain(projectPath, root)
}

// Directories whose CLAUDE.md and CLAUDE.local.md Claude Code loads. This one
// does not stop at the repository.
export function memoryDirs(projectPath) {
  return chain(projectPath, undefined)
}
