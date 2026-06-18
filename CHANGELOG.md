# Changelog

All notable changes to `@eazo/eak` are documented in this file.

This project follows semantic versioning. Before `1.0.0`, minor versions may
include SDK API changes, while patch versions are reserved for backward
compatible fixes.

## Unreleased

## 0.3.0 - 2026-06-18

Semantic-layer public surface per the frozen contract. **Breaking** — the
WebAgent product namespaces are reorganized around handles; the 1:1 wire
methods moved (no compatibility aliases).

### Breaking

- `doAnything.run` / `webSearch.run` / `deepResearch.run` now return a
  `RunHandle` (`id`, `sessionRef`, `status()`, `events()`, `wait()`,
  `respond()`, idempotent `cancel()`) instead of a wire envelope.
  `attach(runId, { token })` reconnects to an existing run (doAnything
  additionally needs `session`). `doAnything.runAndWait` is replaced by
  `run()` + `wait()`.
- `track.createMonitor/getMonitor/updateMonitor/deleteMonitor/runNow/events`
  are replaced by `track.create` / `track.attach` returning a `MonitorHandle`
  (`get()`, `update()`, `runNow()`, `events()`, `respond()`, `runs()`,
  `run(runId)`, `delete()`). Monitor HITL answers (`respond`) and tick-run
  read views (`runs` / `run`) are newly exposed.
- The 1:1 wire-level methods moved to `eak.<product>.api.*` (e.g.
  `eak.doAnything.api.createSession`, `eak.deepResearch.api.followUp`); their
  shapes may evolve with the API and are no longer the documented mainline.
- Handle event streams yield semantic `RunEvent`s (`type` / `runId` / `at` /
  `isTerminal` / camelCase `data` / `raw`), end automatically at the terminal
  event, and decode screenshot data URIs to `event.image.bytes`. The
  `capture: { screenshots, videoFrames }` switch replaces hand-built
  `stream.events` subscriptions; core events are always subscribed.
- `delegateToken`: `agent` is optional (default `"sdk"`), `products` sugar
  expands to per-product scope sets, and scope strings are validated locally —
  malformed scopes throw `EAKValidationError` before any request.

### Added

- `result.artifacts` on `wait()` results — deepResearch deliverables with lazy
  `content()` byte downloads; empty for other products.
- Server permission errors now append the known scope set to the message.

## 0.2.0 - 2026-06-10

Run-event handling now matches the live WebAgent backend, plus resilient
streaming. **Breaking** — see below.

### Breaking

- `EAKEventTypes` now holds the real backend wire event names (`run.*`, e.g.
  `RUN_COMPLETED = "run.completed"`, `RUN_ACTION_STARTED`, `RUN_INPUT_REQUEST`,
  `RUN_BROWSER_LIVE_URL_CHANGED`), replacing the previous placeholder constants
  (`DO_ANYTHING_FINAL = "final"`, `DO_ANYTHING_ACTION = "action"`, …) that never
  matched a real run stream. Match `event.event` against the new constants;
  `RUN_COMPLETED` is the terminal event.

### Fixed

- `doAnything.events()` (and the other product `events()` iterators) now surface
  the wire event type on `event.event`. Backend run frames carry no SSE `event:`
  line — the type lives in the envelope's `type` field — so `event.event` was
  previously always `undefined`. The envelope still rides on `event.data`
  (`event.data.data` is the payload; `event.data.task_id` identifies the run).
- `doAnything.run()` returns a typed `DoAnythingRunResult` with canonical
  snake_case `run_id` / `session_id` (no more `id` / `sessionId` guessing).

### Added

- Automatic SSE reconnect: `events()` resumes a dropped stream from the last
  event id (network / 5xx). Configure with the `sseMaxRetries` client option
  (default 5, `0` disables). User aborts and terminal 4xx are never retried.
  Each reconnect re-resolves the product token, so a long stream survives token
  expiry — a `401` on reconnect is treated as retryable and recovered with a
  fresh token instead of throwing.
- `doAnything.events({ onlyTopLevel: true })` drops internal sub-run events
  (matched on `event.data.task_id`) and yields only the addressed run's events.
- `doAnything.runAndWait` gains an `onCostUpdate` hook (live `run.cost_update`),
  filters to the top-level run, and settles from the `getRun` envelope so
  `result.raw` always carries `total_cost_usd` / `step_count` / token counts
  (the `run.completed` event payload omits them).
- `doAnything.runAndWait({ instruction, onAction, onScreenshot, onInputRequest,
  timeoutMs, signal, ... })` — high-level helper that starts a run, drives its
  event stream to a terminal state, and resolves a settled
  `{ status, output, terminalReason, isTaskSuccessful, runId, sessionId }`.
  Falls back to `getRun` if the stream closes without a terminal event.
- `eak.resolveAnyBoundUser()` — returns a real user id from the credential-bound
  GenAuth userpool, for demos / smoke tests that need a `userId` for silent
  `delegateToken` without hardcoding one.
- Onboarding hints: errors for `eak.delegation.user_not_bound` and
  `eak.genauth.userpool_binding_missing` now append a one-line, actionable hint
  to the message (e.g. pointing at `resolveAnyBoundUser` / `currentUser`).
- `EAKError.code` is now typed as `EAKErrorCode` — a union of the known SDK /
  backend codes plus `(string & {})` — so you get literal autocomplete and can
  write an exhaustive `switch (err.code)` while still tolerating new backend
  codes. Exported as `EAKErrorCode`.

## 0.1.0 - 2026-06-02

Initial public release of `@eazo/eak`.

### What ships

- Server-side `EazoAgentKit` constructor for EAK Agent delegation and product
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

- `EAK` remains available as a short constructor alias.
- `delegateAgent` and `completeDelegateAgent` remain available as deprecated
  aliases for older integrations, but new integrations should use
  `delegateToken`.
