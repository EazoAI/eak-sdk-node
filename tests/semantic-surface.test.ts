import { describe, expect, it } from "vitest";
import {
  EAKError,
  EAKPermissionDeniedError,
  EAKValidationError,
  EazoAgentKit,
} from "../src";
import type { RunEvent } from "../src";

// ---------------------------------------------------------------------------
// Harness: realistic wire-shaped fixtures (double envelope, snake_case),
// mocked transport via the fetch option.
// ---------------------------------------------------------------------------

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.`;
}

const TOKEN = jwt({ webagent_tenant_id: "tenant_1" });
const BASE = "https://eak.example.com/api/v1/projects/tenant_1";

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

/** One wire SSE frame: `id: <n>\ndata: <envelope json>\n\n` (no `event:` line). */
function frame(id: number, type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const envelope = {
    id: String(id),
    type,
    task_id: "run_1",
    session_id: "sess_1",
    project_id: "tenant_1",
    occurred_at: `2026-06-12T08:00:0${id}+00:00`,
    ...extra,
    data,
  };
  return `id: ${id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

interface Captured {
  url: string;
  pathname: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function makeClient(routes: (call: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const client = new EazoAgentKit({
    accessKey: "ak_test",
    secretKey: "sk_test",
    host: "https://eak.example.com",
    genauthBaseUrl: "https://eak.example.com",
    webAgentBaseUrl: "https://eak.example.com",
    fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      const call: Captured = {
        url: String(url),
        pathname: new URL(String(url)).pathname,
        method: init?.method || "GET",
        headers,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      return routes(call);
    }) as typeof fetch,
  });
  return { client, calls };
}

const IMAGE_BYTES = Buffer.from("fake-jpeg-bytes");
const SCREENSHOT_DATA_URI = `data:image/jpeg;base64,${IMAGE_BYTES.toString("base64")}`;

// ---------------------------------------------------------------------------
// delegateToken: products sugar, agent default, local scope pre-validation
// ---------------------------------------------------------------------------

describe("delegateToken semantic enhancements", () => {
  it("expands products to the product scope sets, merges explicit scopes, defaults agent to sdk", async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({
        data: { token: "t", tokenType: "Bearer", expiresIn: 3600, grantId: "g", auditId: "a" },
      }),
    );

    await client.delegateToken({
      user: { id: "user_1" },
      products: ["doAnything", "track"],
      scopes: ["gumem.memory:read"],
    });

    const body = calls.find((c) => c.pathname.endsWith("/delegations"))?.body as {
      agent: string;
      scopes: string[];
    };
    expect(body.agent).toBe("sdk");
    expect([...body.scopes].sort()).toEqual(
      [
        "webagent.do_anything:read",
        "webagent.do_anything:manage",
        "webagent.track:read",
        "webagent.track:manage",
        "gumem.memory:read",
      ].sort(),
    );
    expect((body as Record<string, unknown>).products).toBeUndefined();
  });

  it("rejects a scope missing its service prefix BEFORE any request, naming the correct form", async () => {
    const { client, calls } = makeClient(() => jsonResponse({ data: {} }));

    await expect(
      client.delegateToken({ user: { id: "user_1" }, scopes: ["do_anything:manage"] }),
    ).rejects.toMatchObject({
      name: "EAKValidationError",
      message: expect.stringContaining("webagent.do_anything:manage"),
    });
    expect(calls).toHaveLength(0); // failed locally — nothing hit the wire
  });

  it("rejects malformed scopes locally but lets well-formed unknown scopes through", async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({
        data: { token: "t", tokenType: "Bearer", expiresIn: 3600, grantId: "g", auditId: "a" },
      }),
    );

    await expect(
      client.delegateToken({ user: { id: "user_1" }, scopes: ["not a scope"] }),
    ).rejects.toBeInstanceOf(EAKValidationError);
    expect(calls).toHaveLength(0);

    // Forward-compat: the server is the authority on newly added scopes.
    await client.delegateToken({ user: { id: "user_1" }, scopes: ["webagent.new_thing:zap"] });
    expect(calls).toHaveLength(1);
  });

  it("requires at least one of scopes / products", async () => {
    const { client, calls } = makeClient(() => jsonResponse({ data: {} }));
    await expect(client.delegateToken({ user: { id: "user_1" } })).rejects.toBeInstanceOf(
      EAKValidationError,
    );
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// doAnything RunHandle
// ---------------------------------------------------------------------------

describe("doAnything.run → RunHandle", () => {
  it("creates session + run, routes session-level options, and subscribes core events", async () => {
    const { client, calls } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      return jsonResponse({ data: { run_id: "run_1", session_id: "sess_1" } });
    });

    const run = await client.doAnything.run({
      token: TOKEN,
      instruction: "open the docs",
      profileId: "profile_1",
      limits: { maxDurationMinutes: 7 },
      capture: { screenshots: true },
    });

    expect(run.id).toBe("run_1");
    expect(run.sessionRef).toEqual({ sessionId: "sess_1" });

    const sessionCall = calls.find((c) => c.pathname.endsWith("/do_anything/sessions"));
    expect(sessionCall?.body).toEqual({
      profile_id: "profile_1",
      max_duration_minutes: 7,
    });

    const runCall = calls.find((c) => c.pathname.endsWith("/sessions/sess_1/runs"));
    const runBody = runCall?.body as { instructions: string; stream: { events: string[] } };
    expect(runBody.instructions).toBe("open the docs");
    // Core events are always subscribed; screenshots only because capture asked.
    for (const core of ["run.status_changed", "run.input_request", "run.completed"]) {
      expect(runBody.stream.events).toContain(core);
    }
    expect(runBody.stream.events).toContain("run.screenshot");
  });

  it("does not subscribe screenshots without capture.screenshots", async () => {
    const { client, calls } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      return jsonResponse({ data: { run_id: "run_1" } });
    });

    await client.doAnything.run({ token: TOKEN, instruction: "open the docs" });
    const runBody = calls.at(-1)?.body as { stream: { events: string[] } };
    expect(runBody.stream.events).not.toContain("run.screenshot");
  });

  it("reuses the session from run({ session }) without creating a new one", async () => {
    const { client, calls } = makeClient(() => jsonResponse({ data: { run_id: "run_2" } }));

    const run = await client.doAnything.run({
      token: TOKEN,
      instruction: "follow up",
      session: { sessionId: "sess_prior" },
    });

    expect(run.id).toBe("run_2");
    expect(run.sessionRef).toEqual({ sessionId: "sess_prior" });
    expect(calls.map((c) => `${c.method} ${c.pathname}`)).toEqual([
      "POST /api/v1/projects/tenant_1/do_anything/sessions/sess_prior/runs",
    ]);
  });

  it("normalizes events: semantic types, camelCase data, raw escape hatch, terminal auto-end", async () => {
    const { client } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      if (call.pathname.endsWith("/events")) {
        return sseResponse(
          frame(1, "run.status_changed", { status: "running" }) +
            frame(2, "run.action.started", { kind: "navigate", target_url: "https://x.dev" }) +
            frame(3, "run.cost_update", { total_cost_usd: "0.10" }) +
            frame(4, "run.take_control_pending", { live_url: "https://live" }) +
            frame(5, "run.completed", { terminal_reason: "done", output: "hi" }) +
            // After-terminal frame must never be yielded.
            frame(6, "run.action.started", { kind: "click" }),
        );
      }
      return jsonResponse({ data: { run_id: "run_1", session_id: "sess_1" } });
    });

    const run = await client.doAnything.run({ token: TOKEN, instruction: "go" });
    const events: RunEvent[] = [];
    for await (const event of run.events()) events.push(event);

    expect(events.map((e) => e.type)).toEqual([
      "status",
      "action",
      "cost",
      "progress", // unmapped wire types surface as progress, never drop
      "completed",
    ]);
    expect(events.map((e) => e.isTerminal)).toEqual([false, false, false, false, true]);
    expect(events[1].data).toEqual({ kind: "navigate", targetUrl: "https://x.dev" });
    expect(events[1].runId).toBe("run_1");
    expect(events[1].at).toBe("2026-06-12T08:00:02+00:00");
    // Raw escape hatch keeps the wire envelope intact.
    expect((events[1].raw.data as { data: { target_url: string } }).data.target_url).toBe(
      "https://x.dev",
    );
    expect(events[4].data.terminalReason).toBe("done");
  });

  it("decodes screenshot data URIs into event.image and filters them without capture", async () => {
    const sse =
      frame(1, "run.screenshot", {
        screenshot_url: SCREENSHOT_DATA_URI,
        page_url: "https://x.dev/page",
        step: 3,
      }) + frame(2, "run.completed", { terminal_reason: "done" });
    const { client } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      if (call.pathname.endsWith("/events")) return sseResponse(sse);
      return jsonResponse({ data: { run_id: "run_1" } });
    });

    const withCapture = await client.doAnything.run({
      token: TOKEN,
      instruction: "go",
      capture: { screenshots: true },
    });
    const seen: RunEvent[] = [];
    for await (const event of withCapture.events()) seen.push(event);
    expect(seen[0].type).toBe("screenshot");
    if (seen[0].type !== "screenshot") throw new Error("unreachable");
    expect(Buffer.from(seen[0].image.bytes)).toEqual(IMAGE_BYTES);
    expect(seen[0].image.mime).toBe("image/jpeg");
    expect(seen[0].image.pageUrl).toBe("https://x.dev/page");
    expect(seen[0].image.step).toBe(3);

    const withoutCapture = await client.doAnything.run({ token: TOKEN, instruction: "go" });
    const types: string[] = [];
    for await (const event of withoutCapture.events()) types.push(event.type);
    expect(types).toEqual(["completed"]); // screenshot filtered out
  });

  it("demotes sub-run terminal events to progress so they never end the stream", async () => {
    const { client } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      if (call.pathname.endsWith("/events")) {
        return sseResponse(
          frame(1, "run.completed", { terminal_reason: "done" }, { task_id: "sub_1" }) +
            frame(2, "run.completed", { terminal_reason: "done" }, { task_id: "run_1" }),
        );
      }
      return jsonResponse({ data: { run_id: "run_1" } });
    });

    const run = await client.doAnything.run({ token: TOKEN, instruction: "go" });
    const events: RunEvent[] = [];
    for await (const event of run.events()) events.push(event);
    expect(events.map((e) => [e.type, e.runId])).toEqual([
      ["progress", "sub_1"],
      ["completed", "run_1"],
    ]);
  });

  it("wait() drives callbacks and settles from the run detail envelope", async () => {
    const { client } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      if (call.pathname.endsWith("/events")) {
        return sseResponse(
          frame(1, "run.input_request", { request_id: "req_1", live_url: "https://live" }) +
            frame(2, "run.screenshot", { screenshot_url: SCREENSHOT_DATA_URI, step: 1 }) +
            frame(3, "run.completed", { terminal_reason: "done", output: "lean" }),
        );
      }
      if (call.method === "GET" && call.pathname.endsWith("/runs/run_1")) {
        return jsonResponse({
          data: {
            run_id: "run_1",
            session_id: "sess_1",
            status: "succeeded",
            output: "the full answer",
            total_cost_usd: "0.42",
          },
        });
      }
      return jsonResponse({ data: { run_id: "run_1", session_id: "sess_1" } });
    });

    const run = await client.doAnything.run({
      token: TOKEN,
      instruction: "go",
      capture: { screenshots: true },
    });
    const shots: Array<{ index: number; bytes: number }> = [];
    const requests: unknown[] = [];
    const result = await run.wait({
      onScreenshot: (image, index) => {
        shots.push({ index, bytes: image.bytes.length });
      },
      onInputRequest: (request) => {
        requests.push(request);
      },
    });

    expect(shots).toEqual([{ index: 0, bytes: IMAGE_BYTES.length }]);
    expect(requests).toEqual([{ requestId: "req_1", liveUrl: "https://live" }]);
    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("the full answer"); // settled from detail, not the lean event
    expect(result.artifacts).toEqual([]);
    expect(result.raw.total_cost_usd).toBe("0.42");
  });

  it("events() auto-reconnects with Last-Event-ID after a dropped stream", async () => {
    let eventsCall = 0;
    const lastEventIds: Array<string | undefined> = [];
    const { client } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      if (call.pathname.endsWith("/events")) {
        eventsCall += 1;
        lastEventIds.push(call.headers["last-event-id"]);
        if (eventsCall === 1) {
          let pulls = 0;
          const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
              pulls += 1;
              if (pulls === 1) {
                controller.enqueue(
                  new TextEncoder().encode(frame(1, "run.action.started", { kind: "navigate" })),
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
        return sseResponse(frame(2, "run.completed", { terminal_reason: "done" }));
      }
      return jsonResponse({ data: { run_id: "run_1" } });
    });

    const run = await client.doAnything.run({ token: TOKEN, instruction: "go" });
    const types: string[] = [];
    for await (const event of run.events()) types.push(event.type);

    expect(types).toEqual(["action", "completed"]);
    expect(eventsCall).toBe(2);
    expect(lastEventIds).toEqual([undefined, "1"]); // resumed where we left off
  });

  it("cancel() is idempotent: a 4xx on an already-terminal run returns the terminal state", async () => {
    const { client } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      if (call.pathname.endsWith("/cancel")) {
        return jsonResponse(
          { detail: { code: "conflict", message: "run already terminal" } },
          { status: 409 },
        );
      }
      if (call.method === "GET" && call.pathname.endsWith("/runs/run_1")) {
        return jsonResponse({
          data: { run_id: "run_1", session_id: "sess_1", status: "succeeded", output: "done" },
        });
      }
      return jsonResponse({ data: { run_id: "run_1" } });
    });

    const run = await client.doAnything.run({ token: TOKEN, instruction: "go" });
    const status = await run.cancel("no longer needed");
    expect(status.status).toBe("succeeded");
  });

  it("cancel() still throws on permission errors", async () => {
    const { client } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      if (call.pathname.endsWith("/cancel")) {
        return jsonResponse(
          { detail: { code: "permission_denied", message: "missing scope" } },
          { status: 403 },
        );
      }
      return jsonResponse({ data: { run_id: "run_1" } });
    });

    const run = await client.doAnything.run({ token: TOKEN, instruction: "go" });
    await expect(run.cancel()).rejects.toBeInstanceOf(EAKPermissionDeniedError);
  });

  it("respond() derives the wire intervene kind from response presence", async () => {
    const bodies: unknown[] = [];
    const { client } = makeClient((call) => {
      if (call.pathname.endsWith("/do_anything/sessions")) {
        return jsonResponse({ data: { id: "sess_1" } });
      }
      if (call.pathname.endsWith("/intervene")) {
        bodies.push(call.body);
        return jsonResponse({ data: { ok: true } });
      }
      return jsonResponse({ data: { run_id: "run_1" } });
    });

    const run = await client.doAnything.run({ token: TOKEN, instruction: "go" });
    await run.respond("req_1", "use the blue button");
    await run.respond("req_2"); // no response = skip

    expect(bodies).toEqual([
      { kind: "answer_input_request", input_request_id: "req_1", response: "use the blue button" },
      { kind: "skip_input_request", input_request_id: "req_2" },
    ]);
  });

  it("attach() requires the run's session on the current wire and verifies the run", async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({ data: { run_id: "run_1", session_id: "sess_1", status: "running" } }),
    );

    await expect(
      client.doAnything.attach("run_1", { token: TOKEN } as never),
    ).rejects.toBeInstanceOf(EAKValidationError);
    expect(calls).toHaveLength(0);

    const run = await client.doAnything.attach("run_1", {
      token: TOKEN,
      session: { sessionId: "sess_1" },
    });
    expect(run.id).toBe("run_1");
    expect(calls.map((c) => `${c.method} ${c.pathname}`)).toEqual([
      "GET /api/v1/projects/tenant_1/do_anything/sessions/sess_1/runs/run_1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// webSearch RunHandle
// ---------------------------------------------------------------------------

describe("webSearch.run → RunHandle", () => {
  it("maps query sugar to queries and returns a handle", async () => {
    const { client, calls } = makeClient(() => jsonResponse({ data: { run_id: "ws_1" } }));

    const run = await client.webSearch.run({ token: TOKEN, query: "eak sdk" });
    expect(run.id).toBe("ws_1");
    expect(calls[0].body).toEqual({ queries: ["eak sdk"] });
  });

  it("attach() verifies the run and adopts its sessionRef from the detail", async () => {
    const { client } = makeClient(() =>
      jsonResponse({ data: { run_id: "ws_1", session_id: "sess_ws", status: "running" } }),
    );
    const run = await client.webSearch.attach("ws_1", { token: TOKEN });
    expect(run.sessionRef).toEqual({ sessionId: "sess_ws" });
  });

  it("respond() fails loudly — the wire has no webSearch intervene", async () => {
    const { client, calls } = makeClient(() => jsonResponse({ data: { run_id: "ws_1" } }));
    const run = await client.webSearch.run({ token: TOKEN, query: "x" });
    const before = calls.length;
    await expect(run.respond("req_1", "answer")).rejects.toBeInstanceOf(EAKError);
    expect(calls.length).toBe(before); // failed locally
  });
});

// ---------------------------------------------------------------------------
// deepResearch RunHandle
// ---------------------------------------------------------------------------

describe("deepResearch.run → RunHandle", () => {
  it("maps limits and session reuse onto the wire create body", async () => {
    const { client, calls } = makeClient(() => jsonResponse({ data: { run_id: "dr_2" } }));

    const run = await client.deepResearch.run({
      token: TOKEN,
      topic: "battery recycling, 2026 update",
      limits: { maxCostUsd: "5.00", maxDurationMinutes: 120 },
      session: { sessionId: "sess_dr" }, // follow-up run in an existing session
    });

    expect(run.id).toBe("dr_2");
    expect(run.sessionRef).toEqual({ sessionId: "sess_dr" });
    expect(calls[0].body).toEqual({
      topic: "battery recycling, 2026 update",
      max_cost_usd: "5.00",
      max_duration_minutes: 120,
      session_id: "sess_dr",
    });
  });

  it("respond() posts the outline answer and refuses an empty skip", async () => {
    const bodies: unknown[] = [];
    const { client, calls } = makeClient((call) => {
      if (call.pathname.endsWith("/intervene")) {
        bodies.push(call.body);
        return jsonResponse({ data: { ok: true } });
      }
      return jsonResponse({ data: { run_id: "dr_1" } });
    });

    const run = await client.deepResearch.run({ token: TOKEN, topic: "t" });
    await run.respond("req_outline_1", "approve");
    expect(bodies).toEqual([{ request_id: "req_outline_1", response: "approve" }]);

    const before = calls.length;
    await expect(run.respond("req_outline_1")).rejects.toBeInstanceOf(EAKValidationError);
    expect(calls.length).toBe(before); // refused locally — no wire skip exists
  });

  it("wait() populates result.artifacts with lazy content fetching", async () => {
    const { client, calls } = makeClient((call) => {
      if (call.pathname.endsWith("/events")) {
        return sseResponse(frame(1, "run.completed", { terminal_reason: "done" }));
      }
      if (call.pathname.endsWith("/artifacts")) {
        return jsonResponse({
          data: {
            run_id: "dr_1",
            items: [
              {
                id: "art_1",
                name: "report.md",
                mime_type: "text/markdown",
                size_bytes: 5,
                created_at: "2026-06-12T08:01:00+00:00",
              },
            ],
          },
        });
      }
      if (call.pathname.endsWith("/artifacts/art_1")) {
        return new Response("hello", {
          status: 200,
          headers: { "content-type": "text/markdown" },
        });
      }
      if (call.method === "GET" && call.pathname.endsWith("/runs/dr_1")) {
        return jsonResponse({
          data: { run_id: "dr_1", session_id: "sess_dr", status: "succeeded", result: "report" },
        });
      }
      return jsonResponse({ data: { run_id: "dr_1" } });
    });

    const run = await client.deepResearch.run({ token: TOKEN, topic: "t" });
    const result = await run.wait();

    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("report"); // DR wire names it `result`
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      id: "art_1",
      name: "report.md",
      mime: "text/markdown",
      sizeBytes: 5,
    });
    // Content is lazy: nothing fetched the blob yet.
    expect(calls.some((c) => c.pathname.endsWith("/artifacts/art_1"))).toBe(false);
    const bytes = await result.artifacts[0].content();
    expect(Buffer.from(bytes).toString("utf8")).toBe("hello");
    expect(calls.at(-1)?.pathname).toBe(
      "/api/v1/projects/tenant_1/deep_research/runs/dr_1/artifacts/art_1",
    );
  });
});

