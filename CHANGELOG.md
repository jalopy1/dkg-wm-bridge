# Changelog

All notable changes to dkg-wm-bridge are documented here.

## [0.1.4] — 2026-04-27

### Added
- `query` command — search and list artifacts with filters (`--kind`, `--sensitivity`, `--limit`, `--format json`)
- Inter-artifact relationships: `--derived-from` and `--revision-of` flags (prov:wasDerivedFrom, prov:wasRevisionOf)
- Query result deduplication (multi-tag artifacts no longer produce duplicate rows)

### Security
- SPARQL injection protection: proper literal escaping in query builder
- Assertion name validation for relationship URIs (alphanumeric + hyphens/underscores/dots, max 255 chars)
- Kind/sensitivity allowlist validation in queries
- Limit clamped to 1-1000
- Input validation: reject empty files, device files, empty title/text, invalid formats

### Fixed
- Scanner "token" pattern narrowed to reduce false positives on normal prose
- Empty `--derived-from` strings filtered out

## [0.1.3] — 2026-04-27

### Added
- `--sensitivity` flag (public/shareable/personal/secret) for artifact classification
- `--scan` flag for automatic PII/secret detection before ingesting
- Promotion guard — refuses to promote personal/secret artifacts
- `wmbo:sensitivity` triple in provenance quads
- Scanner module (`scanContent`, `redactContent`) — detects 6 secret patterns + 4 PII patterns
- Audit logging to `~/.dkg/audit.log` for all ingest/promote operations

### Security
- Promotion guard warns on sensitivity check failure (no silent bypass)
- Audit log sanitizes inputs against injection (strips control chars, 200-char cap)

## [0.1.2] — 2026-04-26

### Added
- SHA-256 content hash (`schema:sha256`) in provenance quads
- Agent wallet address in provenance (`schema:identifier`)
- Dynamic `encodingFormat` from detected content type (was hardcoded to text/markdown)

### Fixed
- `integration.json` removed invalid `envOptional` field (schema violation)
- `loadToken()` ENOENT handling — clear error message for missing auth.token
- Status transitions now functional — `promote` updates status to "promoted"

### Tests
- Expanded from 15 to 78 tests (rdf, ingest, dkg-client)

## [0.1.1] — 2026-04-26

### Added
- GitHub Actions workflow for `npm publish --provenance`
- Build provenance attestation on npm package

## [0.1.0] — 2026-04-26

### Initial release
- CLI tool: `init`, `ingest`, `ingest-text`, `promote`, `discard`, `status`, `info`, `check`
- DKG v10 Working Memory integration via HTTP API
- PROV-O + schema.org provenance metadata
- Markdown chunking for large files
- Trust gradient status tags (draft → reviewed → promote-ready → promoted → verified-ready)
- Zero runtime dependencies
- Published to npm as `dkg-wm-bridge`
