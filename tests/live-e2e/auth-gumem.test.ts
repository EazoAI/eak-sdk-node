import { describe, expect, it } from "vitest";
import {
  allowLiveEnvironmentConstraint,
  delegateLiveToken,
  gumemScopes,
  liveE2EEnabled,
  liveClient,
  livePrefix,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

describeLiveE2E("live e2e: auth and GUMem", () => {
  it("queries a real GenAuth user, delegates a real token, and calls all GUMem methods", async () => {
    const client = liveClient();
    const { token, userId } = await delegateLiveToken(client, gumemScopes);
    const sessionId = `${livePrefix}-gumem`;

    if (process.env.EAK_USER_ACCESS_TOKEN) {
      const user = await client.currentUser({ accessToken: process.env.EAK_USER_ACCESS_TOKEN });
      expect(user.data).toBeTruthy();
    }

    await client.gumem.createSession({
      token,
      userId,
      sessionId,
      title: `${livePrefix} GUMem live e2e`,
      metadata: { source: "eak-sdk-node-live-e2e", livePrefix },
    });
    await client.gumem.addMessages({
      token,
      userId,
      sessionId,
      sync: true,
      messages: [{ role: "user", content: `${livePrefix} live e2e message` }],
    });
    const recall = await client.gumem.recall({
      token,
      sessionId,
      query: `${livePrefix} live e2e`,
      details: true,
      recallConfig: { topK: 3 },
      metadataFilters: { source: "eak-sdk-node-live-e2e" },
    });
    expect(recall.data).toBeTruthy();
    await allowLiveEnvironmentConstraint(
      client.gumem.uploadResource({
        token,
        userId,
        sessionId,
        file: new Blob([`${livePrefix} live e2e resource`], { type: "text/plain" }),
        filename: `${livePrefix}.txt`,
        contentType: "text/plain",
      }),
    );
    await client.gumem.actions.record({
      token,
      user_id: userId,
      session_id: sessionId,
      event_type: "sdk_live_e2e",
      timestamp: new Date().toISOString(),
      content: `${livePrefix} action`,
    });
    await client.gumem.actions.recall({ token, user_id: userId, query: livePrefix });
    await client.gumem.actions.stream({ token, user_id: userId, limit: 1 });
  });
});
