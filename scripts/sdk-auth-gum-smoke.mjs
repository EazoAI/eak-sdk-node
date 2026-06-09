#!/usr/bin/env node
import { once } from "node:events";
import http from "node:http";
import { EAKScopes, EazoAgentKit } from "@eazo/eak";

const mode = process.argv.includes("--live") || process.env.EAK_SMOKE_MODE === "live"
  ? "live"
  : "mock";

const GUM_SCOPES = [
  EAKScopes.GUMEM_MEMORY_READ,
  EAKScopes.GUMEM_MEMORY_WRITE,
  EAKScopes.GUMEM_MESSAGE_WRITE,
  EAKScopes.GUMEM_ACTION_READ,
  EAKScopes.GUMEM_ACTION_WRITE,
  EAKScopes.GUMEM_RESOURCE_WRITE,
];

main().catch((error) => {
  console.error("[smoke] failed");
  console.error(error?.stack || error);
  process.exitCode = 1;
});

async function main() {
  if (mode === "live") {
    await runLiveSmoke();
    return;
  }
  await runMockSmoke();
}

async function runMockSmoke() {
  const state = {
    calls: [],
    tokenExchanges: [],
    sessions: new Map(),
  };
  const server = createMockEakServer(state);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const host = `http://127.0.0.1:${address.port}`;

  try {
    const eak = new EazoAgentKit({
      accessKey: "ak_smoke",
      secretKey: "sk_smoke",
      host,
      timeoutMs: 10_000,
    });

    const currentUser = await eak.currentUser({ accessToken: "genauth-access-token" });
    assertEqual(currentUser.data.id, "user_smoke", "currentUser resolves GenAuth user");

    const silentDelegation = await eak.delegateToken({
      mode: "silent",
      user: { id: "user_smoke", subject: "sub_smoke", name: "Smoke User" },
      agent: "memory-agent",
      scopes: GUM_SCOPES,
      expiresIn: 3600,
    });
    assert(!("authorizationUrl" in silentDelegation.data), "silent auth returns a token result");
    assert(silentDelegation.data.token, "silent auth includes token");

    const token = silentDelegation.data.token;
    const sessionId = `sdk-auth-gum-${Date.now()}`;
    await eak.gumem.createSession({
      token,
      userId: "user_smoke",
      sessionId,
      title: "SDK auth and GUM smoke",
      metadata: { source: "sdk-auth-gum-smoke", mode: "mock" },
    });
    await eak.gumem.addMessages({
      token,
      sessionId,
      userId: "user_smoke",
      sync: true,
      messages: [
        { role: "user", content: "remember that the SDK smoke covers GUM memory" },
        { role: "assistant", content: "acknowledged" },
      ],
    });
    const recall = await eak.gumem.recall({
      token,
      sessionId,
      query: "What does this smoke cover?",
      details: true,
      recallConfig: { topK: 3 },
      metadataFilters: { source: "sdk-auth-gum-smoke" },
    });
    assertEqual(recall.data.session_id, sessionId, "GUM recall uses the created session");

    const upload = await eak.gumem.uploadResource({
      token,
      userId: "user_smoke",
      sessionId,
      file: new Blob(["SDK smoke resource"], { type: "text/plain" }),
      filename: "sdk-smoke.txt",
      contentType: "text/plain",
    });
    assertEqual(upload.data.status, "uploaded", "GUM uploadResource returns uploaded status");

    await eak.gumem.actions.record({
      token,
      user_id: "user_smoke",
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      content: "User viewed the SDK auth and GUM smoke result.",
      event_type: "viewed",
      app: "@eazo/eak",
      platform: "node",
      page: "sdk-auth-gum-smoke",
      metadata: { target: "sdk-auth-gum-smoke" },
    });
    await eak.gumem.actions.recall({
      token,
      user_id: "user_smoke",
      query: "recent SDK smoke actions",
    });
    await eak.gumem.actions.stream({
      token,
      user_id: "user_smoke",
      limit: 5,
    });

    const interactive = await eak.delegateToken({
      mode: "interactive",
      redirectUri: "https://app.example.com/eak/callback",
      state: "business_state_smoke",
      agent: "memory-agent",
      scopes: [EAKScopes.GUMEM_MEMORY_READ, EAKScopes.GUMEM_MEMORY_WRITE],
    });
    assertMatch(
      interactive.data.authorizationUrl,
      /\/authorize\?grant_id=grant_interactive_smoke/,
      "interactive auth returns authorizationUrl",
    );
    assertEqual(
      interactive.data.grantState,
      "grant_state_interactive_smoke",
      "interactive auth normalizes grantState",
    );

    const completed = await eak.completeDelegateToken({
      grantId: interactive.data.grantId,
      code: "code_from_visible_callback",
      state: interactive.data.grantState,
    });
    assert(completed.data.token, "completeDelegateToken returns runtime token");
    await eak.gumem.recall({
      token: completed.data.token,
      sessionId,
      query: "Can completed visible auth read memory?",
    });

    const introspection = await eak.genauth.introspectDelegationToken({ token });
    assertEqual(introspection.data.active, true, "delegation introspection is active");

    assertCallsCoverMockFlow(state);
    console.log("[smoke] mock auth + GUM coverage passed");
    console.log(JSON.stringify({
      mode: "mock",
      host,
      calls: state.calls.length,
      tokenExchanges: state.tokenExchanges.length,
      covered: [
        "runtime-config",
        "currentUser",
        "silent delegateToken",
        "interactive delegateToken",
        "completeDelegateToken",
        "delegation introspection",
        "gumem.createSession",
        "gumem.addMessages",
        "gumem.recall",
        "gumem.uploadResource",
        "gumem.actions.record",
        "gumem.actions.recall",
        "gumem.actions.stream",
        "SDK-managed product token exchange",
      ],
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runLiveSmoke() {
  const accessKey = requiredEnv("EAK_ACCESS_KEY");
  const secretKey = requiredEnv("EAK_SECRET_KEY");
  const userId = requiredEnv("EAK_USER_ID");
  const host = process.env.EAK_HOST;
  const agent = process.env.EAK_AGENT_ID || "memory-agent";
  const sessionId = process.env.EAK_GUM_SESSION_ID || `sdk-auth-gum-${Date.now()}`;

  const eak = new EazoAgentKit({
    accessKey,
    secretKey,
    host,
    timeoutMs: Number(process.env.EAK_TIMEOUT_MS || 60_000),
  });

  if (process.env.EAK_USER_ACCESS_TOKEN) {
    const user = await eak.currentUser({ accessToken: process.env.EAK_USER_ACCESS_TOKEN });
    console.log("[smoke] currentUser ok", safeJson(user.data));
  }

  const silentDelegation = await eak.delegateToken({
    mode: "silent",
    user: { id: userId },
    agent,
    scopes: GUM_SCOPES,
    expiresIn: Number(process.env.EAK_DELEGATION_EXPIRES_IN || 3600),
  });
  if ("authorizationUrl" in silentDelegation.data) {
    throw new Error("live silent delegation unexpectedly returned authorizationUrl");
  }

  const token = silentDelegation.data.token;
  await eak.gumem.createSession({
    token,
    userId,
    sessionId,
    title: "SDK auth and GUM live smoke",
    metadata: { source: "sdk-auth-gum-smoke", mode: "live" },
  });
  await eak.gumem.addMessages({
    token,
    sessionId,
    userId,
    sync: true,
    messages: [
      { role: "user", content: "live smoke message from @eazo/eak" },
      { role: "assistant", content: "live smoke acknowledged" },
    ],
  });
  const recall = await eak.gumem.recall({
    token,
    sessionId,
    query: process.env.EAK_GUM_QUERY || "What has the live SDK smoke written?",
    details: true,
  });
  await eak.gumem.actions.record({
    token,
    user_id: userId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    content: "Live SDK smoke wrote a user action through GUMem.",
    event_type: "sdk_live_smoke",
    app: "@eazo/eak",
    platform: "node",
    page: "sdk-auth-gum-smoke",
    metadata: { target: sessionId },
  });
  await eak.gumem.actions.recall({
    token,
    user_id: userId,
    query: "sdk live smoke",
  });

  if (process.env.EAK_REDIRECT_URI) {
    const interactive = await eak.delegateToken({
      mode: "interactive",
      redirectUri: process.env.EAK_REDIRECT_URI,
      state: process.env.EAK_AUTH_STATE || `sdk-smoke-${Date.now()}`,
      agent,
      scopes: [EAKScopes.GUMEM_MEMORY_READ, EAKScopes.GUMEM_MEMORY_WRITE],
    });
    console.log("[smoke] interactive authorizationUrl", interactive.data.authorizationUrl);

    if (process.env.EAK_AUTH_CODE && process.env.EAK_AUTH_GRANT_ID && process.env.EAK_AUTH_GRANT_STATE) {
      const completed = await eak.completeDelegateToken({
        grantId: process.env.EAK_AUTH_GRANT_ID,
        code: process.env.EAK_AUTH_CODE,
        state: process.env.EAK_AUTH_GRANT_STATE,
      });
      await eak.gumem.recall({
        token: completed.data.token,
        sessionId,
        query: "Can completed visible auth read live memory?",
      });
      console.log("[smoke] completeDelegateToken ok");
    }
  }

  console.log("[smoke] live silent auth + GUM coverage passed");
  console.log(JSON.stringify({
    mode: "live",
    host: host || "default",
    agent,
    userId,
    sessionId,
    recall: safeJson(recall.data),
  }, null, 2));
}

function createMockEakServer(state) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const body = await readBody(request);
    const parsedBody = parseJsonBody(body);
    state.calls.push({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      body: parsedBody,
    });

    const baseUrl = `http://${request.headers.host}`;
    if (request.method === "GET" && url.pathname === "/api/v3/eak/runtime-config") {
      json(response, {
        data: {
          eakBaseUrl: baseUrl,
          genauthBaseUrl: baseUrl,
          gumemBaseUrl: `${baseUrl}/gumem`,
          webAgentBaseUrl: `${baseUrl}/webagent`,
        },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/oidc/me") {
      json(response, {
        data: {
          id: "user_smoke",
          subject: "sub_smoke",
          name: "Smoke User",
        },
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v3/eak/delegations") {
      if (parsedBody.mode === "interactive") {
        json(response, {
          data: {
            mode: "interactive",
            authorizationUrl: `${baseUrl}/authorize?grant_id=grant_interactive_smoke`,
            grantId: "grant_interactive_smoke",
            grantState: "grant_state_interactive_smoke",
            requestedScopes: parsedBody.scopes,
          },
          meta: { requestId: "req_interactive" },
        });
        return;
      }
      json(response, {
        data: {
          mode: "silent",
          tokenType: "Bearer",
          token: jwt({
            token_type: "eak_delegation_token",
            aud: "genauth:token-exchange",
            sub: parsedBody.userId,
            eak_tenant_id: "eak_tnt_smoke",
          }),
          expiresIn: 3600,
          grantId: "grant_silent_smoke",
          auditId: "audit_silent_smoke",
          grantedScopes: parsedBody.scopes,
        },
        meta: { requestId: "req_silent" },
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v3/eak/delegations/complete") {
      json(response, {
        data: {
          mode: "interactive",
          tokenType: "Bearer",
          delegateAgentToken: jwt({
            token_type: "eak_delegation_token",
            aud: "genauth:token-exchange",
            sub: "visible_user_smoke",
            eak_tenant_id: "eak_tnt_smoke",
          }),
          expiresIn: 3600,
          grantId: parsedBody.grantId,
          auditId: "audit_complete_smoke",
          grantedScopes: [EAKScopes.GUMEM_MEMORY_READ, EAKScopes.GUMEM_MEMORY_WRITE],
        },
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v3/eak/delegations/introspect") {
      json(response, {
        data: {
          active: true,
          sub: "user_smoke",
          scopes: GUM_SCOPES,
        },
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v3/eak/token-exchange") {
      state.tokenExchanges.push(parsedBody);
      const scopeKey = Array.isArray(parsedBody.scopes) ? parsedBody.scopes.join("_") : "none";
      json(response, {
        data: {
          accessToken: jwt({
            aud: parsedBody.resource,
            scope: Array.isArray(parsedBody.scopes) ? parsedBody.scopes.join(" ") : "",
            product_resource: { type: "gumem_project", id: "gum_proj_smoke" },
            token_id: `product_${parsedBody.resource}_${scopeKey}_${state.tokenExchanges.length}`,
          }),
          expiresIn: 3600,
          tokenType: "Bearer",
        },
      });
      return;
    }

    if (url.pathname === "/gumem/api/sessions" && request.method === "POST") {
      state.sessions.set(parsedBody.session_id, parsedBody);
      json(response, {
        data: {
          id: parsedBody.session_id,
          session_id: parsedBody.session_id,
          user_id: parsedBody.user_id,
        },
      });
      return;
    }

    const messageMatch = url.pathname.match(/^\/gumem\/api\/sessions\/([^/]+)\/messages$/);
    if (messageMatch && request.method === "POST") {
      json(response, {
        data: {
          session_id: decodeURIComponent(messageMatch[1]),
          accepted: Array.isArray(parsedBody.messages) ? parsedBody.messages.length : 0,
          sync: parsedBody.sync,
        },
      });
      return;
    }

    const recallMatch = url.pathname.match(/^\/gumem\/api\/sessions\/([^/]+)\/context$/);
    if (recallMatch && request.method === "POST") {
      json(response, {
        data: {
          session_id: decodeURIComponent(recallMatch[1]),
          query: url.searchParams.get("query"),
          details: url.searchParams.get("details") === "true",
          memories: [
            { content: "SDK smoke covers silent auth, visible auth, and GUM APIs." },
          ],
          body: parsedBody,
        },
      });
      return;
    }

    if (url.pathname === "/gumem/api/resources" && request.method === "POST") {
      json(response, {
        data: {
          status: "uploaded",
          contentType: request.headers["content-type"],
          bytes: body.length,
        },
      });
      return;
    }

    if (url.pathname === "/gumem/api/user/actions" && request.method === "POST") {
      json(response, {
        data: {
          recorded: true,
          action: parsedBody.event_type,
          target: parsedBody.metadata?.target,
        },
      });
      return;
    }

    if (url.pathname === "/gumem/api/user/actions/query" && request.method === "GET") {
      json(response, {
        data: {
          results: [{ action: "viewed", target: "sdk-auth-gum-smoke" }],
          query: url.searchParams.get("query"),
        },
      });
      return;
    }

    if (url.pathname === "/gumem/api/user/actions/stream" && request.method === "GET") {
      json(response, {
        data: {
          events: [{ action: "viewed", target: "sdk-auth-gum-smoke" }],
          limit: Number(url.searchParams.get("limit") || 0),
        },
      });
      return;
    }

    json(response, { statusCode: 404, message: `No mock route for ${request.method} ${url.pathname}` }, 404);
  });
}

function assertCallsCoverMockFlow(state) {
  const paths = state.calls.map((call) => `${call.method} ${call.path}`);
  for (const expected of [
    "GET /api/v3/eak/runtime-config",
    "GET /oidc/me",
    "POST /api/v3/eak/delegations",
    "POST /api/v3/eak/delegations/complete",
    "POST /api/v3/eak/delegations/introspect",
    "POST /api/v3/eak/token-exchange",
    "POST /gumem/api/sessions",
    "POST /gumem/api/resources",
    "POST /gumem/api/user/actions",
    "GET /gumem/api/user/actions/query",
    "GET /gumem/api/user/actions/stream",
  ]) {
    assert(paths.includes(expected), `covered ${expected}`);
  }

  assert(
    paths.some((path) => path.startsWith("POST /gumem/api/sessions/") && path.endsWith("/messages")),
    "covered gumem.addMessages",
  );
  assert(
    paths.some((path) => path.startsWith("POST /gumem/api/sessions/") && path.endsWith("/context")),
    "covered gumem.recall",
  );

  const writeExchange = state.tokenExchanges.find((exchange) =>
    Array.isArray(exchange.scopes) && exchange.scopes.includes(EAKScopes.GUMEM_MEMORY_WRITE)
  );
  const readExchange = state.tokenExchanges.find((exchange) =>
    Array.isArray(exchange.scopes) && exchange.scopes.includes(EAKScopes.GUMEM_MEMORY_READ)
  );
  assert(writeExchange, "covered write-scope product token exchange");
  assert(readExchange, "covered read-scope product token exchange");

  const gumCalls = state.calls.filter((call) => call.path.startsWith("/gumem/"));
  for (const call of gumCalls) {
    assertMatch(call.authorization || "", /^Bearer /, `GUM call has bearer token: ${call.method} ${call.path}`);
  }
}

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

function json(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseJsonBody(body) {
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return { rawBodyBytes: body.length };
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (value?.trim()) return value;
  throw new Error(`${name} is required for live SDK smoke`);
}

function assert(value, message) {
  if (!value) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertMatch(actual, pattern, message) {
  if (!pattern.test(String(actual))) {
    throw new Error(`Assertion failed: ${message}; ${JSON.stringify(actual)} does not match ${pattern}`);
  }
}

function safeJson(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === "string" && item.length > 80) return `${item.slice(0, 24)}...${item.slice(-8)}`;
    return item;
  }));
}
