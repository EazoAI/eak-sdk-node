---
name: eak-sdk
description: Use when building, testing, debugging, or documenting Node.js integrations with @eazo/eak, EzaoAgentKit/EAK, AK/SK credentials, delegateToken, GenAuth currentUser/userInfo/introspection, EAK runtime-config discovery, EAK workspace/credential APIs, GUMem, WebAgent, Web Search, Do Anything, Track, OBO product token exchange, or local .genauth.localhost SDK flows.
---

# EAK SDK

## Core Contract

Use `@eazo/eak` from trusted server-side Node.js code. Keep AK/SK on the server, create one reusable `EzaoAgentKit`, call `delegateToken` for the current user and agent action, then pass `delegation.data.token` explicitly to every product capability call.

```ts
import { EzaoAgentKit, EAKScopeBundles, EAKScopes } from "@eazo/eak";

const eak = new EzaoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  host: process.env.EAK_HOST, // EAK Console/SDK gateway; optional in hosted EAK.
});

const user = await eak.currentUser<{ id: string; subject?: string; name?: string }>({
  accessToken: genauthAccessToken,
});

const delegation = await eak.delegateToken({
  user: user.data,
  agent: {
    id: "research-assistant",
    name: "Research Assistant",
    description: "Researches accounts before customer meetings",
  },
  scopes: [
    EAKScopes.GUMEM_MEMORY_READ,
    EAKScopes.GUMEM_MEMORY_WRITE,
    ...EAKScopeBundles.AGENT_DO_ANYTHING_BASIC,
  ],
  mode: "silent",
});

if ("authorizationUrl" in delegation.data) {
  throw new Error("This server flow requires silent delegation");
}

const token = delegation.data.token;

await eak.gumem.createSession({
  token,
  userId: String(user.data.id),
  sessionId: "account-research",
});

const memory = await eak.gumem.recall({
  token,
  sessionId: "account-research",
  query: "What should the assistant remember?",
});

const run = await eak.doAnything.run({
  token,
  instruction: "Open the target site and summarize product changes.",
  context: { memory: memory.data },
});
```

`EAK` and `EazoAgentKit` are compatibility aliases. Prefer the correctly spelled `EzaoAgentKit` in new examples. `delegateAgent` and `completeDelegateAgent` remain deprecated compatibility helpers; prefer `delegateToken` unless you are deliberately maintaining an old interactive callback flow.

## Runtime Discovery

- `host` points to the EAK Console/SDK gateway, not directly to GenAuth, GUMem, or WebAgent.
- The SDK signs `GET /api/v3/eak/runtime-config` with AK/SK, caches returned service URLs, and routes downstream calls internally.
- Do not configure `genauthBaseUrl`, `gumemBaseUrl`, `webAgentBaseUrl`, or `eakBaseUrl` in normal integrations. Use those only for focused tests or migration debugging.
- Product namespaces require an explicit `token` field. The SDK does not read a constructor-level token or `delegateAgent` config.

## Token Roles

- GenAuth access token: proves the logged-in user to `currentUser`, `genauth.userInfo`, and EAK management-plane APIs.
- EAK delegation token: returned by `delegateToken`; pass it as `token` to GUMem/WebAgent/Web Search/Do Anything/Track calls.
- Product access token: produced by the SDK through `/api/v3/eak/token-exchange` when a raw EAK delegation token is used for a product call. Do not hand-roll this exchange in application code.
- Direct product token: acceptable only when a product service already issued it or a test is intentionally bypassing delegation.

## Management Plane Vs Runtime

Use GenAuth access tokens for EAK workspace and AK/SK management:

```ts
await eak.eak.workspaces.list({ token: genauthAccessToken });

await eak.eak.credentials.create({
  token: genauthAccessToken,
  eakTenantId: "eak_tnt_1",
  allowedScopes: EAKScopeBundles.AGENT_DO_ANYTHING_BASIC,
});
```

Use `delegateToken` output for runtime capability namespaces:

- `gumem.createSession`, `gumem.addMessages`, `gumem.recall`, `gumem.uploadResource`, `gumem.actions.*`
- `webSearch.run/get/refine/events/cancel`
- `doAnything.run/createSession/createRun/getRun/events/intervene/cancel/readArtifacts/readRecording`
- `track.createMonitor/getMonitor/updateMonitor/deleteMonitor/runNow/events`

## Local GenAuth And Docker

For local stacks, first pin the real service boundary:

1. `EAK_HOST` should normally be the local EAK Console/BFF gateway, for example `http://127.0.0.1:3100`.
2. Confirm `GET /api/v3/eak/runtime-config` returns the GenAuth userpool issuer plus GUMem/WebAgent URLs that the product services validate.
3. If a request URL ends with `.genauth.localhost`, the SDK rewrites it to `127.0.0.1` and preserves the original `Host` header. Set `EAK_LOCAL_GENAUTH_TARGET_HOST=host.docker.internal` when the target must be reached from a containerized product service. Set `EAK_LOCAL_GENAUTH_REWRITE=false` only when DNS already resolves correctly.
4. If runtime-config works but `delegateToken` returns 403, inspect user binding, scope/resource binding, tenant/workspace binding, and any `apiCode` such as `eak.delegation.user_not_bound`.
5. If GUMem/WebAgent says `direct delegation token deprecated`, the integration is bypassing the SDK-managed product token exchange or calling the product service with a raw delegation token directly.

## Common Mistakes

- Do not put `delegateAgent`, user ids, or product tokens in the constructor.
- Do not call `eak.gumem.*`, `eak.webSearch.*`, `eak.doAnything.*`, or `eak.track.*` without `token`.
- Do not treat `agent.id` as the only authorization boundary. It is stable display and audit metadata; scopes and resource bindings carry permission.
- Do not invent `user.id`. Use a real GenAuth user or the value returned by `currentUser`.
- Do not expose AK/SK or delegated tokens to untrusted browser/mobile/public CLI code.
- Do not commit real AK/SK, GenAuth access tokens, product tokens, cookies, or LLM keys.

## Testing And Verification

For SDK changes, run in the SDK repo:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm pack --dry-run
```

For skill or docs changes that teach integration, also validate from a fresh consumer project:

1. Pack the current SDK into a temporary directory with `pnpm pack --pack-destination <tmp-dir>`.
2. Create a clean Node.js 18+ TypeScript project outside the SDK repo.
3. Install the packed tarball.
4. Add a small mocked integration that imports from `@eazo/eak`, constructs `EzaoAgentKit`, returns runtime-config from `host`, calls `delegateToken`, passes `delegation.data.token` to GUMem/WebAgent calls, and asserts product token exchange plus WebAgent tenant routing.
5. Run the consumer project's typecheck and test command.

Prefer mocked fetch-based tests for normal verification. Use real GenAuth/GUMem/WebAgent services only for explicit smoke tests, and never hard-code real secrets in repository files.
