# Changelog

All notable changes to `@eazo/eak` are documented in this file.

This project follows semantic versioning. Before `1.0.0`, minor versions may
include SDK API changes, while patch versions are reserved for backward
compatible fixes.

## 0.1.0 - 2026-06-02

Initial public release of `@eazo/eak`.

### What ships

- Server-side `EzaoAgentKit` constructor for EAK Agent delegation and product
  runtime calls.
- Runtime service discovery from the EAK Console gateway through
  `GET /api/v3/eak/runtime-config`.
- One-step `delegateToken` flow for binding a GenAuth user, Agent identity,
  scope list, expiry, and audit metadata.
- Automatic product-token exchange before GUMem and WebAgent runtime requests,
  so integrations can pass the delegation token returned by `delegateToken`.
- Capability namespaces for `eak`, `genauth`, `gumem`, `webSearch`,
  `doAnything`, and `track`.
- Typed SDK errors with request, trace, audit, retry, service, and HTTP status
  metadata.
- Exported scope constants, scope bundles, and event constants for common Agent
  workflows.
- English and Chinese README files, open-source repository metadata, examples,
  and readiness checks.

### Compatibility

- `EAK` and `EazoAgentKit` remain available as constructor aliases.
- `delegateAgent` and `completeDelegateAgent` remain available as deprecated
  aliases for older integrations, but new integrations should use
  `delegateToken`.
