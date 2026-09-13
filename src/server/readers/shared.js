import path from 'node:path'
import YAML from 'yaml'

export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, malformed: false }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { data: {}, malformed: true }
  try {
    return { data: YAML.parse(text.slice(4, end)) ?? {}, malformed: false }
  } catch {
    return { data: {}, malformed: true }
  }
}

// plugins/cache/<marketplace>/<plugin>/<version>/<kind>/...
export function attributePlugin(root, filePath) {
  const rel = path.relative(path.join(root, 'plugins', 'cache'), filePath)
  if (rel.startsWith('..')) return {}
  const parts = rel.split(path.sep)
  return { marketplace: parts[0], plugin: parts[1] }
}

// Plugin repos vendor copies of their artifacts for other agents — .cursor/,
// .codex-plugin/, .agents/ and so on. Claude Code does not load those, so
// counting them double-reports one artifact under two paths. Filtering is
// relative to the walk root: the root itself lives under ~/.claude, hidden.
export function visibleUnder(root, paths) {
  return paths.filter((p) =>
    !path.relative(root, p).split(path.sep).some((seg) => seg.startsWith('.')))
}
