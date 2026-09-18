import { describe, it, expect } from 'vitest'
import { bandsFor } from '../src/ui/Inventory.jsx'

const item = (label, cls, extra = {}) => ({
  id: label, label, writability: { class: cls }, ...extra,
})

describe('bandsFor', () => {
  it('puts what you can edit first, whatever its size', () => {
    const bands = bandsFor([
      item('a', 'redirect', { plugin: 'spyglass' }),
      item('b', 'redirect', { plugin: 'spyglass' }),
      item('mine', 'free'),
    ])
    expect(bands.map((b) => b.key)).toEqual(['yours', 'spyglass'])
  })

  it('counts an executable file as yours — it is editable, with a confirmation', () => {
    const [band] = bandsFor([item('hook.sh', 'exec')])
    expect(band.key).toBe('yours')
  })

  it('orders read-only bands by size so the bulk is obvious', () => {
    const bands = bandsFor([
      item('a', 'redirect', { plugin: 'small' }),
      item('b', 'redirect', { plugin: 'big' }),
      item('c', 'redirect', { plugin: 'big' }),
    ])
    expect(bands.map((b) => b.label)).toEqual(['big', 'small'])
  })

  it('annotates an owned band read-only, because its rows no longer say so', () => {
    // This used to assert note: null, on the reasoning that naming the owner
    // implied it. That held only while every row inside also carried a
    // read-only chip. The rows stopped, so the band has to say it.
    const [band] = bandsFor([item('a', 'redirect', { plugin: 'spyglass' })])
    expect(band).toMatchObject({ label: 'spyglass', note: 'read-only' })
  })

  it('falls back to the marketplace when there is no plugin — plugins themselves', () => {
    const [band] = bandsFor([item('spyglass', 'redirect', { marketplace: 'spyglass-mp' })])
    expect(band.label).toBe('spyglass-mp')
  })

  it('never drops a read-only item that has no owner at all', () => {
    const bands = bandsFor([item('managed.json', 'readonly'), item('sess', 'guarded')])
    expect(bands).toHaveLength(1)
    expect(bands[0]).toMatchObject({ label: 'read-only', note: 'read-only' })
    expect(bands[0].items).toHaveLength(2)
  })

  it('bands every item exactly once', () => {
    const items = [
      item('a', 'free'), item('b', 'exec'),
      item('c', 'redirect', { plugin: 'p' }), item('d', 'guarded'),
    ]
    const banded = bandsFor(items).flatMap((b) => b.items)
    expect(banded).toHaveLength(items.length)
    expect(new Set(banded.map((i) => i.id)).size).toBe(items.length)
  })
})
