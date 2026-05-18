# @eazo/eak

Node SDK for EAK Agent delegation, GUMem, and WebAgent.

`@eazo/eak` uses one server-side EAK AK/SK to request a short-lived
`delegateAgentToken` from EAK. Product calls then use only that token.
AK/SK must stay on a trusted server and must never be sent to browsers,
mobile clients, or public CLI config.

```ts
import { EAK, EAKEventTypes, EAKScopeBundles } from "@eazo/eak";

const eak = new EAK({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  host: "https://eak.eazo.ai",
});

const delegation = await eak.delegateAgent({
  userId: "user_1",
  agent: {
    id: "research-assistant",
    name: "Research Assistant",
  },
  mode: "silent",
  scopes: EAKScopeBundles.AGENT_DO_ANYTHING_BASIC,
});

const token = delegation.data.delegateAgentToken;

const context = await eak.gumem.recall({
  token,
  sessionId: "default",
  query: "用户最近关注什么？",
});

const run = await eak.doAnything.run({
  token,
  instruction: "打开目标网站并整理页面变化",
  stream: {
    events: [EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME],
  },
  tools: {
    gumem: { actions: ["recall"] },
  },
});

for await (const event of eak.doAnything.events({
  token,
  sessionId: run.data.sessionId,
  runId: run.data.id,
})) {
  if (event.event === EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME) {
    // Render browser frame in your page.
  }
}
```

## Public API

- `new EAK(options)`: official SDK entry.
- `EazoAgentKit`: long-form class name.
- `delegateAgent(input)`: signs an EAK request with EAK AK/SK and returns `delegateAgentToken`.
- `completeDelegateAgent(input)`: completes interactive authorization.
- `gumem.*`: session, message, memory recall, resource upload, and action memory APIs.
- `webSearch.*`: run, get, refine, events, and cancel APIs.
- `doAnything.*`: high-level `run`, session/run lifecycle, events, intervention, cancel, artifacts, and recording APIs.
- `track.*`: monitor lifecycle, manual run, and events APIs.

## Error Handling

All SDK errors inherit from `EAKError` and expose `code`, `status`,
`requestId`, `traceId`, `auditId`, and `retryable`.

```ts
import { EAKPermissionDeniedError } from "@eazo/eak";

try {
  await eak.webSearch.run({ token, query: "EAK SDK" });
} catch (error) {
  if (error instanceof EAKPermissionDeniedError) {
    // Request a new delegateAgentToken with the missing scope.
  }
}
```
