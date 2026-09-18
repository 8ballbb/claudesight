import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// The ESLint config carries two rules that are not style — they enforce spec
// §9.5, which bans every route from a string to executed markup. Moving from
// .eslintrc.json to flat config could have dropped them with nothing failing:
// lint would simply stop objecting. These run the real linter over real
// violations and insist it still objects.

const DIR = path.resolve('.lint-fixture')
const lint = (file) => {
  try {
    execFileSync('npx', ['eslint', '--format', 'json', file], { encoding: 'utf8' })
    return []
  } catch (err) {
    // ESLint exits non-zero when it finds errors; the report is still on stdout.
    return JSON.parse(err.stdout)[0].messages
  }
}

beforeAll(() => fs.mkdirSync(DIR, { recursive: true }))
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

const fixture = (name, source) => {
  const file = path.join(DIR, name)
  fs.writeFileSync(file, source)
  return file
}

describe('the rules that enforce spec §9.5 still fire', () => {
  it('refuses an assignment to innerHTML', () => {
    const messages = lint(fixture('inner.js', 'const el = document.body\nel.innerHTML = "<b>x</b>"\n'))
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-properties')
    expect(messages.map((m) => m.message).join(' ')).toMatch(/§9\.5/)
  })

  it('refuses outerHTML too', () => {
    const messages = lint(fixture('outer.js', 'const el = document.body\nel.outerHTML = "<b>x</b>"\n'))
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-properties')
  })

  it('refuses the dangerouslySetInnerHTML JSX attribute', () => {
    const messages = lint(fixture('jsx.jsx',
      'export const C = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />\n'))
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-syntax')
    expect(messages.map((m) => m.message).join(' ')).toMatch(/§9\.5/)
  })

  it('leaves innocent code alone, so the rules are not just erroring at everything', () => {
    const messages = lint(fixture('clean.js', 'export const add = (a, b) => a + b\n'))
    expect(messages).toEqual([])
  })
})

// `npm run lint` enumerates scripts/, so an .mjs file there LOOKED linted
// while every config block was scoped to .js/.jsx — it was checked against no
// rules at all, and an undefined identifier passed CI. The extension list is
// the whole guard, so it gets a test of its own.
describe('extensions the config actually covers', () => {
  it('lints .mjs, which npm run lint enumerates', () => {
    const messages = lint(fixture('script.mjs', 'const x = notDefinedAnywhere\nexport default x\n'))
    expect(messages.map((m) => m.ruleId)).toContain('no-undef')
  })

  it('lints .jsx, the extension this hole was first found in', () => {
    const messages = lint(fixture('component.jsx', 'const x = alsoNotDefined\nexport default x\n'))
    expect(messages.map((m) => m.ruleId)).toContain('no-undef')
  })

  it('still lints plain .js', () => {
    const messages = lint(fixture('plain.js', 'const x = stillNotDefined\nexport default x\n'))
    expect(messages.map((m) => m.ruleId)).toContain('no-undef')
  })
})
