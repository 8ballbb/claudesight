import path from 'node:path'

export function resolveRoot(env = process.env, home = process.env.HOME) {
  const configured = env.CLAUDE_CONFIG_DIR
  if (typeof configured === 'string' && configured.length > 0) {
    return { path: path.resolve(configured), source: 'CLAUDE_CONFIG_DIR' }
  }
  return { path: path.join(home, '.claude'), source: 'default' }
}
