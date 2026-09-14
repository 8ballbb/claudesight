import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

// Found by building a demo config with five markers on one project: the row
// clipped its last chips with no sign it had done so. A silent truncation is
// the same lie as a count standing in for the paths behind it.
const jsx = fs.readFileSync('src/ui/Projects.jsx', 'utf8')

describe('a project row never hides markers silently', () => {
  it('caps what it shows and counts what it did not', () => {
    expect(jsx).toContain('const MARKERS_SHOWN = 4')
    expect(jsx).toContain('const hidden = found.length - shown.length')
    expect(jsx).toContain('+{hidden}')
  })

  it('renders the overflow chip only when something is actually hidden', () => {
    expect(jsx).toContain('{hidden > 0 && (')
  })

  it('keeps every marker reachable through the title', () => {
    expect(jsx).toContain('found.map((m) => MARKER_LABEL[m]).join')
  })
})
