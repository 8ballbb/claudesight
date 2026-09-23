// Pure filtering behind the inventory search. A match is over everything a row
// carries that a person might search by — its label, description, path, the
// settings key it declares, the command it runs — so "review" finds a skill by
// name and "prettier" finds a hook by its command.
export function itemMatches(item, q) {
  const hay = [item.label, item.description, item.path, item.keyPath, item.command, item.reason, item.plugin, item.marketplace]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

// Returns groups with non-matching items removed and empty groups dropped, so
// the page shows only what matched. An empty query returns the groups
// untouched — the caller decides how to render the unfiltered page.
export function filterGroups(groups, query) {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => itemMatches(i, q)) }))
    .filter((g) => g.items.length > 0)
}

export function countItems(groups) {
  return groups.reduce((n, g) => n + g.items.length, 0)
}
