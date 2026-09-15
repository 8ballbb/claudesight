import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const readme = fs.readFileSync('README.md', 'utf8')
const docs = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n').filter(Boolean)
const allDocs = docs.map((f) => [f, fs.readFileSync(f, 'utf8')])

// A blanket find-and-replace across prose once rewrote a sentence ABOUT a
// different project into a false claim about this one — the README ended up
// telling readers not to run the very command that works. These check the
// claims that such an edit would break.
describe('the docs describe this project, accurately', () => {
  it('tells people to run the binary this package actually installs', () => {
    const bin = Object.keys(pkg.bin)[0]
    expect(readme).toContain(`npx github:8ballbb/${bin}`)
    expect(readme).toContain(`cd ${bin}`)
  })

  it('points every repo link at the repository package.json declares', () => {
    const name = pkg.repository.url.match(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/)[1]
    for (const [file, text] of allDocs) {
      const links = text.match(/github\.com\/8ballbb\/[\w.-]+/g) ?? []
      for (const link of links) {
        expect(link, `${file} links to a repo this package does not declare`)
          .toBe(`github.com/${name}`)
      }
    }
  })

  it('never claims our own package name belongs to somebody else', () => {
    // The exact shape of the bug: the warning about `claude-atlas` on npm was
    // rewritten to say our own name was taken, which was both false and
    // actively misleading.
    const ours = pkg.name
    for (const [file, text] of allDocs) {
      const claim = new RegExp(`\`?${ours}\`?[^.\\n]{0,80}belongs to`, 'i')
      expect(text, `${file} says ${ours} belongs to another project`).not.toMatch(claim)
    }
  })

  it('carries no reference to the former name', () => {
    for (const [file, text] of allDocs) {
      expect(text, `${file} still mentions the old name`).not.toMatch(/claude-atlas/i)
    }
  })

  it('tells people to install the name that is actually published', () => {
    // The README's first instruction is an npm install of this package. If the
    // package were ever renamed, this is the line that would start lying.
    expect(readme).toContain(`npx ${pkg.name}@latest`)
    expect(Object.keys(pkg.bin)).toContain(pkg.name.replace(/^@[^/]+\//, ''))
  })

  it('no longer claims the package is unpublished', () => {
    // It was true until the release workflow landed; leaving it in place would
    // tell readers the working command does not work.
    expect(readme).not.toMatch(/not published to npm/i)
  })

  it('quotes no test count, because a quoted count goes stale silently', () => {
    // It said 296 while the suite ran 304. A number nothing checks is a claim
    // nothing maintains.
    expect(readme).not.toMatch(/#\s*\d+ tests/)
  })
})
