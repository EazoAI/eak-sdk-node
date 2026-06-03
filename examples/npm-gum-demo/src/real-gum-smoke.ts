import { EAKScopes, EzaoAgentKit } from "@eazo/eak";

const required = [
  "EAK_ACCESS_KEY",
  "EAK_SECRET_KEY",
  "EAK_USER_ID",
] as const;

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

const eak = new EzaoAgentKit({
  accessKey: process.env.EAK_ACCESS_KEY!,
  secretKey: process.env.EAK_SECRET_KEY!,
  host: process.env.EAK_HOST,
  timeoutMs: Number(process.env.EAK_TIMEOUT_MS || 30_000),
});

const sessionId = process.env.EAK_GUM_SESSION_ID || `npm-gum-real-${Date.now()}`;
const userId = process.env.EAK_USER_ID!;
const agentId = process.env.EAK_AGENT_ID || "memory-agent";

const delegation = await eak.delegateToken({
  userId,
  agent: agentId,
  scopes: [
    EAKScopes.GUMEM_MEMORY_READ,
    EAKScopes.GUMEM_MEMORY_WRITE,
    EAKScopes.GUMEM_MESSAGE_WRITE,
  ],
  mode: "silent",
});

if ("authorizationUrl" in delegation.data) {
  throw new Error(`Silent delegation was not granted. Open: ${delegation.data.authorizationUrl}`);
}

const token = delegation.data.token;

const created = await eak.gumem.createSession({
  token,
  userId,
  sessionId,
  title: "Published SDK GUM smoke",
  metadata: { source: "examples/npm-gum-demo", mode: "real" },
});

const message = await eak.gumem.addMessages({
  token,
  userId,
  sessionId,
  messages: [
    {
      role: "user",
      content: "Remember that this was written by the published @eazo/eak npm demo.",
    },
  ],
  sync: true,
});

const recalled = await eak.gumem.recall({
  token,
  sessionId,
  query: "What did the published @eazo/eak npm demo ask GUMem to remember?",
  details: true,
});

console.log(JSON.stringify({
  ok: true,
  sessionId,
  created: created.data,
  message: message.data,
  recalled: recalled.data,
  meta: {
    delegation: delegation.meta,
    created: created.meta,
    message: message.meta,
    recalled: recalled.meta,
  },
}, null, 2));
