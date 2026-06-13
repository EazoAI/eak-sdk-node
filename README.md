# @eazo/eak

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6)](https://www.typescriptlang.org/)
[![Package manager](https://img.shields.io/badge/package%20manager-pnpm-f69220)](https://pnpm.io/)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Unified Node.js SDK for EAK Agent delegation, GenAuth user management, GUMem memory, WebAgent automation, web search, and monitoring.

`@eazo/eak` gives a trusted server one compact way to use EAK AK/SK. For runtime product calls, your service verifies the GenAuth user, requests short-lived delegation with `delegateToken`, and then uses the returned token in GUMem, WebAgent, Do Anything, Web Search, and Track calls. For GenAuth user management, the SDK exchanges AK/SK for a standard GenAuth management token internally and calls GenAuth v3 users APIs with that token.

AK/SK credentials must stay on a trusted server. Do not ship them to browsers, mobile apps, public CLI config, or untrusted Agent runtimes.

English | [中文](./README.zh-CN.md)

## Why EAK

Agents that perform real work need more than a backend API key. They need a user boundary, explicit scopes, expiry, observable execution, and audit metadata that explains what happened later.

EAK keeps that model small:

- One SDK entry: `new EazoAgentKit({ accessKey, secretKey })`.
- One discovery path: `host` can override the EAK Console/SDK gateway for private or local deployments, and the SDK reads downstream runtime URLs from `/api/v3/eak/runtime-config`.
- One delegation entry: call `delegateToken`; silent mode returns `data.token`, while interactive mode returns an authorization URL and later completes on your server.
- One management path: call `genauth.users.*`, and the SDK exchanges AK/SK for a GenAuth management token before calling GenAuth v3 users APIs.
- Capability-first namespaces: `genauth`, `gumem`, `webSearch`, `doAnything`, and `track`.
- Readable scope strings for least-privilege authorization.
- Typed errors with `requestId`, `traceId`, `auditId`, and `retryable`.

## Installation

```bash
npm install @eazo/eak
# or
pnpm add @eazo/eak
# or
yarn add @eazo/eak
```

Requirements:

- Node.js 18 or later.
- A server-side runtime with `fetch`.
- EAK `accessKey` and `secretKey` created in EAK Console.
- For silent runtime product calls, a real GenAuth user id from the userpool bound to the EAK credential. For smoke tests, pass it as `EAK_USER_ID` or call `eak.resolveAnyBoundUser()` to grab the first bound user; in application code, resolve it with `currentUser` or your existing server-side user session. Interactive delegation can start without `user` or `userId` because the EAK Console/BFF resolves the GenAuth login during authorization.
- For `genauth.users.*` management calls, `EAK_USER_ID` is not required. The SDK uses AK/SK to request a GenAuth management token from EAK.
- Optional `host` for private or local EAK deployments. Leave it unset for hosted EAK.

You do not pass `tenantId` during normal SDK initialization. The AK/SK is already bound to the tenant and application boundary in EAK.

## AI Skill

EAK can also be exposed to AI coding tools through a Skill package, so Codex, Claude Code, or internal Agents can follow the same authorization model.

Install the EAK Skill:

```bash
npx skills add https://github.com/EazoAI/eak-sdk-node --skill eak-sdk
```

If you only want to install it for Claude Code, specify the Agent:

```bash
npx skills add https://github.com/EazoAI/eak-sdk-node --agent claude-code --skill eak-sdk
```

The npm package includes the `skills/` directory, but the recommended Skill install path is still the GitHub repository command above so agents receive the repository-local skill metadata.

## Quick Start

Start with a server-side SDK instance. AK/SK stays on your trusted server for both management-plane calls and runtime product delegation.

```ts
import fs from "node:fs";
import { EazoAgentKit } from "@eazo/eak";

const eak = new EazoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
});
```

### GenAuth User Management

`genauth.users.*` is a management-plane capability. It does not need `EAK_USER_ID` or `delegateToken`; the SDK signs `POST /api/v3/eak/genauth/admin-token` with `{}` internally, receives a GenAuth management token plus `userPoolId`, and then calls GenAuth v3 users APIs.

```ts
const users = await eak.genauth.users.list({
  page: 1,
  limit: 20,
});

console.log("GenAuth users:", users.data);

const created = await eak.genauth.users.create<{ userId: string }>({
  username: `sdk-demo-${Date.now()}`,
  password: process.env.GENAUTH_DEMO_USER_PASSWORD!,
});

const profile = await eak.genauth.users.get<{ userId: string }>({
  userId: created.data.userId,
});

await eak.genauth.users.update({
  userId: profile.data.userId,
  nickname: "SDK demo user",
});

// Optional smoke-test cleanup:
// await eak.genauth.users.deleteBatch({ userIds: [profile.data.userId] });
```

### Runtime Product Delegation

GUMem, WebAgent, Do Anything, Web Search, and Track act for an end user. Silent delegation calls need a real GenAuth user id from the userpool bound to the EAK credential, then a `delegateToken` result.

```ts
const userId = process.env.EAK_USER_ID!;
if (!userId) {
  throw new Error("EAK_USER_ID must be a real GenAuth user id from the credential-bound userpool");
}

// `products` is per-product authorization sugar; `agent` defaults to "sdk".
const { token } = (
  await eak.delegateToken({
    user: { subject: userId },
    products: ["doAnything"],
  })
).data;

const run = await eak.doAnything.run({
  token, // passed once — the handle holds it; handle methods never take a token
  instruction: "Open the customer website and summarize recent product updates.",
  capture: { screenshots: true },
});

const result = await run.wait({
  onScreenshot: (img, i) => fs.writeFileSync(`step-${i}.jpg`, img.bytes),
  onInputRequest: (req) => openForUser(req.liveUrl), // login / confirm handoff
});
console.log(result.output);
```

`run()` returns a `RunHandle`. Core events (status, actions, input requests, completion) are always streamed; `capture: { screenshots: true }` opts into per-step screenshots, decoded to bytes for you. `wait()` drives the run to its terminal state and settles the result from the canonical run envelope (`result.raw` carries costs, step counts, and token usage).

For step-by-step control, consume the semantic event stream directly:

```ts
for await (const event of run.events()) {
  // event.type: "status" | "action" | "screenshot" | "inputRequest"
  //           | "message" | "cost" | "progress" | "completed" | "failed"
  // event.runId / event.at / event.isTerminal / event.data (flat camelCase)
  // event.raw — the original wire event, if you need it
  if (event.type === "inputRequest") {
    await openForUser(event.data.liveUrl);
    await run.respond(String(event.data.requestId), "done — continue");
    // run.respond(requestId) with no response skips the request instead
  }
}
// The iterator ends automatically at the terminal event.

await run.cancel("user stopped the task"); // idempotent — safe on a finished run
const followUp = await eak.doAnything.run({
  token,
  instruction: "Now check the pricing page too.",
  session: run.sessionRef, // reuse the same browser session
});
const reattached = await eak.doAnything.attach(run.id, { token }); // re-attach by run id alone
```

## Authorization Model

### Runtime Discovery

`host` points to the EAK Console/SDK gateway, not directly to GenAuth, GUMem, or WebAgent. Hosted integrations normally leave `host` unset; private and local deployments can pass their own gateway.

The SDK signs a request to:

```text
GET /api/v3/eak/runtime-config
```

The response provides runtime base URLs for EAK, GenAuth, GUMem, and WebAgent. Application code should not configure those product URLs separately for normal usage.

### Server-Side AK/SK

`accessKey` and `secretKey` identify the tenant and application boundary configured in EAK Console. The SDK uses them to sign trusted server-side EAK requests, including delegation and product-token exchange.

### Delegation Token

In silent mode, `delegateToken` binds four things:

- the current user id
- the Agent id
- the requested scopes
- the token expiry and audit context

Silent product calls receive `token: delegation.data.token`. If that token is an EAK delegation token, the SDK exchanges it internally for the correct GUMem or WebAgent product access token before calling the downstream service.

```ts
const delegation = await eak.delegateToken({
  userId,
  agent: "research-assistant",
  scopes: ["gumem.memory:read"],
  mode: "silent",
});

await eak.gumem.recall({
  token: delegation.data.token,
  query: "research preferences",
});
```

In interactive mode, your server still starts with `delegateToken`, but it does not receive a token:

```ts
const grant = await eak.delegateToken({
  mode: "interactive",
  redirectUri: "https://app.example.com/eak/callback",
  state: "business-csrf-state",
  agent: "research-assistant",
  scopes: ["gumem.memory:read", "webagent.do_anything:manage"],
});

redirectUserTo(grant.data.authorizationUrl);
```

The user visits `authorizationUrl` in EAK Console/BFF. If they are not logged in, Console/BFF sends them through GenAuth login, confirms authorization, completes the grant internally, then redirects back to your `redirectUri` with a one-time `code`, your `state`, and `grant_state`/`grantId`. The browser never receives a delegation token.

Your callback handler runs on the server and exchanges the callback fields with AK/SK:

```ts
const completed = await eak.completeDelegateToken({
  grantId: String(req.query.grantId ?? req.query.grant_id),
  code: String(req.query.code),
  state: String(req.query.state),
});

await eak.gumem.recall({
  token: completed.data.token,
  query: "research preferences",
});
```

`completeDelegateToken` is the recommended server callback helper. `delegateAgent` and `completeDelegateAgent` remain as deprecated compatibility names, but the current callback contract is `{ grantId, code, state }`; old `{ code, state }` completion is not supported.

## Choosing Scopes

Each WebAgent product exposes exactly two scopes: `read` (observe — status, events, artifacts) and `manage` (anything that changes execution state — run, cancel, respond, messages, monitor CRUD). The full set is the 8 scopes `webagent.{do_anything, web_search, deep_research, track}:{read, manage}`. The simplest authorization is the `products` sugar — each product name expands to its `read` + `manage` pair:

```ts
await eak.delegateToken({
  user: { subject: userId },
  products: ["doAnything", "webSearch", "deepResearch", "track"],
  scopes: ["gumem.memory:read"], // fine-grained scopes can be mixed in
});
```

Scope strings are validated locally before any request: a scope missing its service prefix (e.g. `do_anything:manage` instead of `webagent.do_anything:manage`) throws `EAKValidationError` immediately with the correct form in the message.

Use explicit scope strings when the requested permission boundary should be visible in code.

| Scenario | Useful scopes | User-facing meaning |
| --- | --- | --- |
| Read user memory | `gumem.memory:read` | Agent can read relevant historical preferences. |
| Create a GUMem session and recall context | `gumem.memory:read`, `gumem.memory:write`, `gumem.message:write` | Agent can create a memory session, write messages, and recall context for the current user. |
| Write task results | `gumem.message:write`, `gumem.action:write` | Agent can write this task's confirmed result back to GUMem. |
| Search public web | `webagent.web_search:read`, `webagent.web_search:manage` | Agent can search public pages and read search results. |
| Run a bounded web task | `webagent.do_anything:read`, `webagent.do_anything:manage` | Agent can run a visible web task, read progress, stop it, and intervene when needed. |
| Create a monitor | `webagent.track:read`, `webagent.track:manage` | Agent can configure monitors, read events, run checks, and stop monitors. |

Silent mode is usually appropriate for low-risk actions such as reading current-user memory, writing a confirmed summary, or searching public web pages.

Interactive mode is recommended for higher-risk actions such as browser takeover, external site login, long-running monitoring, form submission, or access to sensitive artifacts and recordings.

The SDK also exports a GUMem-oriented bundle for the common session/write/recall path:

```ts
EAKScopeBundles.GUMEM_SESSION_RECALL
```

## Capability Examples

### GUMem

```ts
await eak.gumem.createSession({
  token,
  userId,
  sessionId: "daily-assistant",
  title: "Daily assistant memory",
});

// Your application has already collected and confirmed this preference with the user.
const confirmedPreference =
  "Please keep daily planning suggestions concise and include only the next action.";

await eak.gumem.addMessages({
  token,
  sessionId: "daily-assistant",
  messages: [
    {
      role: "user",
      content: confirmedPreference,
    },
    {
      role: "assistant",
      content: `Saved confirmed user preference: ${confirmedPreference}`,
    },
  ],
});

const context = await eak.gumem.recall({
  token,
  sessionId: "daily-assistant",
  query: "What confirmed preferences should I consider for this user's next task?",
  details: true,
});

// Pass context.data into your own assistant response composer or task planner.
// The SDK example stops here because application orchestration is product-specific.
```

### Do Anything

```ts
const run = await eak.doAnything.run({
  token,
  instruction: "Open the user's selected product page and summarize updates relevant to their current task.",
});

const status = await run.status(); // refresh the run's current state
await run.cancel("User stopped the task"); // idempotent
```

### Web Search

```ts
const search = await eak.webSearch.run({
  token,
  query: "product update notes relevant to the user's current task",
  maxResultsPerQuery: 5,
});

const result = await search.wait();
console.log(result.output); // search results
```

### Deep Research

```ts
const research = await eak.deepResearch.run({
  token,
  topic: "State of EU battery recycling, 2026 update",
  depth: "standard", // light | standard | deep — the main research knob
  limits: { maxDurationMinutes: 120 }, // wall-clock cap; the run self-terminates past it
});

const report = await research.wait();
for (const artifact of report.artifacts) {
  fs.writeFileSync(artifact.name ?? artifact.id, await artifact.content());
}

// Follow-up research that inherits the prior run's context:
const followUp = await eak.deepResearch.run({
  token,
  topic: "Now compare against the 2025 numbers.",
  session: research.sessionRef,
});
```

### Track

```ts
const monitor = await eak.track.create({
  token,
  name: "Pricing page monitor",
  target: "https://example.com/pricing",
  schedule: "0 9 * * 1",
});

await monitor.runNow();
const ticks = await monitor.runs({ limit: 10 }); // read-only tick run views
await monitor.respond("req_1", "logged back in"); // unlock a HITL park
await monitor.update({ schedule: "0 9 * * *" });
await monitor.delete();

// Reconnect later from a stored id:
const sameMonitor = await eak.track.attach(monitor.id, { token });
```

### GenAuth User Context and Management

```ts
const client = new EazoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
});

const profile = await client.genauth.userInfo({
  accessToken: process.env.GENAUTH_ACCESS_TOKEN!,
});

const users = await client.genauth.users.list({
  page: 1,
  limit: 20,
});

const created = await client.genauth.users.create({
  username: "sdk-demo-user",
  password: process.env.GENAUTH_DEMO_USER_PASSWORD!,
});
```

`currentUser` and `genauth.userInfo` use a GenAuth access token because they read the logged-in user's identity. `genauth.users.*` is a management-plane capability, but application code still authenticates the SDK with EAK AK/SK: the SDK signs `POST /api/v3/eak/genauth/admin-token` with an empty JSON body `{}`, receives a standard GenAuth management token plus `userPoolId`, then calls GenAuth v3 user management APIs with `Authorization: Bearer ...` and `x-authing-userpool-id`. It does not send `resource`, `actions`, `expiresIn`, or `EAK_USER_ID`. Runtime capability calls such as GUMem/WebAgent use `delegateToken` output instead.

## API Surface

### Client

```ts
const eak = new EazoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  timeoutMs: 30_000,
});
```

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `accessKey` | `string` | Yes | EAK access key from EAK Console. |
| `secretKey` | `string` | Yes | EAK secret key from EAK Console. |
| `host` | `string` | No | Optional EAK Console/SDK gateway override for private or local deployments. |
| `fetch` | `typeof fetch` | No | Custom transport implementation. |
| `timeoutMs` | `number` | No | Request timeout. Defaults to `30000`. |

`EAK` is also exported as a short alias:

```ts
import { EAK, EazoAgentKit } from "@eazo/eak";
```

### Namespaces

| Namespace | Methods |
| --- | --- |
| Delegation | `delegateToken`, `completeDelegateToken`, deprecated aliases `delegateAgent`, `completeDelegateAgent` |
| GenAuth | `userInfo`, `jwks`, `discovery`, `introspectDelegationToken`, `users.list`, `users.get`, `users.getBatch`, `users.create`, `users.createBatch`, `users.update`, `users.deleteBatch` |
| GUMem | `createSession`, `addMessages`, `recall`, `uploadResource`, `actions.record`, `actions.recall`, `actions.stream` |
| Do Anything | `run`, `attach` → `RunHandle` |
| Deep Research | `run`, `attach` → `RunHandle` |
| Web Search | `run`, `attach` → `RunHandle` |
| Track | `create`, `attach` → `MonitorHandle` |

The three run products share one handle shape:

```ts
run.id
run.sessionRef                          // pass back to run({ session }) to reuse the session
await run.status()                      // refresh and return the current state
run.events(opts?)                       // AsyncIterable<RunEvent>, ends at the terminal event
await run.wait({ timeoutMs?, onEvent?, onInputRequest?, onScreenshot? })
await run.respond(requestId, response?) // HITL answer; omit response to skip
await run.cancel(reason?)               // idempotent
```

`MonitorHandle` (Track) exposes `id`, `get()`, `update()`, `runNow()`, `events()`, `respond()`, `runs()`, `run(runId)`, and `delete()`.

### Wire-Level Escape Hatch

The 1:1 low-level methods live under `eak.<product>.api.*` (e.g. `eak.doAnything.api.createSession`, `eak.deepResearch.api.followUp`, `eak.track.api.createMonitor`), together with `EAKEventTypes` and `event.raw` on semantic events. These mirror the backend HTTP contract directly — snake_case fields, double-envelope events, single-ID `/{product}/runs/{run_id}` addressing for run operations — and their shapes may evolve with the API. They are not part of the frozen public contract.

Browser Use and Site Login scopes are reserved until their product runtime SDK methods are exported.

### Response Shape

Most SDK methods return:

```ts
type EAKResponse<T> = {
  data: T;
  meta: {
    requestId?: string;
    traceId?: string;
    auditId?: string;
    service?: "eak" | "genauth" | "gumem" | "webagent";
  };
};
```

Handle event streams (`run.events()`, `monitor.events()`) yield semantic `RunEvent` objects:

```ts
type RunEvent = {
  type:
    | "status" | "action" | "screenshot" | "inputRequest"
    | "message" | "cost" | "progress" | "completed" | "failed";
  runId: string;
  at: string;          // ISO 8601
  isTerminal: boolean; // true for completed / failed
  data: JsonObject;    // flat, camelCase, narrowed by type
  image?: { bytes: Uint8Array; mime: string; pageUrl?: string; step?: number }; // screenshot events
  raw: EAKEvent;       // original wire event (escape hatch)
};
```

Dropped connections reconnect automatically with `Last-Event-ID` catch-up; the iterator ends at the run's terminal event.

Wire-level streaming methods (`eak.<product>.api.events`) return `AsyncIterable<EAKEvent<T>>`:

```ts
type EAKEvent<T = unknown> = {
  id?: string;
  event?: string;
  data: T;
};
```

## Error Handling

All SDK errors inherit from `EAKError` and expose `code`, `status`, `requestId`, `traceId`, `auditId`, `retryable`, and the original response `body` when available. `code` is typed as `EAKErrorCode` (the known SDK / backend codes plus `(string & {})`), so you get literal autocomplete and can `switch (err.code)` over the known set while still tolerating new backend codes.

```ts
import {
  EAKPermissionDeniedError,
  EAKRateLimitError,
  EAKTimeoutError,
} from "@eazo/eak";

try {
  await eak.webSearch.run({ token, query: "EAK SDK" });
} catch (error) {
  if (error instanceof EAKPermissionDeniedError) {
    // Request a new delegated token with the missing scope.
  }

  if (error instanceof EAKRateLimitError || error instanceof EAKTimeoutError) {
    // Retry with backoff when your product flow allows it.
  }

  throw error;
}
```

Common first-run errors:

| Error | Meaning | Next step |
| --- | --- | --- |
| `agent must be a string` | The online delegation API currently expects `agent` to be a string id. | Pass `agent: "memory-agent"` rather than an object. |
| `eak.delegation.user_not_bound` | The `userId` is not in the GenAuth userpool bound to this EAK credential. | Use a real user id from `currentUser` or from the same bound userpool. |
| `eak.genauth.userpool_binding_missing` | The AK/SK is not bound to a GenAuth userpool, so `genauth.users.*` cannot obtain a management token. | Bind the EAK credential to the target GenAuth userpool before calling user management APIs. |
| `eak.genauth.userpool_owner_missing` | The bound GenAuth userpool has no resolvable owner user for management-token signing. | Fix the GenAuth userpool owner data or binding. |
| `eak.token_exchange.upstream_failed` with `unauthorized_client` or `grant_type is not enabled` | Delegation succeeded, but the managed delegation app is missing token-exchange grant support or has drifted from the tenant binding. | Repair the managed delegation app binding before calling GUMem or WebAgent product capabilities. |
| `delegation.required` | A GUMem/WebAgent call was made without `token`. | Pass `delegation.data.token` to the product namespace call. |
| `direct delegation token deprecated` | Application code is calling a product service directly with an EAK delegation token. | Call the product through the SDK so token exchange is handled internally. |

## Security Notes

- Keep EAK AK/SK on trusted servers only.
- Do not expose delegation tokens to untrusted clients.
- Request the smallest useful scope set for each Agent action.
- Prefer `interactive` mode for browser control, site login, long-running monitors, and sensitive artifacts.
- Store `auditId`, `requestId`, and `traceId` with product logs when later investigation matters.
- Rotate AK/SK through EAK Console if a credential might have been exposed.

## License

MIT
