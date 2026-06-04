# @eazo/eak

[English](./README.md) | 中文

`@eazo/eak` 是面向 Node.js 服务端的统一 EAK SDK，用一条清晰的调用链串起 Agent 委托授权、GenAuth 用户管理、GUMem 长期记忆、WebAgent 网页行动、Do Anything、Web Search 和 Track 监控能力。

当一个 Agent 真正开始帮用户做事时，它不能只拿一把后台密钥到处调用接口。它需要知道用户是谁、用户允许它做什么、这次授权什么时候过期、页面里发生了什么、最后每一步能不能被追溯。

`@eazo/eak` 解决的是两类服务端调用：运行时产品调用时，应用服务端先确认 GenAuth 用户，再通过 `delegateToken` 申请短期委托 token，之后每次 GUMem/WebAgent/Do Anything/Web Search/Track 调用都把这个 token 传入 `token` 字段；GenAuth 用户管理调用时，SDK 会用 EAK AK/SK 换取标准 GenAuth management token，再调用 GenAuth v3 users API。

AK/SK 必须只保存在可信服务端，不能下发到浏览器、移动端、公开 CLI 配置或其他不可信运行环境。

## 为什么使用 EAK

EAK 把 Agent 授权模型收敛成几个稳定边界：

- 一个 SDK 入口：`new EzaoAgentKit({ accessKey, secretKey })`。
- 一个发现地址：`host` 指向 EAK Console/SDK 网关，默认值是 `https://eak.eazo.ai/dashboard`，SDK 通过 `/api/v3/eak/runtime-config` 获取 GenAuth、GUMem、WebAgent 等运行时地址。
- 一个授权入口：调用 `delegateToken`；silent 模式直接返回 `data.token`，interactive 模式返回授权 URL，之后由业务服务端完成兑换。
- 一条管理面路径：调用 `genauth.users.*`，SDK 会先用 AK/SK 换取 GenAuth management token，再调用 GenAuth v3 users API。
- 一组能力命名空间：`eak`、`genauth`、`gumem`、`webSearch`、`doAnything`、`track`。
- 一组可读的 scope 字符串：让最小授权边界直接出现在业务代码里。
- 一致的错误和审计字段：`requestId`、`traceId`、`auditId`、`retryable`。

## 安装

```bash
npm install @eazo/eak
# 或
pnpm add @eazo/eak
# 或
yarn add @eazo/eak
```

运行要求：

- Node.js 18 或更高版本。
- 服务端运行环境提供 `fetch`。
- 在 EAK Console 创建的 `accessKey` 与 `secretKey`，线上控制台地址是 `https://eak.eazo.ai/dashboard`。
- silent 运行时产品调用需要一个来自该 EAK credential 绑定 GenAuth userpool 的真实用户 ID。Smoke 测试可以通过 `EAK_USER_ID` 传入；业务代码中应通过 `currentUser` 或服务端已有登录态解析。interactive 委托创建时可以不传 `user` 或 `userId`，因为 EAK Console/BFF 会在授权过程中处理 GenAuth 登录。
- `genauth.users.*` 管理面调用不需要 `EAK_USER_ID`。SDK 会用 AK/SK 向 EAK 换取 GenAuth management token。
- 可选的 `host`，用于私有化或本地部署；默认值是 `https://eak.eazo.ai/dashboard`。

正常初始化 SDK 时不需要传 `tenantId`。EAK AK/SK 已经在服务端绑定了租户和应用边界。

## AI Skill

`@eazo/eak` 不应该只给人读文档，也应该让 AI 工具能直接理解 SDK 的能力边界。可以通过 Skill 让 Codex、Claude Code 或内部 Agent 按同一套授权模型调用 EAK。

安装 EAK Skill：

```bash
npx skills add https://github.com/EazoAI/eak-sdk-node --skill eak-sdk
```

如果只想安装到 Claude Code，可以指定 Agent：

