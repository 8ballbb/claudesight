#!/usr/bin/env node
// Is an npm package name actually obtainable?
//
// `npm view <name>` returning 404 does NOT answer this. 404 means unregistered,
// which is weaker than available: npm also refuses a name whose "normalised"
// form — punctuation stripped, lowercased — collides with an existing package.
// This project was named `claudescope` on the strength of a 404 and could not be
// published, because `claude-scope` already existed and normalises identically.
//
//   node scripts/check-name.mjs claudesight claudescope
//
// Exits non-zero if any name is blocked.

const norm = (s) => s.replace(/[-_.]/g, '').toLowerCase()
const exists = async (name, method = 'GET') =>
  (await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { method })).status === 200

async function blockers(name) {
  const hits = new Set()
  const target = norm(name)

  if (await exists(name)) hits.add(name)

  // Search catches near-names that are not simple separator insertions.
  const res = await fetch(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(name)}&size=100`)
  const { objects = [] } = await res.json()
  for (const o of objects) if (norm(o.package.name) === target) hits.add(o.package.name)

  // Every single-separator variant, which search alone can miss.
  const variants = []
  for (let i = 1; i < target.length; i++) {
    for (const sep of ['-', '_', '.']) variants.push(target.slice(0, i) + sep + target.slice(i))
  }
  await Promise.all(variants.map(async (v) => {
    if (await exists(v, 'HEAD')) hits.add(v)
  }))

  return [...hits]
}

const names = process.argv.slice(2)
if (!names.length) {
  console.error('usage: node scripts/check-name.mjs <name> [name...]')
  process.exit(2)
}

let blocked = false
for (const name of names) {
  const found = await blockers(name)
  if (found.length) {
    blocked = true
    console.log(`${name}: BLOCKED by ${found.join(', ')}`)
  } else {
    console.log(`${name}: clear`)
  }
}
process.exit(blocked ? 1 : 0)
