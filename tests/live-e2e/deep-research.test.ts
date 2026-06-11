import { describe, expect, it } from "vitest";
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
  it("covers run/get/events/intervene/followUp/cancel/feedback/listArtifacts/getArtifact with a real delegated token", async () => {
    const client = liveClient();
    const { token } = await delegateLiveToken(client, deepResearchScopes);
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
    if (!run) return;
    const runId = extractId(run.data, "Deep Research run");

    try {
      await client.deepResearch.get({ token, runId });
      const events = await collectSomeEvents((signal) =>
        client.deepResearch.events({ token, runId, signal }),
      );
      const requestId =
        findRequestId(events) || process.env.EAK_LIVE_DEEP_RESEARCH_REQUEST_ID;
      if (requestId) {
        await client.deepResearch.intervene({
          token,
          runId,
          requestId,
          response: "approve",
        });
      }
      await client.deepResearch.followUp({ token, runId, text: "Keep the answer concise." });
      await client.deepResearch.feedback({
        token,
        runId,
        rating: 5,
        feedbackText: "SDK live e2e feedback",
      });
      const artifacts = await client.deepResearch.listArtifacts({ token, runId });
      const artifactId =
        firstArtifactId(artifacts.data) || process.env.EAK_LIVE_DEEP_RESEARCH_ARTIFACT_ID;
      if (artifactId) {
        await client.deepResearch.getArtifact({ token, runId, artifactId });
      }
    } finally {
      await client.deepResearch.cancel({ token, runId });
    }

    expect(runId).toBeTruthy();
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
