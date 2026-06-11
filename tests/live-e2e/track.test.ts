import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  allowLiveEnvironmentConstraint,
  collectSomeEvents,
  delegateLiveToken,
  extractId,
  liveE2EEnabled,
  liveClient,
  livePrefix,
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
          intent: `${livePrefix} monitor example.com for visible page title changes`,
          notify_channel: { kind: "console_inbox" },
          schedule: { kind: "interval", interval_seconds: 3600 },
          target_urls: ["https://example.com"],
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

  it("track.deleteMonitor({ monitorId })", async () => {
    const id = await ensureMonitor();
    if (!id) return;
    await client.track.deleteMonitor({ token, monitorId: id });
    deleted = true;
  });
});
