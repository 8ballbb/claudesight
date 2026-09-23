// The inventory search matches over everything a row carries, not just its
// name, and drops groups that have nothing left — so the page shows only what
// matched, at whatever scope.
import { describe, it, expect } from 'vitest'
import { itemMatches, filterGroups, countItems } from '../src/ui/inventoryFilter.js'

const groups = [
  { kind: 'skill', items: [
    { label: 'code-reviewer', description: 'Reviews a diff for correctness.' },
    { label: 'changelog-entry', description: 'Writes a changelog line.' },
  ] },
  { kind: 'scripts', items: [
    { label: 'format.sh', command: 'npx prettier --write .', path: '/h/.claude/hooks/format.sh' },
  ] },
  { kind: 'plugin', items: [
    { label: 'deep-review', plugin: 'review-kit' },
  ] },
]

describe('itemMatches', () => {
  it('matches on the label', () => {
    expect(itemMatches({ label: 'code-reviewer' }, 'review')).toBe(true)
  })
  it('matches on the description, so a concept finds a differently-named row', () => {
    expect(itemMatches({ label: 'x', description: 'Writes a changelog line.' }, 'changelog')).toBe(true)
  })
  it('matches on a command, so "prettier" finds a hook', () => {
    expect(itemMatches({ label: 'format.sh', command: 'npx prettier --write .' }, 'prettier')).toBe(true)
  })
  it('matches on the owning plugin', () => {
    expect(itemMatches({ label: 'deep-review', plugin: 'review-kit' }, 'review-kit')).toBe(true)
  })
  it('is false when nothing carries the term', () => {
    expect(itemMatches({ label: 'a', description: 'b' }, 'zzz')).toBe(false)
  })
})

describe('filterGroups', () => {
  it('returns groups untouched for an empty query', () => {
    expect(filterGroups(groups, '')).toBe(groups)
    expect(filterGroups(groups, '   ')).toBe(groups)
  })
  it('keeps only matching items and drops emptied groups', () => {
    const r = filterGroups(groups, 'review')
    expect(r.map((g) => g.kind)).toEqual(['skill', 'plugin'])
    expect(r[0].items.map((i) => i.label)).toEqual(['code-reviewer'])
  })
  it('finds a hook across group boundaries by its command', () => {
    const r = filterGroups(groups, 'prettier')
    expect(r.map((g) => g.kind)).toEqual(['scripts'])
  })
  it('does not mutate the input groups', () => {
    filterGroups(groups, 'review')
    expect(groups[0].items.length).toBe(2)
  })
  it('returns nothing when a query matches nothing', () => {
    expect(filterGroups(groups, 'nope-xyz')).toEqual([])
  })
})

describe('countItems', () => {
  it('totals across groups', () => {
    expect(countItems(groups)).toBe(4)
    expect(countItems(filterGroups(groups, 'review'))).toBe(2)
  })
})
