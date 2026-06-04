---
name: eak-sdk
description: Use when building, testing, debugging, or documenting Node.js integrations with @eazo/eak, EzaoAgentKit/EAK, AK/SK credentials, delegateToken, GenAuth currentUser/userInfo/introspection/user management, EAK runtime-config discovery, GUMem, WebAgent, Web Search, Do Anything, Track, OBO product token exchange, or local .genauth.localhost SDK flows.
---

# EAK SDK

## Core Contract

Use `@eazo/eak` from trusted server-side Node.js code. Keep AK/SK on the server and create one reusable `EzaoAgentKit`. For silent runtime product calls, resolve a real GenAuth user id from the credential-bound userpool, call `delegateToken`, then pass `delegation.data.token` explicitly to every product capability call. For interactive runtime authorization, call `delegateToken({ mode: "interactive", redirectUri, state, agent, scopes })` from the server without exposing AK/SK; redirect the user to `authorizationUrl`, then handle the business callback server-side with `completeDelegateToken({ grantId, code, state })` to receive the token. For GenAuth user management, call `eak.genauth.users.*`; the SDK exchanges AK/SK for a standard GenAuth management token internally and does not require `EAK_USER_ID`.

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
  agent: "research-assistant",
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

For explicit authorization, the EAK Console/BFF owns GenAuth login and grant completion before it redirects back to the business `redirectUri`. The redirect only carries one-time callback fields such as `code`, `state`, and `grant_state`/`grantId`; never design an API that exposes a delegation token to browser code.

```ts
const grant = await eak.delegateToken({
  mode: "interactive",
  redirectUri: "https://app.example.com/eak/callback",
  state: "business-csrf-state",
  agent: "research-assistant",
  scopes: [EAKScopes.GUMEM_MEMORY_READ],
});

redirectUserTo(grant.data.authorizationUrl);

const completed = await eak.completeDelegateToken({
  grantId,
  code,
  state,
});
```

`EAK` and `EazoAgentKit` are compatibility aliases. Prefer the correctly spelled `EzaoAgentKit` in new examples. `delegateAgent` and `completeDelegateAgent` remain deprecated compatibility names. Use `completeDelegateToken` for interactive callbacks; the current callback contract is `{ grantId, code, state }`, not the old `{ code, state }` shape.

## Runtime Discovery

- `host` points to the EAK Console/SDK gateway, not directly to GenAuth, GUMem, or WebAgent.
- The SDK signs `GET /api/v3/eak/runtime-config` with AK/SK, caches returned service URLs, and routes downstream calls internally.
- Do not configure `genauthBaseUrl`, `gumemBaseUrl`, `webAgentBaseUrl`, or `eakBaseUrl` in normal integrations. Use those only for focused tests or migration debugging.
- Product namespaces require an explicit `token` field. The SDK does not read a constructor-level token or `delegateAgent` config.
- The online delegation API currently expects `agent` to be a string id, for example `agent: "memory-agent"`. Do not teach object-shaped Agent metadata unless the backend API has been updated to accept it.

## Token Roles

- GenAuth access token: proves the logged-in user to `currentUser` and `genauth.userInfo`.
- EAK-derived GenAuth management token: produced internally by SDK-managed `POST /api/v3/eak/genauth/admin-token` with body `{}` for `genauth.users.*`; application code should not supply or persist it in normal flows.
- EAK delegation token: returned directly by silent `delegateToken`, or by server-side `completeDelegateToken({ grantId, code, state })` after an interactive grant; pass it as `token` to GUMem/WebAgent/Web Search/Do Anything/Track calls.
- Product access token: produced by the SDK through `/api/v3/eak/token-exchange` when a raw EAK delegation token is used for a product call. Do not hand-roll this exchange in application code.
- Direct product token: acceptable only when a product service already issued it or a test is intentionally bypassing delegation.

## Management Plane Vs Runtime

Use AK/SK-backed `genauth.users.*` for GenAuth management-plane user CRUD. This is not a GUMem/WebAgent runtime capability and does not use `delegateToken` or `EAK_USER_ID`. The SDK exchanges AK/SK through EAK for a standard GenAuth management token, then attaches `Authorization` and `x-authing-userpool-id` automatically:

