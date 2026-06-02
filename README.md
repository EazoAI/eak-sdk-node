# @eazo/eak

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6)](https://www.typescriptlang.org/)
[![Package manager](https://img.shields.io/badge/package%20manager-pnpm-f69220)](https://pnpm.io/)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Unified Node.js SDK for EAK Agent delegation, GUMem memory, WebAgent automation, web search, and monitoring.

`@eazo/eak` gives a trusted server one compact way to let an Agent act for a GenAuth user. Your service verifies the user, requests short-lived delegation with `delegateToken`, and then uses the returned token in GUMem, WebAgent, Web Search, Do Anything, and Track calls. The SDK discovers runtime services and exchanges delegation tokens for product tokens internally.

AK/SK credentials must stay on a trusted server. Do not ship them to browsers, mobile apps, public CLI config, or untrusted Agent runtimes.

Read this in [Chinese](./README.zh-CN.md).

## Why EAK

Agents that perform real work need more than a backend API key. They need a user boundary, explicit scopes, expiry, observable execution, and audit metadata that explains what happened later.

EAK keeps that model small:

- One SDK entry: `new EzaoAgentKit({ accessKey, secretKey })`.
- One discovery host: `host` points to the EAK Console/SDK gateway, defaults to `https://eak.eazo.ai/dashboard`, and the SDK reads downstream runtime URLs from `/api/v3/eak/runtime-config`.
- One delegation step: call `delegateToken`, then pass `data.token` to product capability calls.
- Capability-first namespaces: `eak`, `genauth`, `gumem`, `webSearch`, `doAnything`, and `track`.
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
- EAK `accessKey` and `secretKey` created in EAK Console at `https://eak.eazo.ai/dashboard`.
- Optional `host` for private or local EAK deployments. It defaults to `https://eak.eazo.ai/dashboard`.

You do not pass `tenantId` during normal SDK initialization. The AK/SK is already bound to the tenant and application boundary in EAK.

## AI Skill

EAK can also be exposed to AI coding tools through a Skill package, so Codex, Claude Code, or internal Agents can follow the same authorization model.

Install the EAK Skill:

```bash
npx skills add https://github.com/eazo-ai/eak --skill eak
```

If you only want to install it for Claude Code, specify the Agent:

```bash
npx skills add https://github.com/eazo-ai/eak --agent claude-code --skill eak
```

## Quick Start

```ts
import { EzaoAgentKit, EAKEventTypes } from "@eazo/eak";

const eak = new EzaoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
});

const delegation = await eak.delegateToken({
  userId: "user_1",
  agent: "sales-assistant",
  scopes: [
    "gumem.memory:read",
    "gumem.message:write",
    "webagent.web_search:run",
    "webagent.web_search:read",
    "webagent.do_anything:session",
    "webagent.do_anything:run",
    "webagent.do_anything:events",
  ],
  mode: "silent",
});

const token = delegation.data.token;

const memory = await eak.gumem.recall({
  token,
  sessionId: "customer-brief",
  query: "What user preferences should the assistant remember?",
});

const run = await eak.doAnything.run<{ id: string; sessionId: string }>({
  token,
  instruction: "Open the customer website and summarize recent product updates.",
  stream: {
    events: [
      EAKEventTypes.DO_ANYTHING_ACTION,
      EAKEventTypes.DO_ANYTHING_OBSERVATION,
      EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME,
      EAKEventTypes.DO_ANYTHING_USER_ACTION_REQUIRED,
      EAKEventTypes.DO_ANYTHING_FINAL,
    ],
  },
  context: { memory: memory.data },
});

for await (const event of eak.doAnything.events({
  token,
  sessionId: run.data.sessionId,
  runId: run.data.id,
})) {
  if (event.event === EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME) {
    renderBrowserFrame(event.data);
  }

  if (event.event === EAKEventTypes.DO_ANYTHING_USER_ACTION_REQUIRED) {
    await showUserConfirmation(event.data);
  }
}
```

## Authorization Model

### Runtime Discovery

`host` points to the EAK Console/SDK gateway, not directly to GenAuth, GUMem, or WebAgent. If you do not pass `host`, the SDK uses the online EAK Console gateway by default:

```text
https://eak.eazo.ai/dashboard
```

The SDK signs a request to:

```text
GET /api/v3/eak/runtime-config
```

The response provides runtime base URLs for EAK, GenAuth, GUMem, and WebAgent. Application code should not configure those product URLs separately for normal usage.

### Server-Side AK/SK

`accessKey` and `secretKey` identify the tenant and application boundary configured in EAK Console. The SDK uses them to sign trusted server-side EAK requests, including delegation and product-token exchange.

### Delegation Token

`delegateToken` binds four things:

- the current user id
- the Agent id
- the requested scopes
- the token expiry and audit context

Product calls receive `token: delegation.data.token`. If that token is an EAK delegation token, the SDK exchanges it internally for the correct GUMem or WebAgent product access token before calling the downstream service.

```ts
const delegation = await eak.delegateToken({
  userId: "user_1",
  agent: "research-assistant",
  scopes: ["gumem.memory:read"],
  mode: "silent",
});

await eak.gumem.recall({
  token: delegation.data.token,
  query: "research preferences",
});
```

`delegateAgent` and `completeDelegateAgent` remain as deprecated compatibility aliases for older interactive flows. New integrations should start with `delegateToken`.

## Choosing Scopes

Use explicit scope strings so the requested permission boundary is visible in code.

| Scenario | Useful scopes | User-facing meaning |
| --- | --- | --- |
| Read user memory | `gumem.memory:read` | Agent can read relevant historical preferences. |
| Write task results | `gumem.message:write`, `gumem.action:write` | Agent can write this task's confirmed result back to GUMem. |
| Search public web | `webagent.web_search:run`, `webagent.web_search:read` | Agent can search public pages and read search results. |
| Run a bounded web task | `webagent.do_anything:session`, `webagent.do_anything:run`, `webagent.do_anything:events` | Agent can run a visible web task and stream progress. |
| Create a monitor | `webagent.track:monitor_create`, `webagent.track:events` | Agent can monitor configured pages and emit changes. |

Silent mode is usually appropriate for low-risk actions such as reading current-user memory, writing a confirmed summary, or searching public web pages.

Interactive mode is recommended for higher-risk actions such as browser takeover, external site login, long-running monitoring, form submission, or access to sensitive artifacts and recordings.

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
      role: "assistant",
      content: "The customer prefers concise implementation checklists.",
    },
  ],
});