```bash
npx skills add https://github.com/EazoAI/eak-sdk-node --agent claude-code --skill eak-sdk
```

npm 包中包含 `skills/` 目录，但推荐仍使用上面的 GitHub 仓库安装命令，这样 AI 工具可以读取仓库内的 Skill 元数据。

## 最短调用链

先在可信服务端初始化 SDK。AK/SK 只留在服务端，管理面调用和运行时产品委托都复用这一个 SDK 实例。

```ts
import { EzaoAgentKit, EAKEventTypes, EAKScopeBundles, EAKScopes } from "@eazo/eak";

const eak = new EzaoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
});
```

### GenAuth 用户管理

`genauth.users.*` 属于管理面能力，不需要 `EAK_USER_ID` 或 `delegateToken`。SDK 会在内部签名请求 `POST /api/v3/eak/genauth/admin-token`，请求体是 `{}`，拿到 GenAuth management token 和 `userPoolId` 后再调用 GenAuth v3 users API。

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

// Smoke 测试结束后可以清理测试用户：
// await eak.genauth.users.deleteBatch({ userIds: [profile.data.userId] });
```

### 运行时产品委托

GUMem、WebAgent、Do Anything、Web Search、Track 是代表终端用户执行的运行时产品能力。silent 委托需要一个来自 EAK credential 绑定 userpool 的真实 GenAuth 用户 ID，再使用 `delegateToken` 返回的 token。

```ts
const userId = process.env.EAK_USER_ID!;
if (!userId) {
  throw new Error("EAK_USER_ID 必须是 credential 绑定 userpool 下的真实 GenAuth 用户 ID");
}

const delegation = await eak.delegateToken({
  userId,
  agent: "sales-assistant",
  scopes: [
    ...EAKScopeBundles.GUMEM_SESSION_RECALL,
    EAKScopes.WEBAGENT_WEB_SEARCH_RUN,
    EAKScopes.WEBAGENT_WEB_SEARCH_READ,
    EAKScopes.WEBAGENT_DO_ANYTHING_SESSION,
    EAKScopes.WEBAGENT_DO_ANYTHING_RUN,
    EAKScopes.WEBAGENT_DO_ANYTHING_EVENTS,
  ],
  mode: "silent",
});

const token = delegation.data.token;

const memory = await eak.gumem.recall({
  token,
  sessionId: "customer-brief",
  query: "执行客户调研前需要记住哪些用户偏好？",
});

