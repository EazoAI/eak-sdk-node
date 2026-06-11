import { describe, expect, it } from "vitest";
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
  it("covers createMonitor/getMonitor/runNow/events/updateMonitor/deleteMonitor with a real delegated token", async () => {
    const client = liveClient();
    const { token } = await delegateLiveToken(client, trackScopes);
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
    if (!monitor) return;
    const monitorId = extractId(monitor.data, "Track monitor");

    try {
      await client.track.getMonitor({ token, monitorId });
      await allowLiveEnvironmentConstraint(client.track.runNow({ token, monitorId }));
      await collectSomeEvents((signal) => client.track.events({ token, monitorId, signal }));
      await client.track.updateMonitor({
        token,
        monitorId,
        action: "refine",
        patch: {
          schedule: { kind: "interval", interval_seconds: 7200 },
          trigger_dsl: { on: "change" },
        },
      });
    } finally {
      await client.track.deleteMonitor({ token, monitorId });
    }

    expect(monitorId).toBeTruthy();
  });
});
