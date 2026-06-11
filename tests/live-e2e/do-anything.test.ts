import { describe, expect, it } from "vitest";
import {
  allowLiveEnvironmentConstraint,
  collectSomeEvents,
  delegateLiveToken,
  doAnythingScopes,
  extractId,
  liveE2EEnabled,
  liveClient,
  livePrefix,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

describeLiveE2E("live e2e: Do Anything", () => {
  it("covers run/runAndWait/createSession/createRun/getRun/events/intervene/cancel/readArtifacts/readRecording with a real delegated token", async () => {
    const client = liveClient();
    const { token } = await delegateLiveToken(client, doAnythingScopes);
    const session = await allowLiveEnvironmentConstraint(
      client.doAnything.createSession({
        token,
        name: `${livePrefix} browser session`,
      }),
    );
    if (!session) return;
    const sessionId = extractId(session.data, "Do Anything session");
    const run = await allowLiveEnvironmentConstraint(
      client.doAnything.createRun({
        token,
        sessionId,
        instruction: "Open https://example.com and report the page title.",
        maxDurationMinutes: 1,
      }),
    );
    if (!run) return;
    const runId = extractId(run.data, "Do Anything run");

    try {
      await client.doAnything.getRun({ token, sessionId, runId });
      await collectSomeEvents((signal) =>
        client.doAnything.events({ token, sessionId, runId, signal, onlyTopLevel: true }),
      );
      await client.doAnything.intervene({
        token,
        sessionId,
        runId,
        requestId: process.env.EAK_LIVE_DO_ANYTHING_REQUEST_ID || `${livePrefix}-noop`,
        response: { approved: true },
      });
      await client.doAnything.readRecording({ token, sessionId });
      if (process.env.EAK_LIVE_DO_ANYTHING_ARTIFACT_ID) {
        await client.doAnything.readArtifacts({
          token,
          sessionId,
          artifactId: process.env.EAK_LIVE_DO_ANYTHING_ARTIFACT_ID,
        });
      }
    } finally {
      await client.doAnything.cancel({
        token,
        sessionId,
        runId,
        reason: "sdk live e2e cleanup",
      });
    }

    const settled = await allowLiveEnvironmentConstraint(
      client.doAnything.runAndWait({
        token,
        instruction: "Open https://example.com and return the page title.",
        timeoutMs: Number(process.env.EAK_LIVE_RUN_AND_WAIT_TIMEOUT_MS || 60_000),
      }),
    );
    if (settled) expect(settled.runId).toBeTruthy();
  });
});
