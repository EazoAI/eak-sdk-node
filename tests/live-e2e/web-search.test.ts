import { describe, expect, it } from "vitest";
import {
  allowLiveEnvironmentConstraint,
  collectSomeEvents,
  delegateLiveToken,
  extractId,
  liveE2EEnabled,
  liveClient,
  livePrefix,
  webSearchScopes,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

describeLiveE2E("live e2e: Web Search", () => {
  it("covers run/get/refine/events/cancel with a real delegated token", async () => {
    const client = liveClient();
    const { token } = await delegateLiveToken(client, webSearchScopes);
    const run = await allowLiveEnvironmentConstraint(
      client.webSearch.run({
        token,
        query: `${livePrefix} EAK SDK`,
        maxResultsPerQuery: 1,
        siteWhitelist: ["eazo.ai", "authing.cn"],
      }),
    );
    if (!run) return;
    const runId = extractId(run.data, "webSearch run");

    try {
      await client.webSearch.get({ token, runId });
      await client.webSearch.refine({ token, runId, message: "只保留和 SDK 使用相关的结果" });
      await collectSomeEvents((signal) => client.webSearch.events({ token, runId, signal }));
    } finally {
      await client.webSearch.cancel({ token, runId, reason: "sdk live e2e cleanup" });
    }

    expect(runId).toBeTruthy();
  });
});
