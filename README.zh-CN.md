# @eazo/eak

[English](./README.md) | 中文

`@eazo/eak` 是面向 Node.js 服务端的统一 EAK SDK，用一条清晰的调用链串起 Agent 委托授权、GUMem 长期记忆、WebAgent 网页行动、Web Search 和 Track 监控能力。

当一个 Agent 真正开始帮用户做事时，它不能只拿一把后台密钥到处调用接口。它需要知道用户是谁、用户允许它做什么、这次授权什么时候过期、页面里发生了什么、最后每一步能不能被追溯。

`@eazo/eak` 解决的就是这件事：应用服务端先确认 GenAuth 用户，再通过 `delegateToken` 申请短期委托 token，之后每次 GUMem/WebAgent/Web Search/Track 调用都把这个 token 传入 `token` 字段。SDK 会在内部完成运行时发现和产品 token exchange。

AK/SK 必须只保存在可信服务端，不能下发到浏览器、移动端、公开 CLI 配置或其他不可信运行环境。

## 为什么使用 EAK

EAK 把 Agent 授权模型收敛成几个稳定边界：

- 一个 SDK 入口：`new EzaoAgentKit({ accessKey, secretKey })`。
- 一个发现地址：`host` 指向 EAK Console/SDK 网关，默认值是 `https://eak.eazo.ai/dashboard`，SDK 通过 `/api/v3/eak/runtime-config` 获取 GenAuth、GUMem、WebAgent 等运行时地址。
- 一个授权步骤：调用 `delegateToken`，再把 `data.token` 传给产品能力方法。
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
- 可选的 `host`，用于私有化或本地部署；默认值是 `https://eak.eazo.ai/dashboard`。

正常初始化 SDK 时不需要传 `tenantId`。EAK AK/SK 已经在服务端绑定了租户和应用边界。

## AI Skill

`@eazo/eak` 不应该只给人读文档，也应该让 AI 工具能直接理解 SDK 的能力边界。可以通过 Skill 让 Codex、Claude Code 或内部 Agent 按同一套授权模型调用 EAK。

安装 EAK Skill：

```bash
npx skills add https://github.com/EazoAI/eazo-eak-sdk-node --skill eak
```

如果只想安装到 Claude Code，可以指定 Agent：

```bash
npx skills add https://github.com/EazoAI/eazo-eak-sdk-node --agent claude-code --skill eak
```

## 最短调用链

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

`delegateToken` 绑定四件事：

- 当前用户 ID。
- Agent ID。
- 本次请求的 scopes。
- token 过期时间与审计上下文。

产品能力方法传入 `token: delegation.data.token`。如果这个 token 是 EAK delegation token，SDK 会在内部换成 GUMem 或 WebAgent 所需的产品 access token，再调用下游服务。

```ts
const delegation = await eak.delegateToken({
  userId: "user_1",
  agent: "research-assistant",
  scopes: ["gumem.memory:read"],
  mode: "silent",
});

await eak.gumem.recall({
  token: delegation.data.token,
  query: "研究偏好",
});
```

`delegateAgent` 和 `completeDelegateAgent` 仍保留为旧显式授权形态的兼容别名。新接入优先使用 `delegateToken`。

## Scope 怎么选

直接使用 scope 字符串，让业务代码里能看见本次 Agent 请求的最小授权边界。

| 场景 | 推荐 scope | 用户能理解的描述 |
| --- | --- | --- |
| 读取用户记忆 | `gumem.memory:read` | Agent 可以读取与你相关的历史偏好。 |
| 写入任务结果 | `gumem.message:write`, `gumem.action:write` | Agent 可以把本次确认过的结果写回 GUMem。 |
| 搜索公开网页 | `webagent.web_search:run`, `webagent.web_search:read` | Agent 可以搜索公开网页并读取结果。 |
| 执行网页任务 | `webagent.do_anything:session`, `webagent.do_anything:run`, `webagent.do_anything:events` | Agent 可以执行一次有边界的网页任务，并展示执行过程。 |
| 创建长期监控 | `webagent.track:monitor_create`, `webagent.track:events` | Agent 可以按规则监控指定页面变化。 |

低风险能力通常可以静默授权，例如读取当前用户自己的 GUMem、写入本次会话摘要、搜索公开网页、读取普通任务结果。

高风险能力建议显式授权，例如接管浏览器、请求或确认外部站点登录、创建长期监控、提交表单、读取浏览器画面/录屏/附件/研究产物等敏感内容。

## 能力示例

### GUMem

```ts
await eak.gumem.createSession({
  token,
  userId: "user_1",
  sessionId: "account-research",
  title: "客户调研",
});

await eak.gumem.addMessages({
  token,
  sessionId: "account-research",
  messages: [
    {
      role: "assistant",
      content: "客户偏好简洁的实施 checklist。",
    },
  ],
});

const context = await eak.gumem.recall({
  token,
  sessionId: "account-research",
  query: "会前需要记住哪些用户偏好？",
  details: true,
});
```

### Web Search

```ts
const search = await eak.webSearch.run<{ id: string }>({
  token,
  query: "example.com 最新产品更新",
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
  instruction: "对比两个价格页，返回发生变化的套餐。",
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
  reason: "用户停止任务",
});
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

GenAuth 与 EAK 管理面调用使用 GenAuth access token。GUMem/WebAgent/Track 等运行时能力使用 `delegateToken` 返回的 token。

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
| 委托授权 | `delegateToken`；兼容别名：`delegateAgent`, `completeDelegateAgent` |
| EAK | `workspaces.list`, `workspaces.get`, `workspaces.create`, `workspaces.update`, `credentials.list`, `credentials.create`, `credentials.rotate`, `credentials.update` |
| GenAuth | `userInfo`, `jwks`, `discovery`, `introspectDelegationToken` |
| GUMem | `createSession`, `addMessages`, `recall`, `uploadResource`, `actions.record`, `actions.recall`, `actions.stream` |
| Web Search | `run`, `get`, `refine`, `events`, `cancel` |
| Do Anything | `run`, `createSession`, `createRun`, `getRun`, `events`, `intervene`, `cancel`, `readArtifacts`, `readRecording` |
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

## 安全建议

- AK/SK 只保存在可信服务端。
- 不要把 delegation token 暴露给不可信客户端。
- 每次 Agent 行动只申请必要 scope。
- 浏览器接管、站点登录、长期监控、敏感产物访问优先使用 `interactive`。
- 在业务日志中记录 `auditId`、`requestId`、`traceId`，方便后续审计。
- 如果怀疑 AK/SK 泄露，应在 EAK Console 中轮换密钥。

## License

MIT
