import { describe, expect, it } from "vitest";
import {
  EAK,
  EAKEventTypes,
  EAKPermissionDeniedError,
  EAKScopes,
  EAKScopeBundles,
  EazoAgentKit,
  EzaoAgentKit,
  buildStringToSign,
} from "../src";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.`;
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("EzaoAgentKit", () => {
  it("keeps EzaoAgentKit as the public constructor and EAK/EazoAgentKit as compatibility aliases", () => {
    expect(EzaoAgentKit.name).toBe("EzaoAgentKit");
    expect(EAK).toBe(EzaoAgentKit);
    expect(EazoAgentKit).toBe(EzaoAgentKit);
    expect(EzaoAgentKit).toBe(EazoAgentKit);
  });

  it("signs delegateToken requests with accessKey/secretKey and returns token", async () => {
    const seen: { url?: string; init?: RequestInit; body?: unknown } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      genauthBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.init = init;
        seen.body = JSON.parse(String(init?.body));
        return jsonResponse({
          data: {
            mode: "silent",
            tokenType: "Bearer",
            delegateAgentToken: "token",
            expiresIn: 3600,
            grantId: "grant",
            auditId: "audit",
          },
          meta: { requestId: "req_1" },
        });
      }) as typeof fetch,
    });

    const result = await client.delegateToken({
      user: { id: "user_1", subject: "user_1", name: "Test User" },
      agent: { id: "research-assistant", name: "Research Assistant" },
      scopes: EAKScopeBundles.AGENT_DO_ANYTHING_BASIC,
      mode: "silent",
    });

    expect(seen.url).toBe("https://eak.example.com/api/v3/eak/delegations");
    expect(seen.init?.method).toBe("POST");
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^authing ak_test:/);
    expect(headers["x-authing-signature-method"]).toBe("HMAC-SHA1");
    expect(seen.body).toMatchObject({
      user: { id: "user_1", subject: "user_1", name: "Test User" },
      agent: { id: "research-assistant", name: "Research Assistant" },
    });
    expect(result.data).toMatchObject({ token: "token", delegateAgentToken: "token" });
    expect(result.meta).toEqual({ requestId: "req_1" });
  });

  it("can initialize with only EAK AK/SK and exposes currentUser at the top level", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.init = init;
        return jsonResponse({
          data: {
            id: "user_1",
            subject: "user_1",
            name: "Test User",
          },
        });
      }) as typeof fetch,
    });

    const user = await client.currentUser({ accessToken: "genauth-access-token" });

    expect(seen.url).toBe("https://eak.eazo.ai/oidc/me");
    expect((seen.init?.headers as Record<string, string>).authorization).toBe(
      "Bearer genauth-access-token",
    );
    expect(user.data).toMatchObject({ id: "user_1", subject: "user_1" });
  });

  it("uses the dashboard base path for default runtime discovery", async () => {
    const calls: string[] = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      fetch: (async (url: URL | RequestInfo) => {
        calls.push(String(url));
        if (String(url) === "https://eak.eazo.ai/dashboard/api/v3/eak/runtime-config") {
          return jsonResponse({
            data: {
              eakBaseUrl: "https://eak-runtime.example.com",
            },
          });
        }
        return jsonResponse({
          data: {
            token: "token",
            tokenType: "Bearer",
            expiresIn: 3600,
            grantId: "grant",
            auditId: "audit",
          },
        });
      }) as typeof fetch,
    });

    await client.delegateToken({
      userId: "user_1",
      agent: "support-assistant",
      scopes: ["gumem.memory:read"],
      mode: "silent",
    });

    expect(calls).toEqual([
      "https://eak.eazo.ai/dashboard/api/v3/eak/runtime-config",
      "https://eak-runtime.example.com/api/v3/eak/delegations",
    ]);
  });

  it("exposes delegateToken through the EAK namespace", async () => {
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      fetch: (async () =>
        jsonResponse({
          data: {
            token: "namespace-token",
            tokenType: "Bearer",
            expiresIn: 3600,
            grantId: "grant",
            auditId: "audit",
          },
        })) as typeof fetch,
    });

    const result = await client.eak.delegateToken({
      user: { id: "user_1" },
      agent: { id: "support-assistant", name: "Support Assistant" },
      scopes: [EAKScopes.GUMEM_MEMORY_READ],
      mode: "silent",
    });

    expect(result.data).toMatchObject({
      token: "namespace-token",
      delegateAgentToken: "namespace-token",
    });
  });

  it("treats GenAuth statusCode error envelopes as SDK errors", async () => {
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      fetch: (async () =>
        jsonResponse({
          statusCode: 403,
          message: "scope is not allowed",
          requestId: "req_denied",
        })) as typeof fetch,
    });

    await expect(
      client.delegateToken({
        user: { id: "user_1" },
        agent: "do_anything",
        scopes: [EAKScopes.GUMEM_MEMORY_READ],
        mode: "silent",
      }),
    ).rejects.toMatchObject({
      name: "EAKPermissionDeniedError",
      status: 403,
      requestId: "req_denied",
    });
  });

  it("preserves GenAuth apiCode fields from statusCode error envelopes", async () => {
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      fetch: (async () =>
        jsonResponse({
          statusCode: 403,
          apiCode: "eak.delegation.user_not_bound",
          message: "userId is not valid for this EAK credential",
          requestId: "req_user_not_bound",
        })) as typeof fetch,
    });

    await expect(
      client.delegateToken({
        user: { id: "missing_user" },
        agent: "memory_agent",
        scopes: [EAKScopes.GUMEM_MEMORY_READ],
        mode: "silent",
      }),
    ).rejects.toMatchObject({
      name: "EAKPermissionDeniedError",
      code: "eak.delegation.user_not_bound",
      message: "userId is not valid for this EAK credential",
      status: 403,
      requestId: "req_user_not_bound",
    });
  });

  it("keeps delegateAgent and completeDelegateAgent as deprecated compatibility aliases", async () => {
    const seen: { body?: unknown } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      genauthBaseUrl: "https://eak.example.com",
      fetch: (async (_url: URL | RequestInfo, init?: RequestInit) => {
        seen.body = JSON.parse(String(init?.body));
        return jsonResponse({
          data: {
            mode: "interactive",
            tokenType: "Bearer",
            delegateAgentToken: "token_interactive",
            expiresIn: 3600,
            grantId: "grant_1",
            auditId: "audit_1",
          },
        });
      }) as typeof fetch,
    });

    const result = await client.completeDelegateAgent({
      code: "code_1",
      state: "state_1",
    });
    const alias = client.delegateAgent({
      user: { id: "user_1" },
      agent: "compat_agent",
      scopes: [EAKScopes.GUMEM_MEMORY_READ],
      mode: "silent",
    });

    expect(seen.body).toEqual({ code: "code_1", state: "state_1" });
    expect(result.data.token).toBe("token_interactive");
    await expect(alias).resolves.toMatchObject({
      data: { token: "token_interactive", delegateAgentToken: "token_interactive" },
    });
  });

  it("exposes GenAuth helpers through the EAK gateway host", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      genauthBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.genauth.userInfo({ accessToken: "genauth-access-token" });
    await client.genauth.introspectDelegationToken({ token: "delegate-token" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://eak.example.com/oidc/me",
      "https://eak.example.com/api/v3/eak/delegations/introspect",
    ]);
    expect(calls[0].init?.method).toBe("GET");
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe(
      "Bearer genauth-access-token",
    );
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      token: "delegate-token",
    });
  });

  it("exchanges AK/SK for a GenAuth admin token before listing users", async () => {
    const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      genauthBaseUrl: "https://tenant-a.genauth.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: String(url), init, body });
        if (String(url) === "https://eak.example.com/api/v3/eak/genauth/admin-token") {
          return jsonResponse({
            data: {
              accessToken: "genauth-admin-token",
              tokenType: "Bearer",
              userPoolId: "up_1",
            },
          });
        }
        return jsonResponse({ data: { list: [{ userId: "user_1" }], totalCount: 1 } });
      }) as typeof fetch,
    });

    const result = await client.genauth.users.list({ page: 1, limit: 20 });

    expect(result.data).toMatchObject({ totalCount: 1 });
    expect(calls.map((call) => call.url)).toEqual([
      "https://eak.example.com/api/v3/eak/genauth/admin-token",
      "https://tenant-a.genauth.example.com/api/v3/list-users",
    ]);
    expect(calls[0].body).toEqual({});
    expect((calls[0].init?.headers as Record<string, string>).authorization).toMatch(
      /^authing ak_test:/,
    );
    expect(calls[1].init?.method).toBe("POST");
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBe(
      "Bearer genauth-admin-token",
    );
    expect((calls[1].init?.headers as Record<string, string>)["x-authing-userpool-id"]).toBe(
      "up_1",
    );
    expect(calls[1].body).toEqual({ options: { pagination: { page: 1, limit: 20 } } });
  });

  it("maps GenAuth user CRUD helpers to v3 management endpoints", async () => {
    const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      genauthBaseUrl: "https://tenant-a.genauth.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: String(url), init, body });
        if (String(url) === "https://eak.example.com/api/v3/eak/genauth/admin-token") {
          return jsonResponse({
            data: {
              accessToken: "genauth-admin-token",
              userPoolId: "up_1",
            },
          });
        }
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.genauth.users.get({ userId: "user_1" });
    await client.genauth.users.create({ username: "alice", password: "P@ssw0rd!" });
    await client.genauth.users.createBatch({
      users: [{ username: "bob", password: "P@ssw0rd!" }],
    });
    await client.genauth.users.update({ userId: "user_1", nickname: "Alice" });
    await client.genauth.users.deleteBatch({ userIds: ["user_1"] });

    expect(calls.map((call) => call.url)).toEqual([
      "https://eak.example.com/api/v3/eak/genauth/admin-token",
      "https://tenant-a.genauth.example.com/api/v3/get-user?userId=user_1",
      "https://tenant-a.genauth.example.com/api/v3/create-user",
      "https://tenant-a.genauth.example.com/api/v3/create-users-batch",
      "https://tenant-a.genauth.example.com/api/v3/update-user",
      "https://tenant-a.genauth.example.com/api/v3/delete-users-batch",
    ]);
    expect(calls[0].body).toEqual({});
    expect(calls[2].body).toEqual({ username: "alice", password: "P@ssw0rd!" });
    expect(calls[3].body).toEqual({
      list: [{ username: "bob", password: "P@ssw0rd!" }],
    });
    expect(calls[4].body).toEqual({ userId: "user_1", nickname: "Alice" });
    expect(calls[5].body).toEqual({ userIds: ["user_1"] });
  });

  it("caches one GenAuth management token for all user management helpers", async () => {
    const calls: string[] = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      genauthBaseUrl: "https://tenant-a.genauth.example.com",
      fetch: (async (url: URL | RequestInfo) => {
        calls.push(String(url));
        if (String(url) === "https://eak.example.com/api/v3/eak/genauth/admin-token") {
          return jsonResponse({
            data: {
              token: "cached-genauth-admin-token",
              userPoolId: "up_1",
            },
          });
        }
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.genauth.users.list();
    await client.genauth.users.list({ page: 2 });

    expect(calls).toEqual([
      "https://eak.example.com/api/v3/eak/genauth/admin-token",
      "https://tenant-a.genauth.example.com/api/v3/list-users",
      "https://tenant-a.genauth.example.com/api/v3/list-users",
    ]);
  });

  it("exposes EAK workspace and AK/SK management helpers without sending agent allowlists", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.eak.workspaces.list({ token: "genauth-access-token" });
    await client.eak.credentials.create({
      token: "genauth-access-token",
      eakTenantId: "eak_tnt_1",
      allowedScopes: [EAKScopes.GUMEM_MEMORY_READ],
      allowedAgents: ["do_anything"],
    } as any);

    expect(calls.map((call) => call.url)).toEqual([
      "https://eak.example.com/api/v3/eak/tenants",
      "https://eak.example.com/api/v3/eak/tenants/eak_tnt_1/credentials",
    ]);
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe(
      "Bearer genauth-access-token",
    );
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      allowedScopes: [EAKScopes.GUMEM_MEMORY_READ],
    });
  });

  it("discovers runtime service URLs from the configured host and routes calls to returned services", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://console.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url) === "https://console.example.com/api/v3/eak/runtime-config") {
          return jsonResponse({
            data: {
              eakBaseUrl: "https://eak-runtime.example.com",
              genauthBaseUrl: "https://tenant-a.genauth.example.com",
              gumemBaseUrl: "https://gumem.example.com/api",
              webAgentBaseUrl: "https://webagent.example.com",
            },
          });
        }
        if (String(url) === "https://eak-runtime.example.com/api/v3/eak/delegations") {
          return jsonResponse({
            data: {
              mode: "silent",
              tokenType: "Bearer",
              delegateAgentToken: token,
              expiresIn: 3600,
              grantId: "grant",
              auditId: "audit",
            },
          });
        }
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.delegateToken({
      user: { id: "user_1" },
      agent: "do_anything",
      scopes: [EAKScopes.GUMEM_MEMORY_READ],
      mode: "silent",
    });
    await client.gumem.recall({ token, sessionId: "default", query: "memory" });
    await client.doAnything.createSession({ token });

    expect(calls.map((call) => call.url)).toEqual([
      "https://console.example.com/api/v3/eak/runtime-config",
      "https://eak-runtime.example.com/api/v3/eak/delegations",
      "https://gumem.example.com/api/sessions/default/context?query=memory&details=false",
      "https://webagent.example.com/api/v1/projects/tenant_1/do_anything/sessions",
    ]);
    expect((calls[1].init?.headers as Record<string, string>).authorization).toMatch(
      /^authing ak_test:/,
    );
    expect((calls[1].init?.headers as Record<string, string>)["x-authing-date"]).toEqual(
      expect.any(String),
    );
  });

  it("exchanges EAK delegation tokens before calling Gumem", async () => {
    const delegationToken = jwt({
      token_type: "eak_delegation_token",
      aud: "genauth:token-exchange",
      eak_tenant_id: "eak_tnt_1",
    });
    const productToken = jwt({
      aud: "gumem",
      product_resource: { type: "gumem_project", id: "proj_1" },
    });
    const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      gumemBaseUrl: "https://gumem.example.com/api",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const body = init?.body
          ? init.body instanceof URLSearchParams
            ? Object.fromEntries(init.body.entries())
            : JSON.parse(String(init.body))
          : undefined;
        calls.push({ url: String(url), init, body });
        if (String(url) === "https://eak.example.com/api/v3/eak/token-exchange") {
          return jsonResponse({
            data: {
              accessToken: productToken,
              access_token: productToken,
              expiresIn: 3600,
              expires_in: 3600,
              tokenType: "Bearer",
              token_type: "Bearer",
            },
          });
        }
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.gumem.recall({ token: delegationToken, sessionId: "default", query: "memory" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://eak.example.com/api/v3/eak/token-exchange",
      "https://gumem.example.com/api/sessions/default/context?query=memory&details=false",
    ]);
    expect(calls[0].body).toEqual({
      subjectToken: delegationToken,
      resource: "gumem",
      scopes: ["gumem.memory:read"],
    });
    expect((calls[0].init?.headers as Record<string, string>).authorization).toMatch(
      /^authing ak_test:/,
    );
    expect((calls[1].init?.headers as Record<string, string>).authorization).toBe(
      `Bearer ${productToken}`,
    );
  });

  it("sends product access tokens directly to Gumem", async () => {
    const token = jwt({ aud: "gumem" });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      gumemBaseUrl: "https://gumem.example.com/api",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.gumem.recall({ token, sessionId: "default", query: "memory" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://gumem.example.com/api/sessions/default/context?query=memory&details=false",
    ]);
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
  });

  it("routes local EAK token exchanges through the EAK endpoint", async () => {
    const delegationToken = jwt({ token_type: "eak_delegation_token" });
    const productToken = jwt({ aud: "gumem" });
    const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "http://core.genauth.localhost:3000",
      eakBaseUrl: "http://core.genauth.localhost:3000",
      gumemBaseUrl: "https://gumem.example.com/api",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: String(url), init, body });
        if (String(url) === "http://127.0.0.1:3000/api/v3/eak/token-exchange") {
          return jsonResponse({ data: { accessToken: productToken, expiresIn: 3600 } });
        }
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.gumem.recall({ token: delegationToken, sessionId: "default", query: "memory" });

    expect(calls[0].url).toBe("http://127.0.0.1:3000/api/v3/eak/token-exchange");
    expect((calls[0].init?.headers as Record<string, string>).Host).toBe(
      "core.genauth.localhost:3000",
    );
    expect(calls[0].body).toEqual({
      subjectToken: delegationToken,
      resource: "gumem",
      scopes: ["gumem.memory:read"],
    });
  });

  it("requires product capability calls to receive an explicit token", async () => {
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      gumemBaseUrl: "https://gumem.example.com/api",
      fetch: (async () => jsonResponse({ data: { ok: true } })) as typeof fetch,
    });

    await expect(
      client.gumem.recall({ sessionId: "default", query: "memory" } as any),
    ).rejects.toMatchObject({
      name: "EAKDelegationRequiredError",
      code: "delegation.required",
      message: expect.stringContaining("token"),
    });
  });

  it("sends delegateToken output directly to WebAgent and derives the tenant from it", async () => {
    const token = jwt({
      aud: ["gumem", "webagent"],
      resource_bindings: { webagent: { tenant_id: "web_tnt_1" } },
    });
    const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://webagent.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const body = init?.body
          ? init.body instanceof URLSearchParams
            ? Object.fromEntries(init.body.entries())
            : JSON.parse(String(init.body))
          : undefined;
        calls.push({ url: String(url), init, body });
        return jsonResponse({ data: { id: "sess_1" } });
      }) as typeof fetch,
    });

    await client.doAnything.createSession({ token, instructions: "open docs" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://webagent.example.com/api/v1/projects/web_tnt_1/do_anything/sessions",
    ]);
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe(
      `Bearer ${token}`,
    );
  });

  it("matches GenAuth canonical string shape", () => {
    expect(
      buildStringToSign(
        "POST",
        "/api/v3/eak/delegations",
        {
          "x-authing-date": "1",
          "x-authing-signature-method": "HMAC-SHA1",
          "x-authing-signature-version": "1.0",
        },
        { b: "2", a: "1" },
      ),
    ).toBe(
      "POST\nx-authing-date:1\nx-authing-signature-method:HMAC-SHA1\nx-authing-signature-version:1.0\n/api/v3/eak/delegations?a=1&b=2",
    );
  });

  it("exports stable scope and event constants", () => {
    expect(EAKScopes.GUMEM_MEMORY_READ).toBe("gumem.memory:read");
    expect("GENAUTH_USER_LIST" in EAKScopes).toBe(false);
    expect(EAKScopes.WEBAGENT_DO_ANYTHING_EVENTS).toBe("webagent.do_anything:events");
    expect(EAKScopeBundles.GUMEM_SESSION_RECALL).toEqual([
      EAKScopes.GUMEM_MEMORY_READ,
      EAKScopes.GUMEM_MEMORY_WRITE,
      EAKScopes.GUMEM_MESSAGE_WRITE,
    ]);
    expect("GENAUTH_USER_ADMIN" in EAKScopeBundles).toBe(false);
    expect(EAKScopeBundles.AGENT_DO_ANYTHING_BASIC).toContain(EAKScopes.WEBAGENT_DO_ANYTHING_RUN);
    expect(EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME).toBe("browser_video_frame");
  });

  it("uses webagent_tenant_id from token for WebAgent calls", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.init = init;
        return jsonResponse({ data: { id: "run_1" } });
      }) as typeof fetch,
    });

    await client.doAnything.createRun({
      token,
      sessionId: "sess_1",
      instructions: "open the site",
    });

    expect(seen.url).toBe(
      "https://eak.example.com/api/v1/projects/tenant_1/do_anything/sessions/sess_1/runs",
    );
    expect((seen.init?.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(seen.init?.body))).toEqual({ instructions: "open the site" });
  });

  it("offers a doAnything.run helper that creates a session then a run", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        urls.push(String(url));
        bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
        if (String(url).endsWith("/do_anything/sessions")) {
          return jsonResponse({ data: { id: "sess_auto" } });
        }
        return jsonResponse({ data: { id: "run_auto" } });
      }) as typeof fetch,
    });

    const run = await client.doAnything.run({
      token,
      instruction: "open the docs",
      stream: { events: [EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME] },
    });

    expect(run.data).toMatchObject({ id: "run_auto", sessionId: "sess_auto" });
    expect(urls).toEqual([
      "https://eak.example.com/api/v1/projects/tenant_1/do_anything/sessions",
      "https://eak.example.com/api/v1/projects/tenant_1/do_anything/sessions/sess_auto/runs",
    ]);
    expect(bodies[1]).toMatchObject({
      instructions: "open the docs",
      stream: { events: [EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME] },
    });
  });

  it("maps webSearch query sugar to the backend queries contract", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { body?: unknown } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (_url: URL | RequestInfo, init?: RequestInit) => {
        seen.body = JSON.parse(String(init?.body));
        return jsonResponse({ data: { run_id: "run_1" } });
      }) as typeof fetch,
    });

    await client.webSearch.run({
      token,
      query: "EAK SDK",
      maxResultsPerQuery: 3,
      siteWhitelist: ["eazo.ai"],
    });

    expect(seen.body).toEqual({
      queries: ["EAK SDK"],
      max_results_per_query: 3,
      site_whitelist: ["eazo.ai"],
    });
  });

  it("parses SSE events including JSON, text, and last-event-id", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { headers?: Record<string, string> } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (_url: URL | RequestInfo, init?: RequestInit) => {
        seen.headers = init?.headers as Record<string, string>;
        return sseResponse(
          'id: 1\nevent: browser_video_frame\ndata: {"frame":"https://frame"}\n\nid: 2\nevent: final\ndata: done\n\n',
        );
      }) as typeof fetch,
    });

    const events = [];
    for await (const event of client.doAnything.events({
      token,
      sessionId: "sess_1",
      runId: "run_1",
      lastEventId: "0",
    })) {
      events.push(event);
    }

    expect(seen.headers?.["last-event-id"]).toBe("0");
    expect(events).toEqual([
      { id: "1", event: "browser_video_frame", data: { frame: "https://frame" } },
      { id: "2", event: "final", data: "done" },
    ]);
  });

  it("maps permission errors to typed SDK errors", async () => {
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      gumemBaseUrl: "https://eak.example.com",
      fetch: (async () =>
        jsonResponse(
          {
            detail: {
              code: "permission_denied",
              message: "missing scope",
              auditId: "audit_1",
            },
            requestId: "req_1",
          },
          { status: 403 },
        )) as typeof fetch,
    });

    await expect(
      client.gumem.recall({ token: "token", sessionId: "sess_1", query: "hello" }),
    ).rejects.toMatchObject({
      name: "EAKPermissionDeniedError",
      code: "permission_denied",
      status: 403,
      requestId: "req_1",
      auditId: "audit_1",
      retryable: false,
    } satisfies Partial<EAKPermissionDeniedError>);
  });

  it("supports unstable raw requests through EAK host without exposing service selection", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.init = init;
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    const result = await client.unstableRequest({
      method: "POST",
      path: "/api/webagent/deep_research/runs",
      token: "delegate-agent-token",
      body: { query: "research" },
    });

    expect(result.data).toEqual({ ok: true });
    expect(seen.url).toBe("https://eak.example.com/api/webagent/deep_research/runs");
    expect((seen.init?.headers as Record<string, string>).authorization).toBe(
      "Bearer delegate-agent-token",
    );
  });

  it("accepts camelCase GUMem input while sending the existing backend field names", async () => {
    const seen: { body?: unknown } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      gumemBaseUrl: "https://eak.example.com",
      fetch: (async (_url: URL | RequestInfo, init?: RequestInit) => {
        seen.body = JSON.parse(String(init?.body));
        return jsonResponse({ data: { id: "sess_1" } });
      }) as typeof fetch,
    });

    await client.gumem.createSession({
      token: "delegate-agent-token",
      userId: "user_1",
      sessionId: "default",
    });

    expect(seen.body).toEqual({ user_id: "user_1", session_id: "default" });
  });

  it("maps instruction sugar to the backend DoAnything instructions contract", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { body?: unknown } = {};
    const client = new EzaoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (_url: URL | RequestInfo, init?: RequestInit) => {
        seen.body = JSON.parse(String(init?.body));
        return jsonResponse({ data: { id: "run_1" } });
      }) as typeof fetch,
    });

    await client.doAnything.createRun({
      token,
      sessionId: "sess_1",
      instruction: "open the site",
    });

    expect(seen.body).toEqual({ instructions: "open the site" });
  });
});
