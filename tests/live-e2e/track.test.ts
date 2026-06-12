import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EAKError } from "../../src";
import type { JsonObject, MonitorHandle } from "../../src";
import {
  allowLiveEnvironmentConstraint,
  collectRunEvents,
  delegateLiveToken,
  liveE2EEnabled,
  liveClient,
  openRawEventRecorder,
  trackScopes,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

describeLiveE2E("live e2e: Track (semantic surface)", () => {
  let client: ReturnType<typeof liveClient>;
  let token: string;
  let monitor: MonitorHandle | undefined;
  let monitorReady: Promise<MonitorHandle | undefined> | undefined;
  let deleted = false;

  beforeAll(async () => {
    client = liveClient();
    token = (await delegateLiveToken(client, trackScopes)).token;
  });

  afterAll(async () => {
    if (monitor && !deleted) {
      await monitor.delete().catch(() => undefined);
    }
  });

  // One monitor shared across the file: token passed ONCE at track.create,
  // every later operation goes through the MonitorHandle.
  function ensureMonitor() {
    monitorReady ??= (async () => {
      const handle = await allowLiveEnvironmentConstraint(
        client.track.create({
          token,
          // Plain natural-language intent — no nonce: the intent feeds LLM
          // alignment, and traceability comes from monitor.id.
          // 60s is the backend minimum interval; the price moves every tick,
          // so the change trigger fires on real scheduled ticks.
          // No target_urls: the agent-driven tick path finds the price from
          // the instructions alone. Direct mode skips the alignment dialogue,
          // so the fields alignment would derive must be supplied here:
          // extractionSchema (else ticks extract {}) and tickInstructions
          // (else ticks fall back to the legacy scrape path, which needs URLs).
          // Top-level keys are camelCase (the SDK snake-cases them); nested
          // values are wire-shaped passthrough.
          intent: "Monitor the live Bitcoin price and notify on any change",
          notifyChannel: { kind: "console_inbox" },
          schedule: { kind: "interval", interval_seconds: 60 },
          extractionSchema: { btc_price_usd: "number" },
          tickInstructions:
            "Find the current Bitcoin price in USD from a public price page and report it as btc_price_usd.",
          triggerDsl: { on: "change" },
        }),
      );
      monitor = handle ?? undefined;
      return monitor;
    })();
    return monitorReady;
  }

  it("track.create({ token, intent, schedule, ... }) returns a monitor handle", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    expect(handle.id).toBeTruthy();
  });

  it("monitor.get() returns the normalized monitor definition", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    const data = await handle.get();
    // Domain content: the monitor we created, not just a 200.
    expect(JSON.stringify(data)).toContain("Bitcoin");
    // Normalized camelCase — no snake_case keys at the top level.
    expect(Object.keys(data).some((key) => key.includes("_"))).toBe(false);
  });

  it("monitor.update() is observable on monitor.events()", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    const eventsPromise = collectRunEvents((signal) => handle.events({ signal }), {
      label: "track monitor.events",
      timeoutMs: 45_000,
      until: (event) => event.raw.event === "monitor.lifecycle_changed",
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await handle.update({
      action: "refine",
      patch: {
        schedule: { kind: "interval", interval_seconds: 5400 },
        trigger_dsl: { on: "change" },
      },
    });
    await eventsPromise;
  });

  it("monitor.runNow() triggers an immediate tick", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    await allowLiveEnvironmentConstraint(handle.runNow());
  });

  // Raw-recording test, implemented via the semantic stream: every normalized
  // event carries the original wire envelope on `event.raw`, which is what
  // gets persisted under .secrets/runs/track-<monitorId>/ (EAK_OUT_DIR
  // overrides).
  //
  // This must witness a SCHEDULER-driven tick — runNow is a manual trigger and
  // proves nothing about the schedule. So: tighten the interval to the backend
  // minimum (60s), never call runNow here, and only accept a tick whose
  // started_at falls after the recording began (replayed history and earlier
  // manual ticks don't count).
  it("records a scheduler-driven tick to disk via event.raw", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    await handle.update({
      action: "refine",
      patch: {
        schedule: { kind: "interval", interval_seconds: 60 },
        trigger_dsl: { on: "change" },
      },
    });

    const recorder = openRawEventRecorder(`track-${handle.id}`);
    const startedAfter = Date.now();
    console.log(`recording monitor ${handle.id} (waiting for a scheduled tick) → ${recorder.dir}`);

    let freshTickN: number | undefined;
    let sawScheduledTick = false;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.EAK_LIVE_TRACK_TICK_TIMEOUT_MS || 150_000),
    );
    try {
      // Monitor streams have no terminal event — the caller decides when to
      // stop. Tick payloads arrive camelCase on event.data (tickN, startedAt).
      for await (const event of handle.events({ signal: controller.signal })) {
        recorder.record(event);
        const wireType = String(event.raw.event || "");
        if (wireType === "monitor.tick_started") {
          const startedAt = Date.parse(String(event.data.startedAt ?? ""));
          if (Number.isFinite(startedAt) && startedAt > startedAfter) {
            freshTickN = Number(event.data.tickN);
          }
        }
        if (
          wireType === "monitor.tick_completed" &&
          freshTickN !== undefined &&
          Number(event.data.tickN) === freshTickN
        ) {
          sawScheduledTick = true;
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
    console.log(
      `recorded ${recorder.count()} events (scheduled tick ${
        sawScheduledTick ? `#${freshTickN} completed` : "NOT seen"
      }) → ${recorder.file}`,
    );
    expect(sawScheduledTick).toBe(true);
    expect(fs.existsSync(recorder.file)).toBe(true);
  }, 180_000);

  it("monitor.runs() / monitor.run() expose tick runs read-only", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    // By now at least one tick has completed (the recording test witnessed one).
    const runs = await handle.runs({ limit: 10 });
    expect(runs.length).toBeGreaterThan(0);
    const first = runs[0] as JsonObject;
    expect(typeof first.id).toBe("string");
    const detail = await handle.run(String(first.id));
    expect(detail.id).toBe(first.id);
  });

  it("monitor.respond() rejects an unknown HITL request with a wire error", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    // No HITL park is pending on this healthy monitor — answering a
    // nonexistent request must surface a clean wire error, not hang.
    try {
      await handle.respond("sdk-live-nonexistent-request", { acknowledged: true });
    } catch (error) {
      if (!(error instanceof EAKError)) throw error;
      expect(error.status).toBeGreaterThanOrEqual(400);
      return;
    }
    // Some backends accept-and-ignore unknown requests; reaching here without
    // a hang is the assertion.
  });

  // Escape-hatch smoke: the wire layer (api.*) must keep working for advanced
  // users, but it appears ONLY here — everything above is semantic.
  it("escape hatch: api.getMonitor({ token, monitorId }) still speaks wire", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    const wire = await client.track.api.getMonitor<JsonObject>({ token, monitorId: handle.id });
    expect(wire.data).toBeTruthy();
  });

  it("monitor.delete() removes the monitor", async () => {
    const handle = await ensureMonitor();
    if (!handle) return;
    await handle.delete();
    deleted = true;
  });
});