const run = await eak.doAnything.run<{ id: string; sessionId: string }>({
  token,
  instruction: "打开客户官网并总结最近的产品变化。",
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

这里的关键点不是方法有多少，而是每一步都有边界：Agent 只能做 token 里 scope 允许的事情，授权过期后不能继续执行，后端可以通过 `auditId` 追溯这次行为。

## 授权模型

### Runtime Discovery

`host` 指向 EAK Console/SDK 网关，不直接指向 GenAuth、GUMem 或 WebAgent。如果不传 `host`，SDK 默认使用线上 EAK Console 网关：

```text
https://eak.eazo.ai/dashboard
```

SDK 会签名请求：

```text
GET /api/v3/eak/runtime-config
```

返回值提供 EAK runtime、GenAuth、GUMem、WebAgent 等服务地址。普通业务代码不需要分别配置这些产品 URL。

### 服务端 AK/SK

`accessKey` 和 `secretKey` 表示 EAK Console 中已经配置好的租户和应用边界。SDK 只在可信服务端用它们签名 EAK 请求，包括委托授权和产品 token exchange。

### delegateToken

silent 模式下，`delegateToken` 绑定四件事：

- 当前用户 ID。
- Agent ID。
- 本次请求的 scopes。
- token 过期时间与审计上下文。

silent 产品能力方法传入 `token: delegation.data.token`。如果这个 token 是 EAK delegation token，SDK 会在内部换成 GUMem 或 WebAgent 所需的产品 access token，再调用下游服务。

```ts
const delegation = await eak.delegateToken({
  userId,
  agent: "research-assistant",
  scopes: ["gumem.memory:read"],
  mode: "silent",
});

await eak.gumem.recall({
  token: delegation.data.token,
  query: "研究偏好",
});
```

interactive 模式下，业务服务端仍然先调用 `delegateToken`，但这一步不会拿到 token：

```ts
const grant = await eak.delegateToken({
  mode: "interactive",
  redirectUri: "https://app.example.com/eak/callback",
  state: "business-csrf-state",
  agent: "research-assistant",
  scopes: ["gumem.memory:read", "webagent.do_anything:run"],
});

redirectUserTo(grant.data.authorizationUrl);
```

用户访问 `authorizationUrl` 进入 EAK Console/BFF。若用户未登录，Console/BFF 会先走 GenAuth 登录；授权确认后由 Console/BFF 统一 complete，再回跳业务 `redirectUri`，只带一次性 `code`、业务 `state`、`grant_state`/`grantId`。浏览器不会拿到 delegation token。

业务 callback handler 在服务端用 AK/SK 兑换最终 token：

```ts
const completed = await eak.completeDelegateToken({
  grantId: String(req.query.grantId ?? req.query.grant_id),
  code: String(req.query.code),
  state: String(req.query.state),
});

await eak.gumem.recall({
  token: completed.data.token,
  query: "研究偏好",
});
```

`completeDelegateToken` 是推荐的服务端 callback helper。`delegateAgent` 和 `completeDelegateAgent` 仍保留为 deprecated 兼容命名，但当前 callback 契约是 `{ grantId, code, state }`；旧的 `{ code, state }` complete 签名不再兼容。

## Scope 怎么选

直接使用 scope 字符串，让业务代码里能看见本次 Agent 请求的最小授权边界。

| 场景 | 推荐 scope | 用户能理解的描述 |
| --- | --- | --- |
| 读取用户记忆 | `gumem.memory:read` | Agent 可以读取与你相关的历史偏好。 |
| 创建 GUMem 会话并召回上下文 | `gumem.memory:read`, `gumem.memory:write`, `gumem.message:write` | Agent 可以为当前用户创建记忆会话、写入消息并召回上下文。 |
| 写入任务结果 | `gumem.message:write`, `gumem.action:write` | Agent 可以把本次确认过的结果写回 GUMem。 |
| 搜索公开网页 | `webagent.web_search:run`, `webagent.web_search:read` | Agent 可以搜索公开网页并读取结果。 |
| 执行网页任务 | `webagent.do_anything:session`, `webagent.do_anything:run`, `webagent.do_anything:events` | Agent 可以执行一次有边界的网页任务，并展示执行过程。 |
| 创建长期监控 | `webagent.track:monitor_create`, `webagent.track:events` | Agent 可以按规则监控指定页面变化。 |

低风险能力通常可以静默授权，例如读取当前用户自己的 GUMem、写入本次会话摘要、搜索公开网页、读取普通任务结果。

高风险能力建议显式授权，例如接管浏览器、请求或确认外部站点登录、创建长期监控、提交表单、读取浏览器画面/录屏/附件/研究产物等敏感内容。

SDK 也导出了常见 GUMem 会话、写入、召回场景的 scope bundle：

```ts
EAKScopeBundles.GUMEM_SESSION_RECALL
```

## 能力示例

### GUMem

```ts
await eak.gumem.createSession({
  token,
  userId,
  sessionId: "acme-renewal",
  title: "Acme 续约调研",
});

await eak.gumem.addMessages({
  token,
  sessionId: "acme-renewal",
  messages: [
    {
      role: "assistant",
      content: "Acme 偏好简洁的实施 checklist，续约沟通前需要补充安全评审链接。",
    },
  ],
});

const context = await eak.gumem.recall({
  token,
  sessionId: "acme-renewal",
  query: "我准备给 Acme 写续约邮件前，需要记住哪些偏好和未关闭风险？",
  details: true,
});

const draft = await callYourLLM({
  messages: [
    {
      role: "system",
      content: "把召回的客户记忆作为私有上下文使用，只有相关时才引用。",
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "给 Acme 管理员团队起草一封续约邮件。",
        memory: context.data,
      }),
    },
  ],
});
```

### Do Anything

```ts
const run = await eak.doAnything.run<{ id: string; sessionId: string }>({
  token,
  instruction: "打开 Acme 客户门户，总结和企业管理员相关的产品更新。",
  stream: {
    events: [
      EAKEventTypes.DO_ANYTHING_ACTION,
      EAKEventTypes.DO_ANYTHING_OBSERVATION,
      EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME,
      EAKEventTypes.DO_ANYTHING_USER_ACTION_REQUIRED,
      EAKEventTypes.DO_ANYTHING_ARTIFACT,
      EAKEventTypes.DO_ANYTHING_FINAL,
    ],
  },
  context: { memory: context.data },
});

await eak.doAnything.cancel({
  token,
  sessionId: run.data.sessionId,
  runId: run.data.id,
  reason: "用户停止任务",
});
```

### Web Search

```ts
const search = await eak.webSearch.run<{ id: string }>({
  token,
  query: "Acme 企业管理员 产品更新 安全评审 release notes",
  maxResultsPerQuery: 5,
});

for await (const event of eak.webSearch.events({
  token,
  runId: search.data.id,
})) {
  console.log(event.event, event.data);
}
```

### Track

```ts
const monitor = await eak.track.createMonitor<{ id: string }>({
  token,
  name: "竞品价格页监控",
  target: "https://example.com/pricing",
  schedule: "0 9 * * 1",
});

await eak.track.runNow({
  token,
  monitorId: monitor.data.id,
});
```

### GenAuth 与 EAK 管理面

```ts
const client = new EzaoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
});

const profile = await client.genauth.userInfo({
  accessToken: process.env.GENAUTH_ACCESS_TOKEN!,
});

const workspaces = await client.eak.workspaces.list({
  token: process.env.GENAUTH_ACCESS_TOKEN!,
});

const credential = await client.eak.credentials.create({
  token: process.env.GENAUTH_ACCESS_TOKEN!,
  eakTenantId: "eak_tnt_1",
  allowedScopes: [
    "webagent.do_anything:session",
    "webagent.do_anything:run",
    "webagent.do_anything:events",
  ],
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

`currentUser`、`genauth.userInfo`、EAK workspace/credential API 使用 GenAuth access token，因为它们代表已登录管理员操作。`genauth.users.*` 也属于管理面能力，但它使用 EAK AK/SK：SDK 会签名请求 `POST /api/v3/eak/genauth/admin-token`，请求体是空 JSON `{}`，拿到标准 GenAuth management token 和 `userPoolId`，再携带 `Authorization: Bearer ...` 与 `x-authing-userpool-id` 调用 GenAuth v3 用户管理 API。这里不传 `resource`、`actions`、`expiresIn` 或 `EAK_USER_ID`。GUMem/WebAgent/Track 等运行时能力才使用 `delegateToken` 返回的 token。

## API 概览

### Client

```ts
const eak = new EzaoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  timeoutMs: 30_000,
});
```

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `accessKey` | `string` | 是 | EAK Console 创建的 access key。 |
| `secretKey` | `string` | 是 | EAK Console 创建的 secret key。 |
| `host` | `string` | 否 | EAK Console/SDK 网关地址，默认指向线上 EAK Console 网关 `https://eak.eazo.ai/dashboard`。 |
| `fetch` | `typeof fetch` | 否 | 自定义传输实现。 |
| `timeoutMs` | `number` | 否 | 请求超时时间，默认 `30000`。 |