```ts
await eak.genauth.users.list({ page: 1, limit: 20 });

await eak.genauth.users.create({
  username: "sdk-demo-user",
  password: process.env.GENAUTH_DEMO_USER_PASSWORD!,
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
4. If runtime-config works but `delegateToken` returns 403, inspect user binding, scope/resource binding, tenant binding, and any `apiCode` such as `eak.delegation.user_not_bound`.
5. If GUMem/WebAgent says `direct delegation token deprecated`, the integration is bypassing the SDK-managed product token exchange or calling the product service with a raw delegation token directly.

## Common Mistakes

- Do not put `delegateAgent`, user ids, or product tokens in the constructor.
- Do not call `eak.gumem.*`, `eak.webSearch.*`, `eak.doAnything.*`, or `eak.track.*` without `token`.
- Do not pass Agent metadata objects to `delegateToken`. Use a string Agent id such as `agent: "memory-agent"`; scopes and resource bindings carry permission.
- Do not invent `user.id`. Silent mode needs a real GenAuth user or the value returned by `currentUser`; interactive mode can omit `user`/`userId` because Console/BFF resolves the user through GenAuth login.
- Do not pass a long-lived GenAuth admin token to `genauth.users.*` in normal server integrations. Use AK/SK and let SDK call EAK's admin-token endpoint with body `{}`.
- Do not add `resource`, `actions`, `expiresIn`, or `EAK_USER_ID` to the GenAuth admin-token exchange.
- Do not expose AK/SK or delegated tokens to untrusted browser/mobile/public CLI code. Interactive callbacks exchange only `grantId`, `code`, and `state` on the business server.
- Do not commit real AK/SK, GenAuth access tokens, product tokens, cookies, or LLM keys.

## Real Smoke Inputs

For a real hosted GUMem smoke, require:

- `EAK_ACCESS_KEY` and `EAK_SECRET_KEY`.
- `EAK_USER_ID`, from the GenAuth userpool bound to the EAK credential. A placeholder like `user_1` usually fails with `eak.delegation.user_not_bound`.
- Optional `EAK_HOST`; use it only for private or local EAK deployments.
- Optional `EAK_AGENT_ID`; default examples can use `memory-agent`, but the credential and product binding must allow the requested scopes.

If the first real request fails:

| Error | Meaning | Next step |
| --- | --- | --- |
| `agent must be a string` | The online delegation API expects a string Agent id. | Use `agent: "memory-agent"`. |
| `eak.delegation.user_not_bound` | The user id is not in the credential-bound userpool. | Resolve the real user via `currentUser` or the same GenAuth userpool. |
| `eak.genauth.userpool_binding_missing` | The AK/SK is not bound to a GenAuth userpool. | Bind the EAK credential to the target GenAuth userpool before `genauth.users.*`. |
| `eak.genauth.userpool_owner_missing` | The bound userpool owner cannot be resolved. | Fix the GenAuth userpool owner data or binding. |
| `eak.token_exchange.upstream_failed` with `unauthorized_client` or `grant_type is not enabled` | Delegation succeeded, but the managed delegation app is missing token-exchange grant support or has drifted from the tenant binding. | Repair the managed delegation app binding before calling GUMem or WebAgent product capabilities. |
| `delegation.required` | A product namespace call omitted `token`. | Pass `delegation.data.token`. |
| `direct delegation token deprecated` | The app bypassed SDK-managed token exchange. | Call GUMem/WebAgent through the SDK namespace. |

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
4. Add a small mocked integration that imports from `@eazo/eak`, constructs `EzaoAgentKit`, returns runtime-config from `host`, calls `delegateToken`, passes `delegation.data.token` to GUMem/WebAgent calls, and asserts product token exchange plus WebAgent tenant routing. Also cover `genauth.users.list()` by mocking `POST /api/v3/eak/genauth/admin-token` with body `{}` and a returned `userPoolId`.
5. Run the consumer project's typecheck and test command.

Prefer mocked fetch-based tests for normal verification. Use real GenAuth/GUMem/WebAgent services only for explicit smoke tests, and never hard-code real secrets in repository files.