// ---------------------------------------------------------------------------
// track MonitorHandle
// ---------------------------------------------------------------------------

describe("track.create → MonitorHandle", () => {
  function monitorClient() {
    const harness = makeClient((call) => {
      if (call.pathname.endsWith("/track/monitors") && call.method === "POST") {
        return jsonResponse({ data: { id: "mon_1", status: "active" } });
      }
      if (call.pathname.endsWith("/monitors/mon_1/events")) {
        return sseResponse(
          frame(1, "run.status_changed", { status: "running" }, { task_id: "tick_1" }) +
            frame(2, "run.completed", { terminal_reason: "done" }, { task_id: "tick_1" }),
        );
      }
      if (call.pathname.endsWith("/monitors/mon_1/runs")) {
        return jsonResponse({
          data: {
            items: [
              { run_id: "tick_1", status: "succeeded", started_at: "2026-06-12T08:00:00+00:00" },
            ],
            total: 1,
          },
        });
      }
      if (call.pathname.endsWith("/monitors/mon_1/runs/tick_1")) {
        return jsonResponse({ data: { run_id: "tick_1", status: "succeeded" } });
      }
      return jsonResponse({ data: { id: "mon_1", check_interval_minutes: 30 } });
    });
    return harness;
  }

  it("create() snakeifies the definition and returns a handle with the id", async () => {
    const { client, calls } = monitorClient();
    const monitor = await client.track.create({
      token: TOKEN,
      url: "https://eazo.ai/pricing",
      checkIntervalMinutes: 30,
    });
    expect(monitor.id).toBe("mon_1");
    expect(calls[0].body).toEqual({
      url: "https://eazo.ai/pricing",
      check_interval_minutes: 30,
    });
  });

  it("handle methods address the monitor without re-passing token or id", async () => {
    const { client, calls } = monitorClient();
    const monitor = await client.track.create({ token: TOKEN, url: "https://eazo.ai" });

    const detail = await monitor.get();
    expect(detail.checkIntervalMinutes).toBe(30); // camelCase normalization

    await monitor.update({ checkIntervalMinutes: 60 });
    await monitor.runNow();
    await monitor.delete();

    expect(calls.slice(1).map((c) => `${c.method} ${c.pathname}`)).toEqual([
      "GET /api/v1/projects/tenant_1/track/monitors/mon_1",
      "PATCH /api/v1/projects/tenant_1/track/monitors/mon_1",
      "POST /api/v1/projects/tenant_1/track/monitors/mon_1/run_now",
      "DELETE /api/v1/projects/tenant_1/track/monitors/mon_1",
    ]);
    expect(calls[2].body).toEqual({ check_interval_minutes: 60 });
  });

  it("respond() maps to the monitor intervene wire with answer/skip kinds", async () => {
    const { client, calls } = monitorClient();
    const monitor = await client.track.create({ token: TOKEN, url: "https://eazo.ai" });

    await monitor.respond("req_1", "logged back in");
    await monitor.respond("req_2");

    const intervenes = calls.filter((c) => c.pathname.endsWith("/intervene"));
    expect(intervenes.map((c) => c.body)).toEqual([
      { kind: "answer", request_id: "req_1", response: "logged back in" },
      { kind: "skip", request_id: "req_2" },
    ]);
  });

  it("runs() / run() expose read-only normalized tick runs", async () => {
    const { client, calls } = monitorClient();
    const monitor = await client.track.create({ token: TOKEN, url: "https://eazo.ai" });

    const runs = await monitor.runs({ limit: 5 });
    expect(runs).toEqual([
      { id: "tick_1", runId: "tick_1", status: "succeeded", startedAt: "2026-06-12T08:00:00+00:00" },
    ]);
    expect(calls.at(-1)?.url).toContain("/monitors/mon_1/runs?limit=5");

    const single = await monitor.run("tick_1");
    expect(single).toEqual({ id: "tick_1", runId: "tick_1", status: "succeeded" });
    // Read-only views carry no operations.
    expect((single as Record<string, unknown>).cancel).toBeUndefined();
  });

  it("events() yields normalized events without auto-ending on tick run terminals", async () => {
    const { client } = monitorClient();
    const monitor = await client.track.create({ token: TOKEN, url: "https://eazo.ai" });

    const types: string[] = [];
    for await (const event of monitor.events()) types.push(event.type);
    // The terminal `completed` of a tick run is yielded, and the iterator only
    // ends because the mocked stream closes — not because of the terminal.
    expect(types).toEqual(["status", "completed"]);
  });

  it("attach() verifies the monitor exists", async () => {
    const { client, calls } = monitorClient();
    const monitor = await client.track.attach("mon_1", { token: TOKEN });
    expect(monitor.id).toBe("mon_1");
    expect(calls.map((c) => `${c.method} ${c.pathname}`)).toEqual([
      "GET /api/v1/projects/tenant_1/track/monitors/mon_1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

describe("permission errors", () => {
  it("appends the known scope set to server permission errors", async () => {
    const { client } = makeClient(() =>
      jsonResponse(
        { detail: { code: "permission_denied", message: "missing scope" } },
        { status: 403 },
      ),
    );

    await expect(
      client.webSearch.api.get({ token: TOKEN, runId: "ws_1" }),
    ).rejects.toMatchObject({
      name: "EAKPermissionDeniedError",
      message: expect.stringContaining("Known scopes: gumem.session:create"),
    });
  });
});
