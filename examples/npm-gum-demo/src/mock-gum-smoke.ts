import { EAKScopes, EzaoAgentKit } from "@eazo/eak";

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
};

type JsonRecord = Record<string, unknown>;

const host = "https://console.example.test/dashboard";
const eakRuntime = "https://eak-runtime.example.test";
const gumemRuntime = "https://gumem.example.test/api";
const gumemApiSessions = "https://gumem.example.test/api/sessions";
const sessionId = `gum-demo-${Date.now()}`;
const delegationToken = jwt({
  token_type: "eak_delegation_token",
  aud: "genauth:token-exchange",
  eak_tenant_id: "eak_tnt_demo",
  sub: "user_demo_1",
});
const gumemWriteToken = jwt({
  aud: "gumem",
  product_resource: { type: "gumem_project", id: "gumem_project_demo" },
  scope: "gumem.memory:write",
});
const gumemReadToken = jwt({
  aud: "gumem",
  product_resource: { type: "gumem_project", id: "gumem_project_demo" },
  scope: "gumem.memory:read",
});

const calls: FetchCall[] = [];

const eak = new EzaoAgentKit({
  accessKey: "ak_demo",
  secretKey: "sk_demo",
  host,
  fetch: mockFetch,
});

const delegation = await eak.delegateToken({
  userId: "user_demo_1",
  agent: "memory-agent",
  scopes: [
    EAKScopes.GUMEM_MEMORY_READ,
    EAKScopes.GUMEM_MEMORY_WRITE,
    EAKScopes.GUMEM_MESSAGE_WRITE,
  ],
  mode: "silent",
});

if ("authorizationUrl" in delegation.data) {
  throw new Error("Expected silent delegation token, received interactive authorization.");
}

const token = delegation.data.token;

const created = await eak.gumem.createSession<{ id: string; user_id: string; session_id: string }>({
  token,
  userId: "user_demo_1",
  sessionId,
  title: "NPM SDK GUM demo",
  metadata: { source: "examples/npm-gum-demo", mode: "mock" },
});

await eak.gumem.addMessages({
  token,
  userId: "user_demo_1",
  sessionId,
  messages: [
    {
      role: "user",
      content: "Remember that this npm smoke demo validates the GUMem flow.",
    },
    {
      role: "assistant",
      content: "The SDK should exchange EAK delegation tokens before GUMem calls.",
    },
  ],
  sync: true,
});

const recalled = await eak.gumem.recall<{
  projectId: string;
  userId: string;
  sessionId: string;
  context: string[];
}>({
  token,
  sessionId,
  query: "What should the agent remember about this SDK demo?",
  details: true,
});

assert(created.data.session_id === sessionId, "createSession response session_id mismatch.");
assert(recalled.data.projectId === "gumem_project_demo", "recall project id mismatch.");
assert(recalled.data.userId === "user_demo_1", "recall user id mismatch.");
assert(recalled.data.context.length > 0, "recall context should not be empty.");
assertCallSequence(calls);

console.log(JSON.stringify({
  ok: true,
  package: "@eazo/eak",
  sessionId,
  gumemProjectId: recalled.data.projectId,
  requestCount: calls.length,
  exchangedResources: calls
    .filter((call) => call.url.endsWith("/api/v3/eak/token-exchange"))
    .map((call) => call.body),
}, null, 2));

