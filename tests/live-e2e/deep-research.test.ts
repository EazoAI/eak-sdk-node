import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EAKError } from "../../src";
import {
  allowLiveEnvironmentConstraint,
  collectSomeEvents,
  deepResearchScopes,
  delegateLiveToken,
  extractId,
  firstArtifactId,
  liveE2EEnabled,
  liveClient,
  livePrefix,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

describeLiveE2E("live e2e: Deep Research", () => {
  let client: ReturnType<typeof liveClient>;
  let token: string;
  let runId: string | undefined;
  let runReady: Promise<string | undefined> | undefined;
  let eventsReady: Promise<unknown[]> | undefined;
  let canceled = false;

  beforeAll(async () => {
    client = liveClient();
    token = (await delegateLiveToken(client, deepResearchScopes)).token;
  });

  afterAll(async () => {
    if (runId && !canceled) {
      await client.deepResearch.cancel({ token, runId }).catch(() => undefined);
    }
  });

  function ensureRun() {
    runReady ??= (async () => {
      const run = await allowLiveEnvironmentConstraint(
        client.deepResearch.run({
          token,
          topic: `${livePrefix}: summarize the public example.com page in one paragraph`,
          outputFormat: "report",
          targetAudience: "SDK maintainers",
          requireOutlineApproval: true,
          maxCostUsd: process.env.EAK_LIVE_DEEP_RESEARCH_MAX_COST_USD || "1.00",
          maxDurationMinutes: Number(process.env.EAK_LIVE_DEEP_RESEARCH_MAX_DURATION_MINUTES || 10),
          domainWhitelist: ["example.com"],
        }),
      );
      if (!run) return undefined;
      runId = extractId(run.data, "Deep Research run");
      return runId;
    })();
    return runReady;
  }

  function ensureEvents() {
    eventsReady ??= (async () => {
      const id = await ensureRun();
      if (!id) return [];
      return collectSomeEvents(
        (signal) => client.deepResearch.events({ token, runId: id, signal }),
        { label: "deepResearch.events", referenceId: id },
      );
    })();
    return eventsReady;
  }

  it("deepResearch.run({ topic, outputFormat, targetAudience, requireOutlineApproval, maxCostUsd, maxDurationMinutes, domainWhitelist })", async () => {
    const id = await ensureRun();
    expect(id).toBeTruthy();
  });

  it("deepResearch.get({ runId })", async () => {
    const id = await ensureRun();
    if (!id) return;
    const run = await client.deepResearch.get({ token, runId: id });
    expect(run.data).toBeTruthy();
  });

  it("deepResearch.events({ runId, signal })", async () => {
    const events = await ensureEvents();
    expect(Array.isArray(events)).toBe(true);
  });

  it("deepResearch.intervene({ requestId, response })", async () => {
    const id = await ensureRun();
    if (!id) return;
    const events = await ensureEvents();
    const requestId = findRequestId(events) || process.env.EAK_LIVE_DEEP_RESEARCH_REQUEST_ID;
    if (!requestId) {
      expect("no Deep Research input request emitted").toBeTruthy();
      return;
    }
    await client.deepResearch.intervene({
      token,
      runId: id,
      requestId,
      response: "approve",
    });
  });

  it("deepResearch.followUp({ text })", async () => {
    const id = await ensureRun();
    if (!id) return;
    try {
      await client.deepResearch.followUp({ token, runId: id, text: "Keep the answer concise." });
    } catch (error) {
      if (!(error instanceof EAKError) || error.code !== "task_in_progress") throw error;
      expect(error.message).toContain("in-flight follow-up not yet supported");
    }
  });

  it("deepResearch.feedback({ rating, feedbackText })", async () => {
    const id = await ensureRun();
    if (!id) return;
    await client.deepResearch.feedback({
      token,
      runId: id,
      rating: 5,
      feedbackText: "SDK live e2e feedback",
    });
  });

  it("deepResearch.listArtifacts({ runId })", async () => {
    const id = await ensureRun();
    if (!id) return;
    const artifacts = await client.deepResearch.listArtifacts({ token, runId: id });
    expect(artifacts.data).toBeTruthy();
  });

  it("deepResearch.getArtifact({ runId, artifactId })", async () => {
    const id = await ensureRun();
    if (!id) return;
    const artifacts = await client.deepResearch.listArtifacts({ token, runId: id });
    const artifactId =
      firstArtifactId(artifacts.data) || process.env.EAK_LIVE_DEEP_RESEARCH_ARTIFACT_ID;
    if (!artifactId) {
      expect("no Deep Research artifact available").toBeTruthy();
      return;
    }
    const artifact = await client.deepResearch.getArtifact({ token, runId: id, artifactId });
    expect(artifact.data).toBeTruthy();
  });

  it("deepResearch.cancel({ runId })", async () => {
    const id = await ensureRun();
    if (!id) return;
    await client.deepResearch.cancel({ token, runId: id });
    canceled = true;
  });
});

function findRequestId(events: unknown[]): string | undefined {
  for (const event of events) {
    const requestId = nestedString(event, ["data", "data", "request_id"]) ||
      nestedString(event, ["data", "request_id"]);
    if (requestId) return requestId;
  }
  return undefined;
}

function nestedString(value: unknown, path: readonly string[]): string | undefined {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor : undefined;
}