const context = await eak.gumem.recall({
  token,
  sessionId: "account-research",
  query: "What should the assistant remember before the meeting?",
  details: true,
});
```

### Web Search

```ts
const search = await eak.webSearch.run<{ id: string }>({
  token,
  query: "latest product updates from example.com",
  maxResultsPerQuery: 5,
});

for await (const event of eak.webSearch.events({
  token,
  runId: search.data.id,
})) {
  console.log(event.event, event.data);
}
```

### Do Anything

```ts
const run = await eak.doAnything.run<{ id: string; sessionId: string }>({
  token,
  instruction: "Compare pricing pages and return the changed plans.",
  stream: {
    events: [
      EAKEventTypes.DO_ANYTHING_ACTION,
      EAKEventTypes.DO_ANYTHING_OBSERVATION,
      EAKEventTypes.DO_ANYTHING_ARTIFACT,
      EAKEventTypes.DO_ANYTHING_FINAL,
    ],
  },
});

await eak.doAnything.cancel({
  token,
  sessionId: run.data.sessionId,
  runId: run.data.id,
  reason: "User stopped the task",
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

### GenAuth and EAK Control Plane

```ts
const profile = await eak.genauth.userInfo({
  accessToken: process.env.GENAUTH_ACCESS_TOKEN!,
});

const workspaces = await eak.eak.workspaces.list({
  token: process.env.GENAUTH_ACCESS_TOKEN!,
});

const credential = await eak.eak.credentials.create({
  token: process.env.GENAUTH_ACCESS_TOKEN!,
  eakTenantId: "eak_tnt_1",
  allowedScopes: [
    "webagent.do_anything:session",
    "webagent.do_anything:run",
    "webagent.do_anything:events",
  ],
});
```

GenAuth and EAK management-plane calls use a GenAuth access token. Runtime capability calls use `delegateToken` output.

## API Surface

### Client

```ts
const eak = new EzaoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  timeoutMs: 30_000,
});
```

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `accessKey` | `string` | Yes | EAK access key from EAK Console. |
| `secretKey` | `string` | Yes | EAK secret key from EAK Console. |
| `host` | `string` | No | EAK Console/SDK gateway host. Defaults to the online EAK Console gateway, `https://eak.eazo.ai/dashboard`. |
| `fetch` | `typeof fetch` | No | Custom transport implementation. |
| `timeoutMs` | `number` | No | Request timeout. Defaults to `30000`. |

Compatibility aliases are exported for older callers:

```ts
import { EAK, EazoAgentKit, EzaoAgentKit } from "@eazo/eak";
```

### Namespaces

| Namespace | Methods |
| --- | --- |
| Delegation | `delegateToken`, deprecated aliases `delegateAgent`, `completeDelegateAgent` |
| EAK | `workspaces.list`, `workspaces.get`, `workspaces.create`, `workspaces.update`, `credentials.list`, `credentials.create`, `credentials.rotate`, `credentials.update` |
| GenAuth | `userInfo`, `jwks`, `discovery`, `introspectDelegationToken` |
| GUMem | `createSession`, `addMessages`, `recall`, `uploadResource`, `actions.record`, `actions.recall`, `actions.stream` |
| Web Search | `run`, `get`, `refine`, `events`, `cancel` |
| Do Anything | `run`, `createSession`, `createRun`, `getRun`, `events`, `intervene`, `cancel`, `readArtifacts`, `readRecording` |
| Track | `createMonitor`, `getMonitor`, `updateMonitor`, `deleteMonitor`, `runNow`, `events` |

Browser Use, Deep Research, and Site Login scopes are reserved until their product runtime SDK methods are exported.

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
    // Request a new delegated token with the missing scope.
  }

  if (error instanceof EAKRateLimitError || error instanceof EAKTimeoutError) {
    // Retry with backoff when your product flow allows it.
  }

  throw error;
}
```

## Security Notes

- Keep EAK AK/SK on trusted servers only.
- Do not expose delegation tokens to untrusted clients.
- Request the smallest useful scope set for each Agent action.
- Prefer `interactive` mode for browser control, site login, long-running monitors, and sensitive artifacts.
- Store `auditId`, `requestId`, and `traceId` with product logs when later investigation matters.
- Rotate AK/SK through EAK Console if a credential might have been exposed.

## License

MIT