async function mockFetch(input: URL | RequestInfo, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const parsedUrl = new URL(url);
  const method = init?.method || "GET";
  const body = parseBody(init?.body);
  const headers = normalizeHeaders(init?.headers);
  calls.push({ url, method, headers, body });

  if (url === `${host}/api/v3/eak/runtime-config` && method === "GET") {
    assert(headers.authorization?.startsWith("authing ak_demo:"), "runtime-config must be signed.");
    return json({
      data: {
        eakBaseUrl: eakRuntime,
        gumemBaseUrl: gumemRuntime,
      },
      meta: { requestId: "req_runtime_config" },
    });
  }

  if (url === `${eakRuntime}/api/v3/eak/delegations` && method === "POST") {
    assert(headers.authorization?.startsWith("authing ak_demo:"), "delegateToken must be signed.");
    assert(isJsonRecord(body), "delegateToken body should be JSON.");
    assert(body.userId === "user_demo_1", "delegateToken should preserve userId.");
    assert(body.agent === "memory-agent", "delegateToken should preserve string agent id.");
    return json({
      data: {
        mode: "silent",
        tokenType: "Bearer",
        token: delegationToken,
        expiresIn: 3600,
        grantId: "grant_demo",
        auditId: "audit_demo",
      },
      meta: { requestId: "req_delegation" },
    });
  }

  if (url === `${eakRuntime}/api/v3/eak/token-exchange` && method === "POST") {
    assert(headers.authorization?.startsWith("authing ak_demo:"), "token exchange must be signed.");
    assert(isJsonRecord(body), "token exchange body should be JSON.");
    assert(body.subjectToken === delegationToken, "token exchange should use delegation token.");
    assert(body.resource === "gumem", "token exchange resource should be gumem.");
    const scopes = body.scopes;
    assert(Array.isArray(scopes), "token exchange scopes should be an array.");
    const accessToken = scopes.includes(EAKScopes.GUMEM_MEMORY_READ)
      ? gumemReadToken
      : gumemWriteToken;
    return json({
      data: {
        accessToken,
        tokenType: "Bearer",
        expiresIn: 3600,
      },
      meta: { requestId: `req_exchange_${scopes.join("_")}` },
    });
  }

  if (parsedUrl.origin === "https://gumem.example.test" && parsedUrl.pathname === "/api/sessions" && method === "POST") {
    assert(headers.authorization === `Bearer ${gumemWriteToken}`, "createSession should use GUMem write token.");
    assert(isJsonRecord(body), "createSession body should be JSON.");
    assert(body.user_id === "user_demo_1", "createSession should translate userId to user_id.");
    assert(body.session_id === sessionId, "createSession should translate sessionId to session_id.");
    return json({
      data: { id: "gum_session_demo", user_id: body.user_id, session_id: body.session_id },
      meta: { requestId: "req_create_session" },
    });
  }

  if (parsedUrl.origin === "https://gumem.example.test" && parsedUrl.pathname === `/api/sessions/${encodeURIComponent(sessionId)}/messages` && method === "POST") {
    assert(headers.authorization === `Bearer ${gumemWriteToken}`, "addMessages should reuse GUMem write token.");
    assert(isJsonRecord(body), "addMessages body should be JSON.");
    assert(Array.isArray(body.messages), "addMessages should send messages.");
    assert(body.user_id === "user_demo_1", "addMessages should translate userId to user_id.");
    return json({ data: { accepted: true }, meta: { requestId: "req_add_messages" } });
  }

  if (parsedUrl.origin === "https://gumem.example.test" && parsedUrl.pathname === `/api/sessions/${encodeURIComponent(sessionId)}/context` && method === "POST") {
    assert(parsedUrl.searchParams.get("query") === "What should the agent remember about this SDK demo?", "recall should send the query.");
    assert(parsedUrl.searchParams.get("details") === "true", "recall should request details.");
    assert(headers.authorization === `Bearer ${gumemReadToken}`, "recall should use GUMem read token.");
    return json({
      data: {
        projectId: "gumem_project_demo",
        userId: "user_demo_1",
        sessionId,
        context: [
          "This npm smoke demo validates runtime discovery, delegation, token exchange, and GUMem recall.",
        ],
      },
      meta: { requestId: "req_recall" },
    });
  }

  return json({ message: `Unexpected request: ${method} ${url}` }, { status: 500 });
}

function assertCallSequence(seen: FetchCall[]) {
  const labels = seen.map((call) => `${call.method} ${call.url}`);
  const actual = labels.join("\n");
  assert(labels[0] === `GET ${host}/api/v3/eak/runtime-config`, `runtime discovery should happen first.\n${actual}`);
  assert(labels[1] === `POST ${eakRuntime}/api/v3/eak/delegations`, `delegateToken should use runtime eakBaseUrl.\n${actual}`);
  assert(labels[2] === `POST ${eakRuntime}/api/v3/eak/token-exchange`, `createSession should exchange token.\n${actual}`);
  assert(labels[3] === `POST ${gumemApiSessions}`, `createSession should call GUMem.\n${actual}`);
  assert(labels[4] === `POST ${gumemApiSessions}/${encodeURIComponent(sessionId)}/messages`, `addMessages should call GUMem.\n${actual}`);
  assert(labels[5] === `POST ${eakRuntime}/api/v3/eak/token-exchange`, `recall should exchange read token.\n${actual}`);
  assert(labels[6]?.startsWith(`POST ${gumemApiSessions}/${encodeURIComponent(sessionId)}/context?`), `recall should call GUMem context endpoint.\n${actual}`);
}

function json(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: init?.status || 200,
    headers: { "content-type": "application/json" },
  });
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (!body) return undefined;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  return body;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jwt(payload: JsonRecord): string {
  return [
    base64Url({ alg: "none", typ: "JWT" }),
    base64Url(payload),
    "",
  ].join(".");
}

function base64Url(value: JsonRecord): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
