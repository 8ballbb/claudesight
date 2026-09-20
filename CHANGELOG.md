# Changelog

## v0.8.0 — 2026-09-20

### Added

- form controls for lists, string maps, and one-level objects

## v0.7.0 — 2026-09-20

### Added

- a form view for settings — set, available-to-add, and unknown
- a settings catalogue — every key Claude Code accepts, bundled

## v0.6.2 — 2026-09-19

### Changed

- mint row identity structurally, so a producer cannot forget

## v0.6.1 — 2026-09-18

### Fixed

- give every row its own id, so one click does not select three

### Documentation

- describe what the app actually does now

## v0.6.0 — 2026-09-18

### Added

- add CLAUDE.md, rules, skills and subagents at both scopes
- show user rules and Desktop scheduled tasks

### Fixed

- gate a subagent's frontmatter the way settings.json is gated

## v0.5.0 — 2026-09-18

### Added

- hide projects whose directory is gone, without deleting anything

## v0.4.0 — 2026-09-18

### Added

- join what is declared against what is actually there
- list the configuration a project inherits from its parent directories

### Fixed

- say which directories were filtered out, not just how many
- let project files actually save, instead of refusing them as foreign

## v0.3.1 — 2026-09-18

### Fixed

- say "read-only" once per group, not once per band
- report settings.json's state even when no plugins are installed
- name what we write beside your files after this product

## v0.3.0 — 2026-09-18

### Added

- say which hooks can auto-approve and rewrite the command

### Fixed

- three presentation bugs the browser found and the tests did not
- list every declared hook, including the ones naming no script
- a registry it could not read no longer looks like having no projects
- saving a version twice no longer writes an identical twin
- run the component tests on Node 20, the version the package claims
- stop devDependency bumps publishing versions that change nothing
- remove the dead store my own idempotency fix introduced
- a duplicate workflow run no longer fails after a successful release

### Changed

- say "read-only" once per band instead of once per row

### Documentation

- record the hook-row, capability and version-id rules

## v0.2.0 — 2026-09-16

### Added

- React 19

## v0.1.1 — 2026-09-16

### Fixed

- stop npm rewriting the bin entry at publish time

## v0.1.0 — 2026-09-15

First published release.
