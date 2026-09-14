// A line diff with no dependency, and — the part that matters here — a state
// for "I could not compute this". Four independent researchers found that this
// app versions files and then makes you restore blind; showing a diff you did
// not actually compute would be a worse answer than showing none.
//
//   identical      both sides are byte-for-byte the same
//   changed        a real diff, with its lines
//   unverifiable   something stopped the comparison; `reason` says what
//
// `unverifiable` is never downgraded to `identical`. A restore proceeds whether
// or not this function understood the content, so silence here would read as
// "nothing will change" — the bare zero this project exists to prevent.

// Above this a full LCS table costs more memory than the answer is worth. The
// limit is stated out loud when it bites, never silently applied to a prefix.
export const MAX_LINES = 4000
export const MAX_BYTES = 2 * 1024 * 1024

const NUL = String.fromCharCode(0)
const looksBinary = (text) => text.includes(NUL)

// Standard LCS backtrack. Both inputs are bounded by MAX_LINES before we get
// here, so the table is at most 4000x4000 cells.
function lcsLines(a, b) {
  const n = a.length
  const m = b.length
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i += 1; j += 1 } else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i += 1 } else { out.push({ type: 'add', text: b[j] }); j += 1 }
  }
  while (i < n) { out.push({ type: 'del', text: a[i] }); i += 1 }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j += 1 }
  return out
}

/**
 * Compare two texts. Either side may be null, meaning "could not be read" —
 * the caller says why in `missingReason`, because only the caller knows
 * whether the file was absent, denied or unreadable.
 */
export function diffText(before, after, { beforeLabel = 'version', afterLabel = 'current' } = {}) {
  if (before === null || after === null) {
    const which = before === null ? beforeLabel : afterLabel
    return { state: 'unverifiable', reason: `${which} could not be read`, lines: [], addCount: 0, delCount: 0 }
  }
  if (looksBinary(before) || looksBinary(after)) {
    return { state: 'unverifiable', reason: 'binary content — a line diff would be meaningless', lines: [], addCount: 0, delCount: 0 }
  }
  if (before === after) {
    return { state: 'identical', reason: null, lines: [], addCount: 0, delCount: 0 }
  }

  // TextEncoder rather than Buffer: this module runs in the browser too, so a
  // save preview needs no round trip to the server.
  const bytes = (t) => new TextEncoder().encode(t).length
  const size = Math.max(bytes(before), bytes(after))
  if (size > MAX_BYTES) {
    return {
      state: 'unverifiable',
      reason: `too large to diff — ${Math.round(size / 1024)} KB, the limit is ${MAX_BYTES / 1024} KB`,
      lines: [], addCount: 0, delCount: 0,
    }
  }

  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return {
      state: 'unverifiable',
      reason: `too many lines to diff — ${Math.max(a.length, b.length)}, the limit is ${MAX_LINES}`,
      lines: [], addCount: 0, delCount: 0,
    }
  }

  const lines = lcsLines(a, b)
  return {
    state: 'changed',
    reason: null,
    lines,
    addCount: lines.filter((l) => l.type === 'add').length,
    delCount: lines.filter((l) => l.type === 'del').length,
  }
}
