export const ok = (value) => ({ state: 'ok', value })
export const empty = () => ({ state: 'empty' })
export const absent = (path) => ({ state: 'absent', path })
export const denied = (path, errno) => ({ state: 'denied', path, errno })
export const malformed = (path, message, line, column) =>
  ({ state: 'malformed', path, message, line, column })

export const isOk = (r) => r.state === 'ok'
export const valueOr = (r, fallback) => (r.state === 'ok' ? r.value : fallback)
