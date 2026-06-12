import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allowLiveEnvironmentConstraint,
  collectSomeEvents,
  delegateLiveToken,
  extractId,
  liveE2EEnabled,
  liveClient,
  trackScopes,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

describeLiveE2E("live e2e: Track", () => {
  let client: ReturnType<typeof liveClient>;
  let token: string;
  let monitorId: string | undefined;
  let monitorReady: Promise<string | undefined> | undefined;
  let deleted = false;

  beforeAll(async () => {
    client = liveClient();
    token = (await delegateLiveToken(client, trackScopes)).token;
  });

  afterAll(async () => {
    if (monitorId && !deleted) {
      await client.track.deleteMonitor({ token, monitorId }).catch(() => undefined);
    }
  });

  function ensureMonitor() {
    monitorReady ??= (async () => {
      const monitor = await allowLiveEnvironmentConstraint(
        client.track.createMonitor({
          token,
          // Plain natural-language intent — no livePrefix nonce: the intent
          // feeds LLM alignment, and traceability comes from monitorId.
          // 60s is the backend minimum interval; the price moves every tick,
          // so the change trigger fires on real scheduled ticks.
          // No target_urls: the agent-driven tick path finds the price from
          // the instructions alone. Direct mode skips the alignment dialogue,
          // so the fields alignment would derive must be supplied here:
          // extraction_schema (else ticks extract {}) and tick_instructions
          // (else ticks fall back to the legacy scrape path, which needs URLs).
          intent: "Monitor the live Bitcoin price and notify on any change",
          notify_channel: { kind: "console_inbox" },
          schedule: { kind: "interval", interval_seconds: 60 },
          extraction_schema: { btc_price_usd: "number" },
          tick_instructions:
            "Find the current Bitcoin price in USD from a public price page and report it as btc_price_usd.",
          trigger_dsl: { on: "change" },
        }),
      );
      if (!monitor) return undefined;
      monitorId = extractId(monitor.data, "Track monitor");
      return monitorId;
    })();
    return monitorReady;
  }

  it("track.createMonitor({ intent, notify_channel, schedule, target_urls, trigger_dsl })", async () => {
    const id = await ensureMonitor();
    expect(id).toBeTruthy();
  });

  it("track.getMonitor({ monitorId })", async () => {
    const id = await ensureMonitor();
    if (!id) return;
    const monitor = await client.track.getMonitor({ token, monitorId: id });
    expect(monitor.data).toBeTruthy();
  });

  it("track.runNow({ monitorId })", async () => {
    const id = await ensureMonitor();
    if (!id) return;
    await allowLiveEnvironmentConstraint(client.track.runNow({ token, monitorId: id }));
  });

  it("track.events({ monitorId, signal })", async () => {
    const id = await ensureMonitor();
    if (!id) return;
    const events = collectSomeEvents(
      (signal) => client.track.events({ token, monitorId: id, signal }),
      {
        label: "track.events",
        referenceId: id,
        eventTypes: ["monitor.lifecycle_changed"],
        timeoutMs: 45_000,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await client.track.updateMonitor({
      token,
      monitorId: id,
      action: "refine",
      patch: {
        schedule: { kind: "interval", interval_seconds: 5400 },
        trigger_dsl: { on: "change" },
      },
    });
    await events;
  });

  it("track.updateMonitor({ action, patch })", async () => {
    const id = await ensureMonitor();
    if (!id) return;
    await client.track.updateMonitor({
      token,
      monitorId: id,
      action: "refine",
      patch: {
        schedule: { kind: "interval", interval_seconds: 7200 },
        trigger_dsl: { on: "change" },
      },
    });
  });

  // Same recording pattern as the run-based products: persist the raw monitor
  // event stream under .secrets/runs/track-<monitorId>/ (override with
  // EAK_OUT_DIR) and echo each event to the console as it arrives.
  //
  // This must witness a SCHEDULER-driven tick — runNow is a manual trigger and
  // proves nothing about the schedule. So: tighten the interval to the backend
  // minimum (60s), never call runNow here, and only accept a tick whose
  // started_at falls after the recording began (replayed history and earlier
  // manual ticks don't count).
  it("records a scheduler-driven tick to disk", async () => {
    const id = await ensureMonitor();
    if (!id) return;
    await client.track.updateMonitor({
      token,
      monitorId: id,
      action: "refine",
      patch: {
        schedule: { kind: "interval", interval_seconds: 60 },
        trigger_dsl: { on: "change" },
      },
    });

    const outDir =
      process.env.EAK_OUT_DIR || path.join(process.cwd(), ".secrets", "runs", `track-${id}`);
    fs.mkdirSync(outDir, { recursive: true });
    const eventsFile = path.join(outDir, "events.jsonl");
    fs.writeFileSync(eventsFile, ""); // truncate any prior run's log
    const startedAfter = Date.now();
    console.log(`recording monitor ${id} (waiting for a scheduled tick) → ${outDir}`);

    let total = 0;
    let freshTickN: number | undefined;
    let sawScheduledTick = false;
    const signal = AbortSignal.timeout(
      Number(process.env.EAK_LIVE_TRACK_TICK_TIMEOUT_MS || 150_000),
    );
    try {
      for await (const ev of client.track.events({ token, monitorId: id, signal })) {
        total++;
        fs.appendFileSync(
          eventsFile,
          JSON.stringify({ receivedAt: new Date().toISOString(), ...ev }) + "\n",
        );
        const type = String(ev.event || "");
        console.log(`  [${type}] ${JSON.stringify(ev.data ?? {}).slice(0, 110)}`);
        const d = (ev.data ?? {}) as Record<string, unknown>;
        const inner = ((d.data ?? d) ?? {}) as Record<string, unknown>;
        if (type === "monitor.tick_started") {
          const startedAt = Date.parse(String(inner.started_at ?? ""));
          if (Number.isFinite(startedAt) && startedAt > startedAfter) {
            freshTickN = Number(inner.tick_n);
          }
        }
        if (
          type === "monitor.tick_completed" &&
          freshTickN !== undefined &&
          Number(inner.tick_n) === freshTickN
        ) {
          sawScheduledTick = true;
          break;
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
    console.log(
      `recorded ${total} events (scheduled tick ${sawScheduledTick ? `#${freshTickN} completed` : "NOT seen"}) → ${eventsFile}`,
    );
    expect(sawScheduledTick).toBe(true);
  }, 180_000);

  it("track.deleteMonitor({ monitorId })", async () => {
    const id = await ensureMonitor();
    if (!id) return;
    await client.track.deleteMonitor({ token, monitorId: id });
    deleted = true;
  });
});
