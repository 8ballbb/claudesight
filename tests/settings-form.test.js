// The form is a view over the JSON buffer; these are the pure edits behind it.
// The property that matters most: an edit never touches a key it was not asked
// to, so unknown keys — newer than the catalogue, or typos — survive untouched.
import { describe, it, expect } from 'vitest'
import { bandsFor, enumAdvice, setValue, removeKey, addKey, coerce, listAdd, listSetAt, listRemoveAt, pairsToObject, objectToPairs } from '../src/ui/settingsForm.js'

const entries = [
  { key: 'autoUpdatesChannel', control: 'enum', enum: ['stable', 'latest'], default: 'latest' },
  { key: 'cleanupPeriodDays', control: 'number', min: 1, default: 30 },
  { key: 'autoMemoryEnabled', control: 'boolean' },
  { key: 'model', control: 'string' },
  { key: 'permissions', control: 'json', type: 'object' },
  { key: 'legacyThing', control: 'string', deprecated: true },
]

describe('bandsFor', () => {
  it('splits set, available and unknown', () => {
    const b = bandsFor({ model: 'opus', notReal: 1 }, entries)
    expect(b.set.map((s) => s.key)).toEqual(['model'])
    expect(b.unknown.map((u) => u.key)).toEqual(['notReal'])
    expect(b.available.map((a) => a.key)).toContain('autoUpdatesChannel')
    expect(b.available.map((a) => a.key)).not.toContain('model')
  })

  it('carries the current value onto a set row', () => {
    expect(bandsFor({ cleanupPeriodDays: 7 }, entries).set[0].value).toBe(7)
  })

  it('sorts deprecated keys to the end of the available band', () => {
    const avail = bandsFor({}, entries).available.map((a) => a.key)
    expect(avail[avail.length - 1]).toBe('legacyThing')
  })

  it('treats a non-object value as nothing set, without throwing', () => {
    expect(bandsFor(null, entries).set).toEqual([])
    expect(bandsFor('nonsense', entries).unknown).toEqual([])
  })
})

describe('enumAdvice', () => {
  it('flags a value outside the documented set', () => {
    expect(enumAdvice(entries[0], 'nightly')).toEqual({ value: 'nightly', allowed: ['stable', 'latest'] })
  })
  it('says nothing for an allowed value or a setting with no enum', () => {
    expect(enumAdvice(entries[0], 'stable')).toBe(null)
    expect(enumAdvice(entries[3], 'anything')).toBe(null)
  })
})

describe('edits preserve everything they were not asked to change', () => {
  const start = { model: 'opus', notReal: 1, permissions: { allow: ['Bash'] } }

  it('setValue changes one key and returns a new object', () => {
    const next = setValue(start, 'model', 'sonnet')
    expect(next).not.toBe(start)
    expect(next).toEqual({ model: 'sonnet', notReal: 1, permissions: { allow: ['Bash'] } })
    expect(start.model).toBe('opus')
  })

  it('removeKey drops one and keeps an unknown key untouched', () => {
    expect(removeKey(start, 'model')).toEqual({ notReal: 1, permissions: { allow: ['Bash'] } })
  })

  it('addKey seeds a setting with its documented default', () => {
    expect(addKey({}, entries[1]).cleanupPeriodDays).toBe(30)
  })

  it('addKey with no default seeds a type-appropriate empty, not a guess', () => {
    expect(addKey({}, entries[2]).autoMemoryEnabled).toBe(false)
    expect(addKey({}, entries[3]).model).toBe('')
    expect(addKey({}, entries[4]).permissions).toEqual({})
  })

  it('adding a key leaves an unknown key beside it alone', () => {
    expect(addKey(start, entries[2])).toMatchObject({ notReal: 1, autoMemoryEnabled: false })
  })
})

describe('coerce', () => {
  it('makes a number field a number and a toggle a boolean', () => {
    expect(coerce('number', '7')).toBe(7)
    expect(coerce('boolean', true)).toBe(true)
  })
  it('leaves an unparseable number as-is rather than writing NaN', () => {
    expect(coerce('number', 'abc')).toBe('abc')
  })
  it('leaves strings alone', () => {
    expect(coerce('string', 'opus')).toBe('opus')
  })
})

describe('list edits are immutable and preserve order', () => {
  it('adds without mutating the original', () => {
    const a = ['x']
    const b = listAdd(a, 'y')
    expect(b).toEqual(['x', 'y'])
    expect(a).toEqual(['x'])
  })
  it('sets one index', () => {
    expect(listSetAt(['a', 'b', 'c'], 1, 'B')).toEqual(['a', 'B', 'c'])
  })
  it('removes one index', () => {
    expect(listRemoveAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })
  it('treats a non-array as empty rather than throwing', () => {
    expect(listAdd(undefined, 'x')).toEqual(['x'])
    expect(listRemoveAt(null, 0)).toEqual([])
  })
})

describe('map rows round-trip and drop blank keys', () => {
  it('builds an object from pairs, ignoring empty keys', () => {
    expect(pairsToObject([['a', '1'], ['', 'orphan'], ['b', '2']])).toEqual({ a: '1', b: '2' })
  })
  it('reads pairs from an object', () => {
    expect(objectToPairs({ a: '1', b: '2' })).toEqual([['a', '1'], ['b', '2']])
  })
  it('a later duplicate key wins, matching object semantics', () => {
    expect(pairsToObject([['a', '1'], ['a', '2']])).toEqual({ a: '2' })
  })
})
