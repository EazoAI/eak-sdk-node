# Changelog

All notable changes to `@eazo/eak` are documented in this file.

This project follows semantic versioning for published packages. Until `1.0.0`,
minor versions may include SDK API changes, and patch versions should remain
backward compatible.

## 0.1.0 - 2026-06-02

### Added

- Added `EzaoAgentKit` as the primary SDK constructor with `EAK` and
  `EazoAgentKit` compatibility aliases.
- Added runtime discovery through `GET /api/v3/eak/runtime-config`.
- Added `delegateToken` as the preferred delegation API.
- Added compatibility aliases for `delegateAgent` and `completeDelegateAgent`.
- Added GUMem, Web Search, Do Anything, Track, GenAuth, and EAK management
  namespaces.
- Added internal product-token exchange before GUMem and WebAgent product
  calls.
- Added typed SDK errors with request, trace, audit, and retry metadata.
- Added scope constants, scope bundles, and event constants.
- Added English and Chinese README files.
