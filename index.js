import { EzaoAgentKit, EAKScopes } from "@eazo/eak";

const EAK_ACCESS_KEY = "eak_f97be141edaf0427a44e285a";
const EAK_SECRET_KEY = "UsdwGpM429R9MUz8a7IQBGQoTAixBRPjnuGUyubpgSw";
const EAK_HOST = "http://127.0.0.1:3100";
const EAK_USER_ID = "6a1e86cf77c781557ccbc8b9";
const EAK_AGENT = "research-assistant";

if (!EAK_ACCESS_KEY || !EAK_SECRET_KEY) {
  throw new Error("Please set EAK_ACCESS_KEY and EAK_SECRET_KEY before running this script.");
}

const agentKit = new EzaoAgentKit({
  accessKey: EAK_ACCESS_KEY,
  secretKey: EAK_SECRET_KEY,
  host: EAK_HOST,
});

const gumScopes = [
  EAKScopes.GUMEM_SESSION_CREATE,
  EAKScopes.GUMEM_MESSAGE_WRITE,
  EAKScopes.GUMEM_MEMORY_READ,
  EAKScopes.GUMEM_MEMORY_WRITE,
  EAKScopes.GUMEM_MEMORY_DELETE,
  EAKScopes.GUMEM_SEARCH_RUN,
  EAKScopes.GUMEM_ADMIN_MANAGE,
  EAKScopes.GUMEM_RESOURCE_WRITE,
  EAKScopes.GUMEM_ACTION_WRITE,
  EAKScopes.GUMEM_ACTION_READ,
  EAKScopes.GUMEM_PROFILE_READ,
];

const sessionId = `gum-sdk-demo-${Date.now()}`;

function printStep(title, response) {
  console.log(`\n=== ${title} ===`);
  console.dir(response?.data ?? response, { depth: 8 });
}

const main = async () => {
  const delegation = await agentKit.delegateToken({
    userId: EAK_USER_ID,
    agent: EAK_AGENT,
    scopes: gumScopes,
    mode: "silent",
  });
  printStep("Delegation successful", delegation);

  const token = delegation.data?.token;
  if (!token) {
    throw new Error("delegateToken response did not include token or delegateAgentToken.");
  }

  const session = await agentKit.gumem.createSession({
    token,
    userId: EAK_USER_ID,
    sessionId,
    title: "GUM SDK demo session",
  });
  printStep("GUM createSession", session);

  const messages = await agentKit.gumem.addMessages({
    token,
    userId: EAK_USER_ID,
    sessionId,
    sync: true,
    messages: [
      {
        role: "user",
        content: "我正在调研 EAK SDK 如何调用 GUM 记忆能力。",
      },
      {
        role: "assistant",
        content: "后续回答需要优先给出可执行的 SDK 调用示例。",
      },
    ],
  });
  printStep("GUM addMessages", messages);

  const context = await agentKit.gumem.recall({
    token,
    sessionId,
    query: "我在调研什么？后续回答应该注意什么？",
    details: true,
    recallConfig: {
      facts_top_k: 5,
      summaries_top_k: 3,
      message_recent_limit: 10,
    },
  });
  printStep("GUM recall session context", context);

  const action = await agentKit.gumem.actions.record({
    token,
    user_id: EAK_USER_ID,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    event_type: "sdk_demo",
    content: "User asked the EAK SDK demo to call Gum memory APIs.",
    metadata: {
      source: "eak-sdk-node/index.js",
      agent: EAK_AGENT,
    },
  });
  printStep("GUM actions.record", action);

  const actionRecall = await agentKit.gumem.actions.recall({
    token,
    user_id: EAK_USER_ID,
    session_id: sessionId,
    limit: 10,
  });
  printStep("GUM actions.recall", actionRecall);
}

main().catch((error) => {
  console.error("\nGUM demo failed:");
  console.error(error);
  process.exitCode = 1;
});
