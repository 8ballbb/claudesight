import { describe, it, expect } from 'vitest'
import { ok, empty, absent, denied, malformed, isOk, valueOr } from '../src/server/result.js'

describe('Result', () => {
  it('distinguishes absent from empty — the skill-cabinet bug', () => {
    expect(absent('/nope').state).toBe('absent')
    expect(empty().state).toBe('empty')
    expect(absent('/nope').state).not.toBe(empty().state)
  })

  it('carries the path on absent and denied so the UI can explain', () => {
    expect(absent('/a/b').path).toBe('/a/b')
    expect(denied('/c/d', 'EPERM').path).toBe('/c/d')
    expect(denied('/c/d', 'EPERM').errno).toBe('EPERM')
  })

  it('carries position on malformed', () => {
    const m = malformed('/x.json', 'Unexpected token', 14, 3)
    expect(m.state).toBe('malformed')
    expect(m.line).toBe(14)
    expect(m.column).toBe(3)
  })

  it('isOk is true only for ok', () => {
    expect(isOk(ok([1]))).toBe(true)
    for (const r of [empty(), absent('/p'), denied('/p', 'EACCES'), malformed('/p', 'x', 1, 1)]) {
      expect(isOk(r)).toBe(false)
    }
  })

  it('valueOr returns the fallback for every non-ok state', () => {
    expect(valueOr(ok(['a']), [])).toEqual(['a'])
    expect(valueOr(empty(), [])).toEqual([])
    expect(valueOr(denied('/p', 'EPERM'), [])).toEqual([])
  })
})
