import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EAKError } from "../../src";
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
  let client: ReturnType<typeof liveClient>;
  let token: string;
  let sessionId: string | undefined;
  let runId: string | undefined;
  let sessionReady: Promise<string | undefined> | undefined;
  let runReady: Promise<{ sessionId: string; runId: string } | undefined> | undefined;
  let canceled = false;

  beforeAll(async () => {
    client = liveClient();
    token = (await delegateLiveToken(client, doAnythingScopes)).token;
  });

  afterAll(async () => {
    if (sessionId && runId && !canceled) {
      await client.doAnything.cancel({
        token,
        sessionId,
        runId,
        reason: "sdk live e2e cleanup",
      }).catch(() => undefined);
    }
  });

  function ensureSession() {
    sessionReady ??= (async () => {
      const session = await allowLiveEnvironmentConstraint(
        client.doAnything.createSession({
          token,
          name: `${livePrefix} browser session`,
        }),
      );
      if (!session) return undefined;
      sessionId = extractId(session.data, "Do Anything session");
      return sessionId;
    })();
    return sessionReady;
  }

  function ensureRun() {
    runReady ??= (async () => {
      const sid = await ensureSession();
      if (!sid) return undefined;
      const run = await allowLiveEnvironmentConstraint(
        client.doAnything.createRun({
          token,
          sessionId: sid,
          instruction: "Open https://example.com and report the page title.",
          maxDurationMinutes: 1,
        }),
      );
      if (!run) return undefined;
      runId = extractId(run.data, "Do Anything run");
      return { sessionId: sid, runId };
    })();
    return runReady;
  }

  it("doAnything.createSession({ name })", async () => {
    const id = await ensureSession();
    expect(id).toBeTruthy();
  });

  it("doAnything.createRun({ sessionId, instruction, maxDurationMinutes })", async () => {
    const ids = await ensureRun();
    expect(ids?.runId).toBeTruthy();
  });

  it("doAnything.getRun({ sessionId, runId })", async () => {
    const ids = await ensureRun();
    if (!ids) return;
    const run = await client.doAnything.getRun({ token, ...ids });
    expect(run.data).toBeTruthy();
  });

  it("doAnything.events({ sessionId, runId, signal, onlyTopLevel })", async () => {
    const ids = await ensureRun();
    if (!ids) return;
    await collectSomeEvents(
      (signal) =>
        client.doAnything.events({ token, ...ids, signal, onlyTopLevel: true }),
      { label: "doAnything.events", referenceId: ids.runId },
    );
  });

  it("doAnything.intervene({ requestId, response })", async () => {
    const ids = await ensureRun();
    if (!ids) return;
    const requestId = process.env.EAK_LIVE_DO_ANYTHING_REQUEST_ID || `${livePrefix}-noop`;
    try {
      await client.doAnything.intervene({
        token,
        ...ids,
        requestId,
        response: { approved: true },
      });
    } catch (error) {
      if (process.env.EAK_LIVE_DO_ANYTHING_REQUEST_ID || !(error instanceof EAKError)) {
        throw error;
      }
      expect(error.status).toBeGreaterThanOrEqual(400);
      expect(error.code).toBeTruthy();
    }
  });

  it("doAnything.readRecording({ sessionId })", async () => {
    const sid = await ensureSession();
    if (!sid) return;
    const recording = await client.doAnything.readRecording({ token, sessionId: sid });
    expect(recording.data).toBeTruthy();
  });

  it("doAnything.readArtifacts({ sessionId, artifactId })", async () => {
    const sid = await ensureSession();
    if (!sid) return;
    if (!process.env.EAK_LIVE_DO_ANYTHING_ARTIFACT_ID) {
      expect("EAK_LIVE_DO_ANYTHING_ARTIFACT_ID not configured").toBeTruthy();
      return;
    }
    const artifact = await client.doAnything.readArtifacts({
      token,
      sessionId: sid,
      artifactId: process.env.EAK_LIVE_DO_ANYTHING_ARTIFACT_ID,
    });
    expect(artifact.data).toBeTruthy();
  });

  it("doAnything.cancel({ sessionId, runId, reason })", async () => {
    const ids = await ensureRun();
    if (!ids) return;
    await client.doAnything.cancel({
      token,
      ...ids,
      reason: "sdk live e2e cleanup",
    });
    canceled = true;
  });

  it("doAnything.runAndWait({ instruction, timeoutMs })", async () => {
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
