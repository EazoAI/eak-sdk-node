import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EAKError, EAKEventTypes, EAKTimeoutError } from "../../src";
import type { JsonObject } from "../../src";
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
      await client.doAnything.api.cancel({
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
        client.doAnything.api.createSession({
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
        client.doAnything.api.createRun({
          token,
          sessionId: sid,
          instruction: "Open https://en.wikipedia.org/wiki/Special:Random twice; report the two article titles. Then finish.",
          maxDurationMinutes: 5,
          // Subscribe screenshot events so the recording test below can save them.
          stream: {
            events: [
              EAKEventTypes.RUN_ACTION_STARTED,
              EAKEventTypes.RUN_ACTION_RESULT,
              EAKEventTypes.RUN_SCREENSHOT,
              EAKEventTypes.RUN_COMPLETED,
            ],
          },
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
    const run = await client.doAnything.api.getRun({ token, ...ids });
    expect(run.data).toBeTruthy();
  });

  it("doAnything.events({ sessionId, runId, signal, onlyTopLevel })", async () => {
    const ids = await ensureRun();
    if (!ids) return;
    await collectSomeEvents(
      (signal) =>
        client.doAnything.api.events({ token, ...ids, signal, onlyTopLevel: true }),
      { label: "doAnything.events", referenceId: ids.runId },
    );
  });

  // persist the raw event stream and per-step
  // screenshots under .secrets/runs/<sessionId>/ (override with EAK_OUT_DIR).
  it("records the event stream and screenshots to disk", async () => {
    const ids = await ensureRun();
    if (!ids) return;
    const outDir =
      process.env.EAK_OUT_DIR || path.join(process.cwd(), ".secrets", "runs", ids.sessionId);
    fs.mkdirSync(outDir, { recursive: true });
    const eventsFile = path.join(outDir, "events.jsonl");
    fs.writeFileSync(eventsFile, ""); // truncate any prior run's log
    console.log(`recording run ${ids.runId} → ${outDir}`);

    let total = 0;
    let shots = 0;
    const signal = AbortSignal.timeout(
      Number(process.env.EAK_LIVE_STREAM_TIMEOUT_MS || 60_000),
    );
    try {
      for await (const ev of client.doAnything.api.events({ token, ...ids, signal })) {
        total++;
        fs.appendFileSync(
          eventsFile,
          JSON.stringify({ receivedAt: new Date().toISOString(), ...ev }) + "\n",
        );
        const type = String(ev.event || "");
        console.log(`  [${type}] ${JSON.stringify(ev.data ?? {}).slice(0, 110)}`);
        if (type === EAKEventTypes.RUN_SCREENSHOT || type === "run.screenshot") {
          const d = (ev.data ?? {}) as JsonObject;
          const inner = (d.data ?? {}) as JsonObject;
          const url = d.screenshot_url ?? inner.screenshot_url;
          // The backend inlines the image as a data:...;base64 URI on read.
          const base64 =
            typeof url === "string" ? /^data:[^;,]*;base64,(.*)$/s.exec(url)?.[1] : undefined;
          if (base64) {
            shots++;
            const name = `${String(shots).padStart(4, "0")}.jpg`;
            fs.writeFileSync(path.join(outDir, name), Buffer.from(base64, "base64"));
            console.log(`  saved screenshot ${name}`);
          }
        }
        if (type === EAKEventTypes.RUN_COMPLETED || type === "run.completed" || type === "run.failed") {
          break;
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
    console.log(`recorded ${total} events (${shots} screenshots) → ${outDir}`);
    expect(total).toBeGreaterThan(0);
  });

  it("doAnything.intervene({ requestId, response })", async () => {
    const ids = await ensureRun();
    if (!ids) return;
    const requestId = process.env.EAK_LIVE_DO_ANYTHING_REQUEST_ID || `${livePrefix}-noop`;
    try {
      await client.doAnything.api.intervene({
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
    const recording = await client.doAnything.api.readRecording({ token, sessionId: sid });
    expect(recording.data).toBeTruthy();
  });

  it("doAnything.readArtifacts({ sessionId, artifactId })", async () => {
    const sid = await ensureSession();
    if (!sid) return;
    if (!process.env.EAK_LIVE_DO_ANYTHING_ARTIFACT_ID) {
      expect("EAK_LIVE_DO_ANYTHING_ARTIFACT_ID not configured").toBeTruthy();
      return;
    }
    const artifact = await client.doAnything.api.readArtifacts({
      token,
      sessionId: sid,
      artifactId: process.env.EAK_LIVE_DO_ANYTHING_ARTIFACT_ID,
    });
    expect(artifact.data).toBeTruthy();
  });

  it("doAnything.cancel({ sessionId, runId, reason })", async () => {
    const ids = await ensureRun();
    if (!ids) return;
    try {
      await client.doAnything.api.cancel({
        token,
        ...ids,
        reason: "sdk live e2e cleanup",
      });
    } catch (error) {
      // The recording test rides the shared run to its terminal event, so by
      // now the run may already be completed — cancel then 4xxes. Accept that.
      if (!(error instanceof EAKError) || (error.status ?? 0) < 400) throw error;
    }
    canceled = true;
  });

  it("doAnything.run({ instruction }) + wait({ timeoutMs })", async () => {
    const handle = await allowLiveEnvironmentConstraint(
      client.doAnything.run({
        token,
        instruction: "Open https://example.com and return the page title.",
        limits: { maxDurationMinutes: 5 },
      }),
    );
    if (!handle) return;
    try {
      const result = await handle.wait({
        timeoutMs: Number(process.env.EAK_LIVE_RUN_AND_WAIT_TIMEOUT_MS || 60_000),
      });
      expect(result.runId).toBe(handle.id);
    } catch (error) {
      // The client-side cap elapsed — the run keeps executing server-side;
      // clean it up so the live environment is not left with a stray run.
      if (!(error instanceof EAKTimeoutError)) throw error;
      await handle.cancel("sdk live e2e cleanup").catch(() => undefined);
    }
  });
});
