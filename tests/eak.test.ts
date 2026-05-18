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

describe("EazoAgentKit", () => {
  it("keeps EAK as an alias for the public EazoAgentKit entry and Ezao as a compatibility alias", () => {
    expect(EAK).toBe(EazoAgentKit);
    expect(EzaoAgentKit).toBe(EazoAgentKit);
  });

  it("signs delegateAgent requests with accessKey/secretKey and returns delegateAgentToken", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        seen.url = String(url);
        seen.init = init;
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

    const result = await client.delegateAgent({
      userId: "user_1",
      agent: { id: "research-assistant", name: "Research Assistant" },
      scopes: EAKScopeBundles.AGENT_DO_ANYTHING_BASIC,
      mode: "silent",
    });

    expect(seen.url).toBe("https://eak.example.com/api/v3/eak/delegations");
    expect(seen.init?.method).toBe("POST");
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^authing ak_test:/);
    expect(headers["x-authing-signature-method"]).toBe("HMAC-SHA1");
    expect(result.data).toMatchObject({ delegateAgentToken: "token" });
    expect(result.meta).toEqual({ requestId: "req_1" });
  });

  it("completes interactive delegateAgent grants", async () => {
    const seen: { body?: unknown } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
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
      grantId: "grant_1",
      code: "code_1",
      state: "state_1",
    });

    expect(seen.body).toEqual({ grantId: "grant_1", code: "code_1", state: "state_1" });
    expect(result.data.delegateAgentToken).toBe("token_interactive");
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
    expect(EAKScopes.WEBAGENT_DO_ANYTHING_EVENTS).toBe("webagent.do_anything:events");
    expect(EAKScopeBundles.AGENT_DO_ANYTHING_BASIC).toContain(EAKScopes.WEBAGENT_DO_ANYTHING_RUN);
    expect(EAKEventTypes.DO_ANYTHING_BROWSER_VIDEO_FRAME).toBe("browser_video_frame");
  });

  it("uses webagent_tenant_id from delegateAgentToken for WebAgent calls", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { url?: string; init?: RequestInit } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
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
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
      fetch: (async (url: URL | RequestInfo) => {
        urls.push(String(url));
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
  });

  it("parses SSE events including JSON, text, and last-event-id", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { headers?: Record<string, string> } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
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
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
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

  it("uses instruction as the standard DoAnything run field", async () => {
    const token = jwt({ webagent_tenant_id: "tenant_1" });
    const seen: { body?: unknown } = {};
    const client = new EazoAgentKit({
      accessKey: "ak_test",
      secretKey: "sk_test",
      host: "https://eak.example.com",
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

    expect(seen.body).toEqual({ instruction: "open the site" });
  });
});