兼容导出：

```ts
import { EAK, EazoAgentKit, EzaoAgentKit } from "@eazo/eak";
```

### 命名空间

| 命名空间 | 方法 |
| --- | --- |
| 委托授权 | `delegateToken`, `completeDelegateToken`；兼容别名：`delegateAgent`, `completeDelegateAgent` |
| EAK | `workspaces.list`, `workspaces.get`, `workspaces.create`, `workspaces.update`, `credentials.list`, `credentials.create`, `credentials.rotate`, `credentials.update` |
| GenAuth | `userInfo`, `jwks`, `discovery`, `introspectDelegationToken`, `users.list`, `users.get`, `users.getBatch`, `users.create`, `users.createBatch`, `users.update`, `users.deleteBatch` |
| GUMem | `createSession`, `addMessages`, `recall`, `uploadResource`, `actions.record`, `actions.recall`, `actions.stream` |
| Do Anything | `run`, `createSession`, `createRun`, `getRun`, `events`, `intervene`, `cancel`, `readArtifacts`, `readRecording` |
| Web Search | `run`, `get`, `refine`, `events`, `cancel` |
| Track | `createMonitor`, `getMonitor`, `updateMonitor`, `deleteMonitor`, `runNow`, `events` |

Browser Use、Deep Research、Site Login 的 scope 已预留，但产品运行时 SDK 方法导出前不作为公开方法说明。

