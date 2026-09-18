# Changelog

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
