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

  it('carries no reference to either former name', () => {
    for (const [file, text] of allDocs) {
      expect(text, `${file} still mentions the first name`).not.toMatch(/claude-atlas/i)
    }
  })

  it('never tells anyone to run the name that could not be published', () => {
    // `claudescope` survives in the spec's revision history on purpose — the
    // rename has to stay explicable. What must not survive is an instruction:
    // a command, a repo URL or a path naming it. That is the form the last
    // botched rename took, and the form a reader can actually act on.
    const instructions = [
      /npx\s+(?:@[\w.-]+\/)?claudescope/i,
      /github\.com\/8ballbb\/claudescope/i,
      /bin\/claudescope\.js/i,
      /npm\s+install\s+-g\s+(?:@[\w.-]+\/)?claudescope/i,
    ]
    for (const [file, text] of allDocs) {
      for (const pattern of instructions) {
        expect(text, `${file} still tells the reader to use the old name`).not.toMatch(pattern)
      }
    }
  })

  it('keeps the old name out of everything but the two places that explain it', () => {
    // Two documents may name it, because in both the old name IS the subject:
    // the spec's revision history, and CONTRIBUTING's note on checking a name.
    // Everywhere else it is residue from a rename.
    const exempt = {
      'docs/superpowers/specs/2026-09-11-claudesight-design.md': '## 14. Revision history',
      'CONTRIBUTING.md': '## Naming',
    }
    for (const [file, text] of allDocs) {
      const heading = exempt[file]
      if (!heading) {
        expect(text, `${file} still mentions claudescope`).not.toMatch(/claudescope/i)
        continue
      }
      const parts = text.split(heading)
      expect(parts, `${file} lost the heading that exempts it`).toHaveLength(2)
      expect(parts[0], `claudescope appears in ${file} outside ${heading}`)
        .not.toMatch(/claudescope/i)
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

  it('renders a wordmark that is the package name', () => {
    // The wordmark is written `claude·sight`, with a separator inside the word.
    // A rename by find-and-replace does not see it — the last one missed it,
    // and only looking at a screenshot caught it.
    const jsx = fs.readFileSync('src/ui/App.jsx', 'utf8')
    const mark = jsx.match(/className=\{s\.wordmark\}>([^<]+)</)
    expect(mark, 'the wordmark heading moved or changed shape').not.toBeNull()
    expect(mark[1].replace(/[^a-z]/gi, '').toLowerCase()).toBe(pkg.name.toLowerCase())
  })

  it('quotes no test count, because a quoted count goes stale silently', () => {
    // It said 296 while the suite ran 304. A number nothing checks is a claim
    // nothing maintains.
    expect(readme).not.toMatch(/#\s*\d+ tests/)
  })
})

// Claims that drift silently when behaviour changes. Each one was true when
// written and would have quietly become false: the README said only skills
// could be created for three releases after that stopped being so.
describe('claims the docs make about behaviour', () => {
  const security = fs.readFileSync('SECURITY.md', 'utf8')

  // Scoped to the section that makes the claim. Matching the whole README
  // was vacuous: "a skill" and "CLAUDE.md" appear all over it, so the test
  // passed with the sentence deleted. Caught by reverting the claim and
  // watching it stay green.
  const section = (heading) => {
    const start = readme.indexOf(`## ${heading}`)
    if (start === -1) return ''
    const next = readme.indexOf('\n## ', start + 1)
    return readme.slice(start, next === -1 ? undefined : next)
  }

  it('names every kind that can actually be created, and no others', async () => {
    const { CREATABLE } = await import('../src/server/create.js')
    const adding = section('Adding artifacts')
    expect(adding, 'README needs an "Adding artifacts" section').not.toBe('')
    const named = {
      memory: /`CLAUDE\.md`/.test(adding),
      rule: /\ba rule\b/.test(adding),
      skill: /\ba skill\b/.test(adding),
      agent: /\ba subagent\b/.test(adding),
    }
    for (const kind of CREATABLE) {
      expect(named[kind], `the "Adding artifacts" section should name ${kind}`).toBe(true)
    }
    expect(adding, 'must not offer to create commands').not.toMatch(/create a command\b/i)
  })

  it('still says commands are deprecated, which is why they are not creatable', () => {
    expect(readme).toMatch(/commands.{0,80}deprecated|deprecated.{0,80}commands/is)
  })

  it('quotes the port the server actually defaults to', async () => {
    const { DEFAULT_PORT } = await import('../src/server/index.js')
    expect(readme, `README should quote port ${DEFAULT_PORT}`).toContain(String(DEFAULT_PORT))
  })

  it('lists the runtime dependencies this package actually has', () => {
    for (const dep of Object.keys(pkg.dependencies)) {
      expect(security, `SECURITY.md should name the runtime dependency ${dep}`)
        .toContain(`\`${dep}\``)
    }
  })

  it('does not still say the confirmation gate is only for JSON', () => {
    // The gate reads markdown frontmatter too; saying otherwise understates
    // what the app protects you from.
    expect(security).toMatch(/frontmatter/i)
  })

  // One matcher, used by both tests below. Written twice, the second test
  // would verify its own private copy: editing the regex here and not there
  // would leave it passing while the thing it guards had changed.
  //
  // The character class must not exclude `:`, or an https link matches
  // WITHOUT its scheme and is then checked as a relative file that does not
  // exist. That was the bug; the URL test below is what holds it shut.
  const linkTargets = (text) =>
    [...text.matchAll(/\(([^()\s]+\.(?:md|jpg|png))\)/g)].map((m) => m[1])

  it('points only at files that exist', () => {
    for (const rel of linkTargets(readme)) {
      if (rel.includes('://')) continue
      expect(fs.existsSync(rel), `README points at ${rel}, which does not exist`).toBe(true)
    }
  })

  it('does not mistake a URL for a missing file', () => {
    const referenced = linkTargets(`${readme}\n[spec](https://example.com/doc.md)\n`)
    expect(referenced).toContain('https://example.com/doc.md')
    expect(referenced.filter((r) => !r.includes('://')).every((r) => fs.existsSync(r))).toBe(true)
  })
})
