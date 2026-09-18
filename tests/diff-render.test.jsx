// @vitest-environment happy-dom
//
// The restore diff was once computed backwards and corrected in the view,
// and that correction survived exactly until the CSS was updated without the
// JSX. The guard against it was `expect(src).toContain('verb="Restoring"')`,
// which cannot tell whether a single line reaches the screen with the right
// sign. These mount the component and read the marks.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Diff } from '../src/ui/Editor.jsx'

afterEach(cleanup)

const changed = {
  state: 'changed',
  addCount: 2,
  delCount: 1,
  lines: [
    { type: 'add', text: 'new line' },
    { type: 'del', text: 'old line' },
    { type: 'same', text: 'unchanged' },
  ],
}

describe('every diff is read in the direction of its action', () => {
  it('says what SAVING would do', () => {
    render(<Diff result={changed} verb="Saving" nothingToDo="No change." />)
    expect(screen.getByText(/Saving would add/)).toBeTruthy()
  })

  it('says what RESTORING would do, using the same sign convention', () => {
    render(<Diff result={changed} verb="Restoring" nothingToDo="No change." />)
    expect(screen.getByText(/Restoring would add/)).toBeTruthy()
  })

  it('marks an added line with + and a removed line with a minus', () => {
    render(<Diff result={changed} verb="Saving" nothingToDo="x" />)
    expect(screen.getByText('new line').previousSibling.textContent).toBe('+')
    expect(screen.getByText('old line').previousSibling.textContent).toBe('−')
  })

  it('leaves an unchanged line unmarked rather than guessing a sign', () => {
    render(<Diff result={changed} verb="Saving" nothingToDo="x" />)
    expect(screen.getByText('unchanged').previousSibling.textContent).toBe(' ')
  })
})

describe('a diff that is not a list of changes still names itself', () => {
  it('says it is still comparing rather than showing an empty pane', () => {
    render(<Diff result={null} verb="Saving" nothingToDo="x" />)
    expect(screen.getByText(/Comparing/)).toBeTruthy()
  })

  it('says identical rather than rendering nothing', () => {
    render(<Diff result={{ state: 'identical' }} verb="Saving" nothingToDo="No change." />)
    expect(screen.getByText('No change.')).toBeTruthy()
  })

  it('distinguishes "could not compare" from "no difference"', () => {
    render(<Diff result={{ state: 'failed', reason: 'file too large' }} verb="Saving" nothingToDo="No change." />)
    expect(screen.getByText(/Could not compare: file too large/)).toBeTruthy()
    expect(screen.queryByText('No change.')).toBe(null)
  })
})
