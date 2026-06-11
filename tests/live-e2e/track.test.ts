import { describe, expect, it } from "vitest";
import {
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
    const monitor = await client.track.createMonitor({
      token,
      name: `${livePrefix} monitor`,
      target: "https://example.com",
      url: "https://example.com",
      instructions: "Notify when the example page title changes.",
      schedule: "0 9 * * *",
    });
    const monitorId = extractId(monitor.data, "Track monitor");

    try {
      await client.track.getMonitor({ token, monitorId });
      await client.track.runNow({ token, monitorId });
      await collectSomeEvents((signal) => client.track.events({ token, monitorId, signal }));
      await client.track.updateMonitor({
        token,
        monitorId,
        name: `${livePrefix} monitor updated`,
        schedule: "0 10 * * *",
      });
    } finally {
      await client.track.deleteMonitor({ token, monitorId });
    }

    expect(monitorId).toBeTruthy();
  });
});