### 返回结构

大部分 SDK 方法返回：

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

流式方法返回 `AsyncIterable<EAKEvent<T>>`：

```ts
type EAKEvent<T = unknown> = {
  id?: string;
  event?: string;
  data: T;
};
```

## 错误处理

所有 SDK 错误都继承自 `EAKError`，并尽量暴露 `code`、`status`、`requestId`、`traceId`、`auditId`、`retryable` 和原始响应 `body`。

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
    // 重新申请包含缺失 scope 的 delegation token。
  }

  if (error instanceof EAKRateLimitError || error instanceof EAKTimeoutError) {
    // 业务允许时按退避策略重试。
  }

  throw error;
}
```

常见首次接入错误：

| 错误 | 含义 | 下一步 |
| --- | --- | --- |
| `agent must be a string` | 当前线上 delegation API 期望 `agent` 是字符串 ID。 | 使用 `agent: "memory-agent"`，不要传对象。 |
| `eak.delegation.user_not_bound` | `userId` 不属于该 EAK credential 绑定的 GenAuth userpool。 | 使用 `currentUser` 返回的真实用户 ID，或确认用户来自同一个绑定 userpool。 |
| `eak.genauth.userpool_binding_missing` | AK/SK 没有绑定 GenAuth userpool，`genauth.users.*` 无法换取 management token。 | 先把 EAK credential 绑定到目标 GenAuth userpool。 |
| `eak.genauth.userpool_owner_missing` | 绑定的 GenAuth userpool 找不到可用于签发 management token 的 owner 用户。 | 修复 GenAuth userpool owner 数据或绑定。 |
| `eak.token_exchange.upstream_failed` 且包含 `unauthorized_client` 或 `grant_type is not enabled` | Delegation 已成功，但 tenant 级 EAK managed delegation app 缺少 token-exchange grant，或 workspace 绑定发生漂移。 | 重新执行 EAK workspace delegation app 补偿/修复；新的 EAK workspace 应该自动在 managed app 上开启 token-exchange。 |
| `delegation.required` | GUMem/WebAgent 调用没有传 `token`。 | 把 `delegation.data.token` 传给产品能力方法。 |
| `direct delegation token deprecated` | 应用直接把 EAK delegation token 打到了产品服务。 | 通过 SDK 调产品能力，让 SDK 在内部完成 token exchange。 |

## 安全建议

- AK/SK 只保存在可信服务端。
- 不要把 delegation token 暴露给不可信客户端。
- 每次 Agent 行动只申请必要 scope。
- 浏览器接管、站点登录、长期监控、敏感产物访问优先使用 `interactive`。
- 在业务日志中记录 `auditId`、`requestId`、`traceId`，方便后续审计。
- 如果怀疑 AK/SK 泄露，应在 EAK Console 中轮换密钥。

## License

MIT
