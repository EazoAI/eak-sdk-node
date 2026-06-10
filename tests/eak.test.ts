import { describe, expect, it } from "vitest";
import {
  EAK,
  EAKEventTypes,
  EAKPermissionDeniedError,
  EAKScopes,
  EAKScopeBundles,
  EazoAgentKit,
  buildStringToSign,
} from "../src";
import type { EAKOptions } from "../src";
import * as sdk from "../src";

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

describe("EazoAgentKit", () => {
  it("keeps EazoAgentKit as the public constructor and EAK as its alias", () => {
    expect(EazoAgentKit.name).toBe("EazoAgentKit");
    expect(EAK).toBe(EazoAgentKit);
    expect("EzaoAgentKit" in sdk).toBe(false);
  });

  it("signs delegateToken requests with accessKey/secretKey and returns token", async () => {
    const seen: { url?: string; init?: RequestInit; body?: unknown } = {};
    const client = new EazoAgentKit({
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
      agent: "research-assistant",
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
      agent: "research-assistant",
    });
    expect(result.data).toMatchObject({ token: "token", delegateAgentToken: "token" });
    expect(result.meta).toEqual({ requestId: "req_1" });
  });

  it("can initialize with only EAK AK/SK and exposes currentUser at the top level", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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

  it("preserves base paths returned by runtime config for signed JSON requests", async () => {
    const calls: string[] = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com/dashboard",
      fetch: (async (url: URL | RequestInfo) => {
        calls.push(String(url));
        if (String(url) === "https://eak.example.com/dashboard/api/v3/eak/runtime-config") {
          return jsonResponse({
            data: {
              eakBaseUrl: "https://eak-runtime.example.com/sdk",
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
      "https://eak.example.com/dashboard/api/v3/eak/runtime-config",
      "https://eak-runtime.example.com/sdk/api/v3/eak/delegations",
    ]);
  });

  it("exposes delegateToken through the EAK namespace", async () => {
    const client = new EazoAgentKit({
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
      agent: "support-assistant",
      scopes: [EAKScopes.GUMEM_MEMORY_READ],
      mode: "silent",
    });

    expect(result.data).toMatchObject({
      token: "namespace-token",
      delegateAgentToken: "namespace-token",
    });
  });

  it("creates interactive delegateToken grants without user or userId", async () => {
    const seen: { url?: string; init?: RequestInit; body?: unknown } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.init = init;
        seen.body = JSON.parse(String(init?.body));
        return jsonResponse({
          data: {
            mode: "interactive",
            authorizationUrl: "https://eak.example.com/authorize?grant_id=grant_interactive",
            grantId: "grant_interactive",
            grantState: "grant_state_1",
            requestedScopes: ["gumem.memory:read", "webagent.run"],
          },
          meta: { requestId: "req_interactive" },
        });
      }) as typeof fetch,
    });

    const result = await client.delegateToken({
      mode: "interactive",
      redirectUri: "https://app.example.com/eak/callback",
      state: "business_state_1",
      agent: "research-assistant",
      scopes: ["gumem.memory:read", "webagent.run"],
    });

    expect(seen.url).toBe("https://eak.example.com/api/v3/eak/delegations");
    expect(seen.init?.method).toBe("POST");
    expect(seen.body).toEqual({
      mode: "interactive",
      redirectUri: "https://app.example.com/eak/callback",
      state: "business_state_1",
      agent: "research-assistant",
      scopes: ["gumem.memory:read", "webagent.run"],
    });
    expect(result.data).toMatchObject({
      mode: "interactive",
      authorizationUrl: "https://eak.example.com/authorize?grant_id=grant_interactive",
      grantId: "grant_interactive",
      grantState: "grant_state_1",
      state: "grant_state_1",
      requestedScopes: ["gumem.memory:read", "webagent.run"],
    });
  });

  it("normalizes interactive delegateToken state into grantState and state", async () => {
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      fetch: (async () =>
        jsonResponse({
          data: {
            mode: "interactive",
            authorizationUrl: "https://eak.example.com/authorize?grant_id=grant_interactive",
            grantId: "grant_interactive",
            state: "legacy_state_1",
          },
        })) as typeof fetch,
    });

    const result = await client.delegateToken({
      mode: "interactive",
      redirectUri: "https://app.example.com/eak/callback",
      state: "business_state_1",
      agent: "research-assistant",
      scopes: ["gumem.memory:read"],
    });

    expect(result.data).toMatchObject({
      authorizationUrl: "https://eak.example.com/authorize?grant_id=grant_interactive",
      grantId: "grant_interactive",
      grantState: "legacy_state_1",
      state: "legacy_state_1",
    });
  });

  it("falls back interactive delegateToken state fields to grantId when upstream omits state", async () => {
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      fetch: (async () =>
        jsonResponse({
          data: {
            mode: "interactive",
            authorizationUrl: "https://eak.example.com/authorize?grant_id=grant_without_state",
            grantId: "grant_without_state",
          },
        })) as typeof fetch,
    });

    const result = await client.delegateToken({
      mode: "interactive",
      redirectUri: "https://app.example.com/eak/callback",
      state: "business_state_1",
      agent: "research-assistant",
      scopes: ["gumem.memory:read"],
    });

    expect(result.data).toMatchObject({
      grantId: "grant_without_state",
      grantState: "grant_without_state",
      state: "grant_without_state",
    });
  });

  it("returns mode-specific delegateToken result types", async () => {
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      fetch: (async () =>
        jsonResponse({
          data: {
            mode: "interactive",
            authorizationUrl: "https://eak.example.com/authorize?grant_id=grant_type",
            grantId: "grant_type",
          },
        })) as typeof fetch,
    });

    const interactive = await client.delegateToken({
      mode: "interactive",
      redirectUri: "https://app.example.com/eak/callback",
      state: "business_state_1",
      agent: "research-assistant",
      scopes: ["gumem.memory:read"],
    });

    const authorizationUrl: string = interactive.data.authorizationUrl;
    const grantState: string = interactive.data.grantState;
    const interactiveMode: "interactive" = interactive.data.mode;
    expect(authorizationUrl).toContain("grant_type");
    expect(grantState).toBe("grant_type");
    expect(interactiveMode).toBe("interactive");

    if (false) {
      const silent = await client.delegateToken({
        userId: "user_1",
        agent: "research-assistant",
        scopes: ["gumem.memory:read"],
      });
      const silentMode: "silent" = silent.data.mode;
      expect(silentMode).toBe("silent");
    }

    if (false) {
      // @ts-expect-error silent mode requires user or userId
      client.delegateToken({
        agent: "research-assistant",
        scopes: ["gumem.memory:read"],
        mode: "silent",
      });
      // @ts-expect-error omitted mode is silent and still requires user or userId
      client.delegateToken({
        agent: "research-assistant",
        scopes: ["gumem.memory:read"],
      });
      // @ts-expect-error interactive mode requires redirectUri and state
      client.delegateToken({
        mode: "interactive",
        agent: "research-assistant",
        scopes: ["gumem.memory:read"],
      });
      client.delegateToken({
        userId: "user_1",
        // @ts-expect-error agent must be a string id for the GenAuth delegation DTO
        agent: { id: "research-assistant", name: "Research Assistant" },
        scopes: ["gumem.memory:read"],
      });
    }
  });

  it("treats GenAuth statusCode error envelopes as SDK errors", async () => {
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
      // The backend message is preserved, with an actionable onboarding hint appended.
      message: expect.stringContaining("userId is not valid for this EAK credential"),
      status: 403,
      requestId: "req_user_not_bound",
    });
    await expect(
      client.delegateToken({
        user: { id: "missing_user" },
        agent: "memory_agent",
        scopes: [EAKScopes.GUMEM_MEMORY_READ],
        mode: "silent",
      }),
    ).rejects.toThrow(/resolveAnyBoundUser/);
  });

  it("keeps delegateAgent and completeDelegateAgent as deprecated compatibility aliases", async () => {
    const seen: { bodies: unknown[] } = { bodies: [] };
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      genauthBaseUrl: "https://eak.example.com",
      fetch: (async (_url: URL | RequestInfo, init?: RequestInit) => {
        seen.bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({
          data: {
            mode: "interactive",
            tokenType: "Bearer",
            token: "token_interactive",
            expiresIn: 3600,
            grantId: "grant_1",
            auditId: "audit_1",
          },
        });
      }) as typeof fetch,
    });

    const result = await client.completeDelegateAgent({
      grantId: "grant_1",
      code: "code_1",
      state: "state_1",
    });
    const alias = client.delegateAgent({
      user: { id: "user_1" },
      agent: "compat_agent",
      scopes: [EAKScopes.GUMEM_MEMORY_READ],
      mode: "silent",
    });

    expect(seen.bodies[0]).toEqual({ grantId: "grant_1", code: "code_1", state: "state_1" });
    expect(result.data).toMatchObject({
      token: "token_interactive",
      delegateAgentToken: "token_interactive",
    });
    await expect(alias).resolves.toMatchObject({
      data: { token: "token_interactive", delegateAgentToken: "token_interactive" },
    });
  });

  it("exposes completeDelegateToken as the recommended callback helper", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return jsonResponse({
          data: {
            token: `token_${calls.length}`,
            tokenType: "Bearer",
            expiresIn: 3600,
            grantId: "grant_1",
            auditId: "audit_1",
          },
        });
      }) as typeof fetch,
    });

    const result = await client.completeDelegateToken({
      grantId: "grant_1",
      code: "code_1",
      state: "state_1",
    });
    const namespaceResult = await client.eak.completeDelegateToken({
      grantId: "grant_2",
      code: "code_2",
      state: "state_2",
    });

    expect(calls).toEqual([
      {
        url: "https://eak.example.com/api/v3/eak/delegations/complete",
        body: { grantId: "grant_1", code: "code_1", state: "state_1" },
      },
      {
        url: "https://eak.example.com/api/v3/eak/delegations/complete",
        body: { grantId: "grant_2", code: "code_2", state: "state_2" },
      },
    ]);
    expect(result.data).toMatchObject({
      token: "token_1",
      delegateAgentToken: "token_1",
    });
    expect(namespaceResult.data).toMatchObject({
      token: "token_2",
      delegateAgentToken: "token_2",
    });

    if (false) {
      // @ts-expect-error current callback contract requires grantId
      client.completeDelegateToken({ code: "code_1", state: "state_1" });
    }
  });

  it("exposes GenAuth helpers through the EAK gateway host", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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

  it("uses configured service hosts instead of runtime-config service URLs", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://console.example.com",
      genauthHost: "https://configured.genauth.example.com",
      gumemHost: "https://configured.gumem.example.com/api",
      webAgentHost: "https://configured.webagent.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url) === "https://console.example.com/api/v3/eak/runtime-config") {
          return jsonResponse({
            data: {
              eakBaseUrl: "https://eak-runtime.example.com",
              genauthBaseUrl: "https://runtime.genauth.example.com",
              gumemBaseUrl: "https://runtime.gumem.example.com/api",
              webAgentBaseUrl: "https://runtime.webagent.example.com",
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
    await client.currentUser({ accessToken: "genauth-access-token" });
    await client.gumem.recall({
      token: jwt({ aud: "gumem" }),
      sessionId: "default",
      query: "memory",
    });
    await client.doAnything.createSession({ token });

    expect(calls.map((call) => call.url)).toEqual([
      "https://console.example.com/api/v3/eak/runtime-config",
      "https://eak-runtime.example.com/api/v3/eak/delegations",
      "https://configured.genauth.example.com/oidc/me",
      "https://configured.gumem.example.com/api/sessions/default/context?query=memory&details=false",
      "https://configured.webagent.example.com/api/v1/projects/tenant_1/do_anything/sessions",
    ]);
  });

  it("types service host overrides with a single camelCase spelling", () => {
    const options = {
      accessKey: "ak_test",
      secretKey: "sk_test",
      genauthHost: "https://configured.genauth.example.com",
      gumemHost: "https://configured.gumem.example.com/api",
      webAgentHost: "https://configured.webagent.example.com",
    } satisfies EAKOptions;

    expect(options.webAgentHost).toBe("https://configured.webagent.example.com");

    ({
      accessKey: "ak_test",
      secretKey: "sk_test",
      // @ts-expect-error service host overrides use camelCase names.
      GenauthHost: "https://configured.genauth.example.com",
    } satisfies EAKOptions);
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
    const client = new EazoAgentKit({
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

  it("surfaces upstream token exchange configuration errors in the thrown message", async () => {
    const delegationToken = jwt({
      token_type: "eak_delegation_token",
      aud: "genauth:token-exchange",
      eak_tenant_id: "eak_tnt_1",
    });
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      gumemBaseUrl: "https://gumem.example.com/api",
      fetch: (async () =>
        jsonResponse({
          statusCode: 400,
          code: "eak.token_exchange.upstream_failed",
          message: "OIDC token exchange failed",
          requestId: "req_token_exchange",
          details: {
            reason: "upstream_failed",
            upstreamStatus: 400,
            upstream: {
              error: "unauthorized_client",
              error_description: "grant_type is not enabled",
            },
          },
        })) as typeof fetch,
    });

    await expect(
      client.gumem.recall({ token: delegationToken, sessionId: "default", query: "memory" }),
    ).rejects.toMatchObject({
      name: "EAKValidationError",
      code: "eak.token_exchange.upstream_failed",
      status: 400,
      requestId: "req_token_exchange",
      message: expect.stringContaining("grant_type is not enabled"),
    });
  });

  it("sends product access tokens directly to Gumem", async () => {
    const token = jwt({ aud: "gumem" });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
    expect(EAKScopes.DO_ANYTHING_RUN).toBe("webagent.do_anything:run");
    expect(EAKScopes.DO_ANYTHING_READ).toBe("webagent.do_anything:read");
    expect(EAKScopes.DO_ANYTHING_STOP).toBe("webagent.do_anything:stop");
    expect(EAKScopes.DO_ANYTHING_CONTROL).toBe("webagent.do_anything:control");
    expect(EAKScopes.WEB_SEARCH_STOP).toBe("webagent.web_search:stop");
    expect(EAKScopes.DEEP_RESEARCH_CONTROL).toBe("webagent.deep_research:control");
    expect(EAKScopes.TRACK_MANAGE).toBe("webagent.track:manage");
    expect("WEBAGENT_TASK_RUN" in EAKScopes).toBe(false);
    expect("WEBAGENT_DO_ANYTHING_EVENTS" in EAKScopes).toBe(false);
    expect(EAKScopeBundles.GUMEM_SESSION_RECALL).toEqual([
      EAKScopes.GUMEM_MEMORY_READ,
      EAKScopes.GUMEM_MEMORY_WRITE,
      EAKScopes.GUMEM_MESSAGE_WRITE,
    ]);
    expect("GENAUTH_USER_ADMIN" in EAKScopeBundles).toBe(false);
    expect(EAKScopeBundles.AGENT_DO_ANYTHING_BASIC).toEqual([
      EAKScopes.DO_ANYTHING_RUN,
      EAKScopes.DO_ANYTHING_READ,
      EAKScopes.DO_ANYTHING_STOP,
      EAKScopes.DO_ANYTHING_CONTROL,
    ]);
    expect(EAKEventTypes.RUN_COMPLETED).toBe("run.completed");
  });

  it("uses canonical WebAgent scopes when exchanging delegation tokens", async () => {
    const delegationToken = jwt({
      token_type: "eak_delegation_token",
      aud: "genauth:token-exchange",
      eak_tenant_id: "eak_tnt_1",
    });
    const productToken = jwt({
      aud: "webagent",
      product_resource: { type: "webagent_tenant", id: "web_tnt_1" },
    });
    const exchanges: unknown[] = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      webAgentBaseUrl: "https://webagent.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        if (String(url) === "https://eak.example.com/api/v3/eak/token-exchange") {
          exchanges.push(JSON.parse(String(init?.body)));
          return jsonResponse({
            data: { accessToken: productToken, expiresIn: 3600 },
          });
        }
        return jsonResponse({ data: { id: "ok" } });
      }) as typeof fetch,
    });

    await client.doAnything.createRun({ token: delegationToken, sessionId: "sess_1", instruction: "open docs" });
    await client.doAnything.getRun({ token: delegationToken, sessionId: "sess_1", runId: "run_1" });
    await client.doAnything.cancel({ token: delegationToken, sessionId: "sess_1", runId: "run_1" });
    await client.doAnything.intervene({ token: delegationToken, sessionId: "sess_1", runId: "run_1", text: "continue" });
    await client.webSearch.run({ token: delegationToken, query: "EAK" });
    await client.webSearch.get({ token: delegationToken, runId: "search_1" });
    await client.webSearch.cancel({ token: delegationToken, runId: "search_1" });
    await client.track.createMonitor({ token: delegationToken, url: "https://example.com" });
    await client.track.getMonitor({ token: delegationToken, monitorId: "monitor_1" });
    await client.track.runNow({ token: delegationToken, monitorId: "monitor_1" });
    await client.track.deleteMonitor({ token: delegationToken, monitorId: "monitor_1" });
    await client.track.updateMonitor({ token: delegationToken, monitorId: "monitor_1", title: "updated" });

    expect(exchanges).toEqual([
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.do_anything:run"] },
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.do_anything:read"] },
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.do_anything:stop"] },
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.do_anything:control"] },
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.web_search:run"] },
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.web_search:read"] },
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.web_search:stop"] },
      // createMonitor → track:manage. getMonitor → track:read. runNow → track:run.
      // deleteMonitor + updateMonitor also need track:manage but reuse the cached
      // product token from createMonitor, so they trigger no further exchange.
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.track:manage"] },
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.track:read"] },
      { subjectToken: delegationToken, resource: "webagent", scopes: ["webagent.track:run"] },
    ]);
  });

  it("uses webagent_tenant_id from token for WebAgent calls", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EazoAgentKit({
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

  it("posts doAnything.intervene to the backend /interventions route", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.init = init;
        return jsonResponse({ data: { ok: true } });
      }) as typeof fetch,
    });

    await client.doAnything.intervene({
      token,
      sessionId: "sess_1",
      runId: "run_1",
      message: "please confirm",
    });

    expect(seen.url).toBe(
      "https://eak.example.com/api/v1/projects/tenant_1/do_anything/sessions/sess_1/runs/run_1/interventions",
    );
    expect(seen.init?.method).toBe("POST");
  });

  it("reads doAnything artifacts from the session-scoped /sessions/{id}/artifacts/{id} route", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.init = init;
        return jsonResponse({ data: { id: "artifact_1" } });
      }) as typeof fetch,
    });

    await client.doAnything.readArtifacts({ token, sessionId: "session_1", artifactId: "artifact_1" });

    expect(seen.url).toBe(
      "https://eak.example.com/api/v1/projects/tenant_1/do_anything/sessions/session_1/artifacts/artifact_1",
    );
    expect(seen.init?.method).toBe("GET");
  });

  it("offers a doAnything.run helper that creates a session then a run", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const client = new EazoAgentKit({
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
      stream: { events: [EAKEventTypes.RUN_SCREENSHOT] },
    });

    expect(run.data).toMatchObject({ id: "run_auto", session_id: "sess_auto" });
    expect(urls).toEqual([
      "https://eak.example.com/api/v1/projects/tenant_1/do_anything/sessions",
      "https://eak.example.com/api/v1/projects/tenant_1/do_anything/sessions/sess_auto/runs",
    ]);
    expect(bodies[1]).toMatchObject({
      instructions: "open the docs",
      stream: { events: [EAKEventTypes.RUN_SCREENSHOT] },
    });
  });

  it("maps webSearch query sugar to the backend queries contract", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { body?: unknown } = {};
    const client = new EazoAgentKit({
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
    const seen: { headers?: Record<string, string>; url?: string } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com/workspace",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
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

    expect(seen.url).toBe(
      "https://eak.example.com/workspace/api/v1/projects/tenant_1/do_anything/sessions/sess_1/runs/run_1/events",
    );
    expect(seen.headers?.["last-event-id"]).toBe("0");
    expect(events).toEqual([
      { id: "1", event: "browser_video_frame", data: { frame: "https://frame" } },
      { id: "2", event: "final", data: "done" },
    ]);
  });

  it("normalizes WebAgent run events: lifts envelope `type` to event.event", async () => {
    // Real backend frames carry no SSE `event:` line — the type is in the
    // envelope's `type` field. The SDK surfaces it as event.event.
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async () =>
        sseResponse(
          'id: 1\ndata: {"type":"run.action.started","task_id":"run_1","data":{"kind":"navigate"}}\n\n' +
            'id: 2\ndata: {"type":"run.completed","task_id":"run_1","data":{"output":"hi","terminal_reason":"done"}}\n\n',
        )) as typeof fetch,
    });

    const events = [];
    for await (const event of client.doAnything.events({
      token,
      sessionId: "sess_1",
      runId: "run_1",
    })) {
      events.push(event);
    }

    expect(events.map((e) => e.event)).toEqual([
      EAKEventTypes.RUN_ACTION_STARTED,
      EAKEventTypes.RUN_COMPLETED,
    ]);
    // data stays the full envelope (type / task_id / data all reachable).
    expect((events[1].data as { type: string }).type).toBe("run.completed");
    expect((events[1].data as { data: { output: string } }).data.output).toBe("hi");
  });

  it("auto-reconnects a dropped SSE stream and resumes from last-event-id", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const lastEventIds: (string | undefined)[] = [];
    let call = 0;
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      sseMaxRetries: 3,
      fetch: (async (_url: URL | RequestInfo, init?: RequestInit) => {
        const headers = (init?.headers || {}) as Record<string, string>;
        lastEventIds.push(headers["last-event-id"]);
        call += 1;
        if (call === 1) {
          // First connection: deliver one frame, then drop mid-stream. `pull`
          // (vs synchronous start) guarantees the frame is consumed before the
          // error, matching a real ECONNRESET after some events arrived.
          let pulls = 0;
          const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              if (pulls === 1) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'id: 1\ndata: {"type":"run.action.started","data":{}}\n\n',
                  ),
                );
              } else {
                controller.error(new Error("ECONNRESET"));
              }
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        // Reconnect: resume and complete.
        return sseResponse(
          'id: 2\ndata: {"type":"run.completed","data":{"output":"done"}}\n\n',
        );
      }) as typeof fetch,
    });

    const events = [];
    for await (const event of client.doAnything.events({
      token,
      sessionId: "sess_1",
      runId: "run_1",
    })) {
      events.push(event);
    }

    expect(call).toBe(2); // reconnected once
    expect(lastEventIds).toEqual([undefined, "1"]); // resumed from last id
    expect(events.map((e) => e.event)).toEqual([
      EAKEventTypes.RUN_ACTION_STARTED,
      EAKEventTypes.RUN_COMPLETED,
    ]);
  });

  it("events({ onlyTopLevel: true }) drops sub-run events", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async () =>
        sseResponse(
          'id: 1\ndata: {"type":"run.action.started","task_id":"run_1","data":{}}\n\n' +
            'id: 2\ndata: {"type":"run.subtask_started","task_id":"sub_1","data":{}}\n\n' +
            'id: 3\ndata: {"type":"run.action.started","task_id":"sub_1","data":{}}\n\n' +
            'id: 4\ndata: {"type":"run.completed","task_id":"run_1","data":{}}\n\n',
        )) as typeof fetch,
    });

    const ids: (string | undefined)[] = [];
    for await (const event of client.doAnything.events({
      token,
      sessionId: "sess_1",
      runId: "run_1",
      onlyTopLevel: true,
    })) {
      ids.push(event.id);
    }
    // Only the top-level run_1 events (1, 4) survive; sub_1 events (2, 3) dropped.
    expect(ids).toEqual(["1", "4"]);
  });

  it("reconnect recovers from a 401 by retrying with a refreshed token", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    let call = 0;
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      sseMaxRetries: 3,
      fetch: (async () => {
        call += 1;
        if (call === 1) {
          // deliver one frame, then drop mid-stream
          let pulls = 0;
          const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              if (pulls === 1) {
                controller.enqueue(
                  new TextEncoder().encode('id: 1\ndata: {"type":"run.action.started","data":{}}\n\n'),
                );
              } else controller.error(new Error("ECONNRESET"));
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        }
        if (call === 2) {
          // reconnect hits an expired-token 401 — retryable because a refresh is available
          return jsonResponse({ message: "token expired" }, { status: 401 });
        }
        // next reconnect (token refreshed) completes
        return sseResponse('id: 2\ndata: {"type":"run.completed","data":{}}\n\n');
      }) as typeof fetch,
    });

    const events = [];
    for await (const event of client.doAnything.events({
      token,
      sessionId: "sess_1",
      runId: "run_1",
    })) {
      events.push(event.event);
    }

    expect(call).toBe(3); // RST → reconnect(401) → reconnect(ok)
    expect(events).toEqual([EAKEventTypes.RUN_ACTION_STARTED, EAKEventTypes.RUN_COMPLETED]);
  });

  it("runAndWait drives a run to terminal and reports the settled outcome", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const actions: unknown[] = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith("/do_anything/sessions")) {
          return jsonResponse({ data: { id: "sess_1" } });
        }
        if (u.endsWith("/sessions/sess_1/runs") && init?.method === "POST") {
          return jsonResponse({ data: { run_id: "run_1", session_id: "sess_1" } });
        }
        // getRun (GET run-detail): the canonical envelope with cost / steps.
        if (u.endsWith("/sessions/sess_1/runs/run_1")) {
          return jsonResponse({
            data: {
              run_id: "run_1",
              session_id: "sess_1",
              terminal_reason: "done",
              is_task_successful: true,
              output: "the title",
              total_cost_usd: "0.42",
              step_count: 7,
            },
          });
        }
        // events SSE: one action, then terminal completion (leaner payload).
        return sseResponse(
          'id: 1\ndata: {"type":"run.action.started","data":{"kind":"navigate"}}\n\n' +
            'id: 2\ndata: {"type":"run.completed","data":{"terminal_reason":"done","output":"the title"}}\n\n',
        );
      }) as typeof fetch,
    });

    const result = await client.doAnything.runAndWait({
      token,
      instruction: "open the page and read the title",
      onAction: (payload) => {
        actions.push(payload.kind);
      },
    });

    expect(result).toMatchObject({
      runId: "run_1",
      sessionId: "sess_1",
      status: "succeeded",
      terminalReason: "done",
      isTaskSuccessful: true,
      output: "the title",
    });
    // #2: cost / steps are missing from the run.completed event but present on
    // result.raw because runAndWait settles from the getRun envelope.
    expect(result.raw?.total_cost_usd).toBe("0.42");
    expect(result.raw?.step_count).toBe(7);
    expect(actions).toEqual(["navigate"]);
  });

  it("resolveAnyBoundUser returns the first user from the bound userpool", async () => {
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      eakBaseUrl: "https://eak.example.com",
      genauthBaseUrl: "https://tenant-a.genauth.example.com",
      fetch: (async (url: URL | RequestInfo) => {
        if (String(url) === "https://eak.example.com/api/v3/eak/genauth/admin-token") {
          return jsonResponse({ data: { accessToken: "admin", userPoolId: "up_1" } });
        }
        return jsonResponse({ data: { list: [{ userId: "user_real_1" }], totalCount: 1 } });
      }) as typeof fetch,
    });

    expect(await client.resolveAnyBoundUser()).toBe("user_real_1");
  });

  it("maps permission errors to typed SDK errors", async () => {
    const client = new EazoAgentKit({
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

  it("surfaces denied scopes inline in the error message", async () => {
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      gumemBaseUrl: "https://eak.example.com",
      fetch: (async () =>
        jsonResponse(
          {
            detail: {
              code: "scope_not_delegated",
              message: "One or more scopes were not granted",
              details: { deniedScopes: ["webagent.deep_research:read"] },
            },
          },
          { status: 403 },
        )) as typeof fetch,
    });

    await expect(
      client.gumem.recall({ token: "token", sessionId: "sess_1", query: "hello" }),
    ).rejects.toThrow(/scopes not granted: webagent\.deep_research:read/);
  });

  it("supports unstable raw requests through EAK host without exposing service selection", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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
    const client = new EazoAgentKit({
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

  // -------------------------------------------------------------------------
  // WebSearch
  // -------------------------------------------------------------------------

  it("routes webSearch read/refine/cancel to the project-scoped run endpoints", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return jsonResponse({ data: { run_id: "run_1" } });
      }) as typeof fetch,
    });

    await client.webSearch.get({ token, runId: "run_1" });
    await client.webSearch.refine({ token, runId: "run_1", message: "narrow to 2025" });
    await client.webSearch.cancel({ token, runId: "run_1", reason: "duplicate" });

    const base = "https://eak.example.com/api/v1/projects/tenant_1/web_search/runs/run_1";
    expect(calls).toEqual([
      { url: base, method: "GET", body: undefined },
      { url: `${base}/messages`, method: "POST", body: { message: "narrow to 2025" } },
      { url: `${base}/cancel`, method: "POST", body: { reason: "duplicate" } },
    ]);
  });

  it("streams webSearch run events over SSE from the project-scoped endpoint", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.headers = init?.headers as Record<string, string>;
        return sseResponse(
          'id: 1\nevent: web_search_result\ndata: {"url":"https://eazo.ai"}\n\nid: 2\nevent: final\ndata: done\n\n',
        );
      }) as typeof fetch,
    });

    const events = [];
    for await (const event of client.webSearch.events({
      token,
      runId: "run_1",
      lastEventId: "0",
    })) {
      events.push(event);
    }

    expect(seen.url).toBe(
      "https://eak.example.com/api/v1/projects/tenant_1/web_search/runs/run_1/events",
    );
    expect(seen.headers?.["last-event-id"]).toBe("0");
    expect(events).toEqual([
      { id: "1", event: "web_search_result", data: { url: "https://eazo.ai" } },
      { id: "2", event: "final", data: "done" },
    ]);
  });

  // -------------------------------------------------------------------------
  // Track
  // -------------------------------------------------------------------------

  it("maps the full Track monitor lifecycle to the backend monitors contract", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return jsonResponse({ data: { id: "mon_1" } });
      }) as typeof fetch,
    });

    await client.track.createMonitor({
      token,
      url: "https://eazo.ai/pricing",
      instructions: "alert me when the price changes",
    });
    await client.track.getMonitor({ token, monitorId: "mon_1" });
    await client.track.runNow({ token, monitorId: "mon_1" });
    await client.track.updateMonitor({ token, monitorId: "mon_1", schedule: "0 9 * * *" });
    await client.track.deleteMonitor({ token, monitorId: "mon_1" });

    const monitors = "https://eak.example.com/api/v1/projects/tenant_1/track/monitors";
    expect(calls).toEqual([
      {
        url: monitors,
        method: "POST",
        body: {
          url: "https://eazo.ai/pricing",
          instructions: "alert me when the price changes",
        },
      },
      { url: `${monitors}/mon_1`, method: "GET", body: undefined },
      { url: `${monitors}/mon_1/run_now`, method: "POST", body: {} },
      { url: `${monitors}/mon_1`, method: "PATCH", body: { schedule: "0 9 * * *" } },
      { url: `${monitors}/mon_1`, method: "DELETE", body: undefined },
    ]);
  });

  it("streams Track monitor events over SSE", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.headers = init?.headers as Record<string, string>;
        return sseResponse('id: 7\nevent: track_change\ndata: {"changed":true}\n\n');
      }) as typeof fetch,
    });

    const events = [];
    for await (const event of client.track.events({
      token,
      monitorId: "mon_1",
      lastEventId: "6",
    })) {
      events.push(event);
    }

    expect(seen.url).toBe(
      "https://eak.example.com/api/v1/projects/tenant_1/track/monitors/mon_1/events",
    );
    expect(seen.headers?.["last-event-id"]).toBe("6");
    expect(events).toEqual([{ id: "7", event: "track_change", data: { changed: true } }]);
  });

  // -------------------------------------------------------------------------
  // DeepResearch
  // -------------------------------------------------------------------------

  it("creates a DeepResearch run and maps camelCase sugar to the backend contract", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; method?: string; body?: unknown } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.method = init?.method;
        seen.body = JSON.parse(String(init?.body));
        return jsonResponse({ data: { id: "dr_run_1" } }, { status: 202 });
      }) as typeof fetch,
    });

    const run = await client.deepResearch.run<{ id: string }>({
      token,
      topic: "state of EU battery recycling 2026",
      depth: "deep",
      outputFormat: "report",
      targetAudience: "investors",
      requireOutlineApproval: false,
      maxCostUsd: "5.00",
      maxDurationMinutes: 120,
      callbackUrl: "https://app.example.com/hooks/dr",
      domainWhitelist: ["eazo.ai"],
    });

    expect(run.data).toMatchObject({ id: "dr_run_1" });
    expect(seen.url).toBe(
      "https://eak.example.com/api/v1/projects/tenant_1/deep_research/runs",
    );
    expect(seen.method).toBe("POST");
    expect(seen.body).toEqual({
      topic: "state of EU battery recycling 2026",
      depth: "deep",
      output_format: "report",
      target_audience: "investors",
      require_outline_approval: false,
      max_cost_usd: "5.00",
      max_duration_minutes: 120,
      callback_url: "https://app.example.com/hooks/dr",
      domain_whitelist: ["eazo.ai"],
    });
  });

  it("routes DeepResearch run read/intervene/followUp/cancel/feedback to backend endpoints", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({
          url: String(url),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return jsonResponse({ data: { id: "dr_run_1" } });
      }) as typeof fetch,
    });

    await client.deepResearch.get({ token, runId: "dr_run_1" });
    await client.deepResearch.intervene({
      token,
      runId: "dr_run_1",
      requestId: "req_outline_1",
      response: "approve",
    });
    await client.deepResearch.followUp({
      token,
      runId: "dr_run_1",
      text: "also compare against 2025",
    });
    await client.deepResearch.cancel({ token, runId: "dr_run_1" });
    await client.deepResearch.feedback({
      token,
      runId: "dr_run_1",
      thumbs: "up",
      rating: 5,
      feedbackText: "thorough",
    });

    const base = "https://eak.example.com/api/v1/projects/tenant_1/deep_research/runs/dr_run_1";
    expect(calls).toEqual([
      { url: base, method: "GET", body: undefined },
      {
        url: `${base}/intervene`,
        method: "POST",
        body: { request_id: "req_outline_1", response: "approve" },
      },
      {
        url: `${base}/messages`,
        method: "POST",
        body: { text: "also compare against 2025" },
      },
      { url: `${base}/cancel`, method: "POST", body: {} },
      {
        url: `${base}/feedback`,
        method: "POST",
        body: { thumbs: "up", rating: 5, feedback_text: "thorough" },
      },
    ]);
  });

  it("reads DeepResearch artifacts from the project-scoped artifact endpoints", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const calls: Array<{ url: string; method?: string }> = [];
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method });
        return jsonResponse({ data: { items: [] } });
      }) as typeof fetch,
    });

    await client.deepResearch.listArtifacts({ token, runId: "dr_run_1" });
    await client.deepResearch.getArtifact({
      token,
      runId: "dr_run_1",
      artifactId: "art_1",
    });

    const base = "https://eak.example.com/api/v1/projects/tenant_1/deep_research/runs/dr_run_1";
    expect(calls).toEqual([
      { url: `${base}/artifacts`, method: "GET" },
      { url: `${base}/artifacts/art_1`, method: "GET" },
    ]);
  });

  it("streams DeepResearch run events over SSE", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      webAgentBaseUrl: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.headers = init?.headers as Record<string, string>;
        return sseResponse(
          'id: 1\nevent: run.input_request\ndata: {"request_id":"req_outline_1"}\n\nid: 2\nevent: final\ndata: done\n\n',
        );
      }) as typeof fetch,
    });

    const events = [];
    for await (const event of client.deepResearch.events({
      token,
      runId: "dr_run_1",
      lastEventId: "0",
    })) {
      events.push(event);
    }

    expect(seen.url).toBe(
      "https://eak.example.com/api/v1/projects/tenant_1/deep_research/runs/dr_run_1/events",
    );
    expect(seen.headers?.["last-event-id"]).toBe("0");
    expect(events).toEqual([
      { id: "1", event: "run.input_request", data: { request_id: "req_outline_1" } },
      { id: "2", event: "final", data: "done" },
    ]);
  });
});
