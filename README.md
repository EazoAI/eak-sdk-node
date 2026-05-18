# @eazo/eak

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6)](https://www.typescriptlang.org/)
[![Package manager](https://img.shields.io/badge/package%20manager-pnpm-f69220)](https://pnpm.io/)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Unified Node.js SDK for EAK Agent delegation, GUMem memory, and WebAgent automation.

`@eazo/eak` gives a server-side application one entry point for letting an Agent act on behalf of a user. Your application signs a delegation request with EAK AK/SK, receives a short-lived `delegateAgentToken`, and then uses that token for memory, web search, browser automation, and monitoring calls.

AK/SK credentials must stay on a trusted server. They must never be sent to browsers, mobile apps, public CLI config, or untrusted runtimes.

Read this in [Chinese](./README.zh-CN.md).

## Why EAK

Agents that perform real work need more than a backend API key. They need a user boundary, explicit scopes, short-lived authorization, streamable progress, and audit metadata that explains what happened later.

EAK keeps that model compact:

- One public SDK entry: `new EAK({ accessKey, secretKey, host })`.
- One gateway host: no GenAuth, GUMem, or WebAgent base URL setup for normal users.
- One business token: `delegateAgentToken` is used for downstream capability calls.
- Capability-first namespaces: `gumem`, `webSearch`, `doAnything`, and `track`.
- Scope bundles for quick starts, low-level scopes for production hardening.
- Typed errors with `requestId`, `traceId`, `auditId`, and `retryable`.

## Installation

```bash
pnpm add @eazo/eak
```

Requirements:

- Node.js 18 or later.
- A server-side runtime with `fetch`. Node.js 18 includes a global `fetch`.
- An EAK access key and secret key created in EAK Console.
- An EAK Gateway host such as `https://eak.eazo.ai` or your private deployment host.

## Quick Start

```ts
import { EAK, EAKEventTypes, EAKScopeBundles } from "@eazo/eak";

const eak = new EAK({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  host: process.env.EAK_HOST ?? "https://eak.eazo.ai",
});

const { data: delegation } = await eak.delegateAgent({
  userId: "user_1",
  agent: {
    id: "research-assistant",
    name: "Research Assistant",
  },
  mode: "silent",
  scopes: EAKScopeBundles.AGENT_DO_ANYTHING_BASIC,
});

const token = delegation.delegateAgentToken;

const memory = await eak.gumem.recall({
  token,
  sessionId: "default",
  query: "What should this assistant remember before researching the account?",
});

const run = await eak.doAnything.run<{ id: string; sessionId: string }>({
  token,
  instruction: "Open the target website and summarize the latest product changes.",
  stream: {
    events: [EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME],
  },
  tools: {
    gumem: { actions: ["recall"] },
  },
  context: {
    memory: memory.data,
  },
});

for await (const event of eak.doAnything.events({
  token,
  sessionId: run.data.sessionId,
  runId: run.data.id,
})) {
  if (event.event === EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME) {
    renderBrowserFrame(event.data);
  }
}
```

## Core Concepts

### EAK Gateway

`host` points to the EAK Gateway. The SDK sends delegation, GUMem, and WebAgent requests through that gateway. Application code should not configure separate GenAuth, GUMem, or WebAgent URLs for normal usage.

### Server-Side AK/SK

`accessKey` and `secretKey` identify the application or tenant boundary already configured in EAK Console. The SDK uses them only to sign trusted server-side delegation requests.

### Delegation Token

`delegateAgentToken` is the short-lived token that downstream capability calls use. It carries the authorized user, Agent, scopes, expiry, and audit context. Treat it as a sensitive bearer token.

### Scopes and Bundles

Scopes describe what the Agent is allowed to do. Bundles such as `EAKScopeBundles.AGENT_DO_ANYTHING_BASIC` make first integration easier, while `EAKScopes.*` lets production code request the smallest practical capability set.

## Authorization Flows

### Silent Delegation

Use silent delegation for low-risk actions that can be granted by policy.

```ts
import { EAK, EAKScopeBundles } from "@eazo/eak";

const eak = new EAK({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  host: process.env.EAK_HOST!,
});

const { data } = await eak.delegateAgent({
  userId: "user_1",
  agent: { id: "support-assistant", name: "Support Assistant" },
  mode: "silent",
  scopes: EAKScopeBundles.GUMEM_READONLY,
});

const token = data.delegateAgentToken;
```

### Interactive Delegation

Use interactive delegation for actions that require explicit user confirmation, such as browser takeover, site login, long-running monitoring, or access to sensitive artifacts.

```ts
import { EAKScopes } from "@eazo/eak";

const { data: delegation } = await eak.delegateAgent({
  userId: "user_1",
  agent: { id: "browser-agent", name: "Browser Agent" },
  mode: "interactive",
  redirectUri: "https://app.example.com/eak/callback",
  scopes: [
    EAKScopes.WEBAGENT_BROWSER_USE_TAKE_CONTROL,
    EAKScopes.WEBAGENT_SITE_LOGIN_REQUEST,
    EAKScopes.WEBAGENT_SITE_LOGIN_CONFIRM,
  ],
});

if ("authorizationUrl" in delegation) {
  await savePendingGrant({
    grantId: delegation.grantId,
    state: delegation.state,
  });
  redirectUser(delegation.authorizationUrl);
}

const { data: completed } = await eak.completeDelegateAgent({
  grantId: pendingGrant.grantId,
  code: callbackQuery.code,
  state: callbackQuery.state,
});

const token = completed.delegateAgentToken;
```

## Capability Examples

### GUMem

```ts
await eak.gumem.createSession({
  token,
  userId: "user_1",
  sessionId: "account-research",
  title: "Account research",
});

await eak.gumem.addMessages({
  token,
  sessionId: "account-research",
  messages: [
    {
      role: "user",
      content: "The customer prefers concise implementation checklists.",
    },
  ],
});

const context = await eak.gumem.recall({
  token,
  sessionId: "account-research",
  query: "What user preferences should the assistant keep in mind?",
  details: true,
});
```

### Web Search

```ts
const search = await eak.webSearch.run<{ id: string }>({
  token,
  query: "latest product updates from example.com",
});

for await (const event of eak.webSearch.events({
  token,
  runId: String(search.data.id),
})) {
  console.log(event.event, event.data);
}
```

### Do Anything

```ts
const run = await eak.doAnything.run({
  token,
  instruction: "Compare pricing pages and return the changed plans.",
  stream: {
    events: [
      EAKEventTypes.DO_ANYTHING_ACTION,
      EAKEventTypes.DO_ANYTHING_OBSERVATION,
      EAKEventTypes.DO_ANYTHING_FINAL,
    ],
  },
});
```

### Track

```ts
const monitor = await eak.track.createMonitor<{ id: string }>({
  token,
  name: "Pricing page monitor",
  target: "https://example.com/pricing",
  schedule: "0 9 * * 1",
});

await eak.track.runNow({
  token,
  monitorId: monitor.data.id,
});
```

## API Reference

### Client

```ts
const eak = new EAK({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  host: process.env.EAK_HOST!,
  timeoutMs: 30_000,
});
```

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `accessKey` | `string` | Yes | EAK access key from EAK Console. |
| `secretKey` | `string` | Yes | EAK secret key from EAK Console. |
| `host` | `string` | Yes | EAK Gateway host. |
| `fetch` | `typeof fetch` | No | Custom transport implementation. |
| `timeoutMs` | `number` | No | Request timeout. Defaults to `30000`. |

Older option aliases are accepted by the SDK for compatibility, but new code should use `accessKey`, `secretKey`, and `host`.

### Namespaces

| Namespace | Methods |
| --- | --- |
| Delegation | `delegateAgent`, `completeDelegateAgent` |
| GUMem | `createSession`, `addMessages`, `recall`, `uploadResource`, `actions.record`, `actions.recall`, `actions.stream` |
| Web Search | `run`, `get`, `refine`, `events`, `cancel` |
| Do Anything | `run`, `createSession`, `createRun`, `getRun`, `events`, `intervene`, `cancel`, `readArtifacts`, `readRecording` |
| Track | `createMonitor`, `getMonitor`, `updateMonitor`, `deleteMonitor`, `runNow`, `events` |

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

Streaming methods return `AsyncIterable<EAKEvent<T>>`.

```ts
type EAKEvent<T = unknown> = {
  id?: string;
  event?: string;
  data: T;
};
```

## Error Handling

All SDK errors inherit from `EAKError` and expose `code`, `status`, `requestId`, `traceId`, `auditId`, `retryable`, and the original response `body` when available.

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
    // Request a new delegateAgentToken with the missing scope.
  }

  if (error instanceof EAKRateLimitError || error instanceof EAKTimeoutError) {
    // Retry with backoff when your product flow allows it.
  }

  throw error;
}
```

## Security Notes

- Keep EAK AK/SK on trusted servers only.
- Do not expose `delegateAgentToken` to clients unless the client is explicitly part of the trusted execution boundary.
- Request the smallest useful scope set for each Agent action.
- Prefer `interactive` mode for high-risk scopes.
- Store `auditId`, `requestId`, and `traceId` with product logs when you need later investigation.
- Rotate AK/SK through EAK Console if a credential might have been exposed.

## Development

This repository is managed with pnpm.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Useful package checks:

```bash
pnpm pack --dry-run
```

## License

MIT
