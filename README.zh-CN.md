# @eazo/eak

[English README](./README.md)

`@eazo/eak` 是面向 Node.js 的统一 EAK SDK，用一套服务端入口串起 Agent 委托授权、GUMem 记忆能力和 WebAgent 自动化能力。

它的核心目标是让接入方只理解一个 EAK Gateway、一个 AK/SK、一个 `delegateAgentToken`。普通业务接入不需要分别配置 GenAuth、GUMem、WebAgent 的服务地址。

AK/SK 必须只保存在可信服务端，不能下发到浏览器、移动端、公开 CLI 配置或其他不可信运行环境。

## 安装

```bash
pnpm add @eazo/eak
```

运行要求：

- Node.js 18 或更高版本。
- 服务端运行环境提供 `fetch`，Node.js 18 已内置。
- 在 EAK Console 创建的 access key 与 secret key。
- EAK Gateway 地址，例如 `https://eak.eazo.ai` 或私有化部署地址。

## 最短调用链

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
  query: "执行调研前需要记住哪些用户偏好？",
});

const run = await eak.doAnything.run<{ id: string; sessionId: string }>({
  token,
  instruction: "打开目标网站并总结最近的产品变化。",
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

## 核心概念

### EAK Gateway

`host` 指向 EAK Gateway。SDK 的委托授权、GUMem、WebAgent 请求都通过这个统一入口发出。普通业务代码不应该再分别传入 GenAuth、GUMem、WebAgent 的 base URL。

### 服务端 AK/SK

`accessKey` 和 `secretKey` 表示 EAK Console 中已经绑定好的应用或租户边界。SDK 只用它们在服务端签名 `delegateAgent` 请求。

### delegateAgentToken

`delegateAgentToken` 是一次 Agent 委托授权后的短期业务 token。后续 GUMem、WebAgent、Track 等能力调用都使用这个 token。它包含用户、Agent、scope、过期时间与审计上下文，应按敏感 Bearer Token 处理。

### Scope 与 Bundle

Scope 描述 Agent 被允许做什么。Quick Start 可以优先使用 `EAKScopeBundles.*`，生产环境再根据实际风险拆到更小的 `EAKScopes.*`。

## 授权模式

### 静默授权

适合低风险、可由策略自动授予的能力。

```ts
const { data } = await eak.delegateAgent({
  userId: "user_1",
  agent: { id: "support-assistant", name: "Support Assistant" },
  mode: "silent",
  scopes: EAKScopeBundles.GUMEM_READONLY,
});

const token = data.delegateAgentToken;
```

### 显式授权

适合浏览器接管、外部站点登录、长期监控、读取敏感产物等高风险能力。

```ts
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

## 能力入口

| 命名空间 | 方法 |
| --- | --- |
| 委托授权 | `delegateAgent`, `completeDelegateAgent` |
| GUMem | `createSession`, `addMessages`, `recall`, `uploadResource`, `actions.record`, `actions.recall`, `actions.stream` |
| Web Search | `run`, `get`, `refine`, `events`, `cancel` |
| Do Anything | `run`, `createSession`, `createRun`, `getRun`, `events`, `intervene`, `cancel`, `readArtifacts`, `readRecording` |
| Track | `createMonitor`, `getMonitor`, `updateMonitor`, `deleteMonitor`, `runNow`, `events` |

## 错误处理

所有 SDK 错误都继承自 `EAKError`，并尽量暴露 `code`、`status`、`requestId`、`traceId`、`auditId`、`retryable` 和原始响应 `body`。

```ts
import { EAKPermissionDeniedError, EAKTimeoutError } from "@eazo/eak";

try {
  await eak.webSearch.run({ token, query: "EAK SDK" });
} catch (error) {
  if (error instanceof EAKPermissionDeniedError) {
    // 重新发起 delegateAgent，请求缺失的 scope。
  }

  if (error instanceof EAKTimeoutError) {
    // 根据业务场景决定是否重试。
  }

  throw error;
}
```

## 安全建议

- AK/SK 只保存在可信服务端。
- 不要把 `delegateAgentToken` 暴露给不可信客户端。
- 每次 Agent 行动只申请必要 scope。
- 高风险 scope 优先使用 `interactive` 模式。
- 在业务日志中记录 `auditId`、`requestId`、`traceId`，方便后续审计。
- 如果怀疑 AK/SK 泄露，应在 EAK Console 中轮换密钥。

## 本仓库开发

本仓库使用 pnpm 管理。

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

发布前可以执行：

```bash
pnpm pack --dry-run
```

## License

MIT
