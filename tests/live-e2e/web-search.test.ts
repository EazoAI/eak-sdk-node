import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  let client: ReturnType<typeof liveClient>;
  let token: string;
  let runId: string | undefined;
  let runReady: Promise<string | undefined> | undefined;
  let canceled = false;

  beforeAll(async () => {
    client = liveClient();
    token = (await delegateLiveToken(client, webSearchScopes)).token;
  });

  afterAll(async () => {
    if (runId && !canceled) {
      await client.webSearch.cancel({ token, runId, reason: "sdk live e2e cleanup" }).catch(() => undefined);
    }
  });

  function ensureRun() {
    runReady ??= (async () => {
      const run = await allowLiveEnvironmentConstraint(
        client.webSearch.run({
          token,
          query: `${livePrefix} EAK SDK`,
          maxResultsPerQuery: 1,
          siteWhitelist: ["eazo.ai", "authing.cn"],
        }),
      );
      if (!run) return undefined;
      runId = extractId(run.data, "webSearch run");
      return runId;
    })();
    return runReady;
  }

  it("webSearch.run({ query, maxResultsPerQuery, siteWhitelist })", async () => {
    const id = await ensureRun();
    expect(id).toBeTruthy();
  });

  it("webSearch.get({ runId })", async () => {
    const id = await ensureRun();
    if (!id) return;
    const run = await client.webSearch.get({ token, runId: id });
    expect(run.data).toBeTruthy();
  });

  it("webSearch.refine({ message })", async () => {
    const id = await ensureRun();
    if (!id) return;
    await client.webSearch.refine({ token, runId: id, message: "只保留和 SDK 使用相关的结果" });
  });

  it("webSearch.events({ runId, signal })", async () => {
    const id = await ensureRun();
    if (!id) return;
    await collectSomeEvents(
      (signal) => client.webSearch.events({ token, runId: id, signal }),
      { label: "webSearch.events", referenceId: id },
    );
  });

  it("webSearch.cancel({ runId, reason })", async () => {
    const id = await ensureRun();
    if (!id) return;
    await client.webSearch.cancel({ token, runId: id, reason: "sdk live e2e cleanup" });
    canceled = true;
  });
});
