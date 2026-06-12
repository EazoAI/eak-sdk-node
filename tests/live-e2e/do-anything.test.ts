import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EAKError } from "../../src";
import type { JsonObject, RunHandle, RunResult } from "../../src";
import {
  allowLiveEnvironmentConstraint,
  collectRunEvents,
  delegateLiveToken,
  doAnythingScopes,
  liveE2EEnabled,
  liveClient,
  livePrefix,
  openRawEventRecorder,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

// The exact Wikipedia article title the browsing task below must surface.
const EXPECTED_TITLE_RE = /universally unique identifier/i;

// Live coverage of the frozen contract's mainline (public-surface doc §2/§4):
// run() → RunHandle → wait(), token passed once at the entry call, screenshots
// via the semantic capture switch, domain content asserted from result.output.
describeLiveE2E("live e2e: Do Anything (semantic surface)", () => {
  let client: ReturnType<typeof liveClient>;
  let token: string;
  let run: RunHandle | undefined;
  let runReady: Promise<RunHandle | undefined> | undefined;
  let resultReady: Promise<RunResult | undefined> | undefined;
  let recordedEvents = 0;
  let savedScreenshots = 0;
  let recordedDir: string | undefined;

  beforeAll(async () => {
    client = liveClient();
    token = (await delegateLiveToken(client, doAnythingScopes)).token;
  });

  afterAll(async () => {
    // Semantic cancel is idempotent — safe even when the run already settled.
    await run?.cancel("sdk live e2e cleanup").catch(() => undefined);
  });

  // One run shared across the file: token passed ONCE at the entry call,
  // every later operation goes through the handle.
  function ensureRun() {
    runReady ??= (async () => {
      const handle = await allowLiveEnvironmentConstraint(
        client.doAnything.run({
          token,
          // A task that REQUIRES browsing (search box interaction): plain
          // URL-fetch phrasings get routed to the fetch/textify agents, which
          // never produce screenshots. The answer is still deterministic —
          // the article's exact title.
          instruction:
            "Open https://en.wikipedia.org in the browser, use the site search to find " +
            "the article about the UUID standard, open it, and report the article's exact title.",
          capture: { screenshots: true },
          limits: { maxDurationMinutes: 5 },
        }),
      );
      run = handle ?? undefined;
      return run;
    })();
    return runReady;
  }

  // One wait() shared across the file. Records the raw wire stream and the
  // decoded per-step screenshots to disk while waiting — every semantic event
  // carries the original wire envelope on `event.raw`, and `capture` +
  // `onScreenshot` deliver decoded image bytes; no api.* needed.
  function ensureResult() {
    resultReady ??= (async () => {
      const handle = await ensureRun();
      if (!handle) return undefined;
      const recorder = openRawEventRecorder(`do_anything-${handle.id}`);
      recordedDir = recorder.dir;
      console.log(`recording run ${handle.id} → ${recorder.dir}`);
      const result = await handle.wait({
        timeoutMs: Number(process.env.EAK_LIVE_RUN_AND_WAIT_TIMEOUT_MS || 360_000),
        onEvent: (event) => recorder.record(event),
        onScreenshot: (image) => {
          expect(image.bytes.byteLength).toBeGreaterThan(0);
          expect(image.mime).toMatch(/^image\//);
          savedScreenshots++;
          const name = `${String(savedScreenshots).padStart(4, "0")}.jpg`;
          fs.writeFileSync(path.join(recorder.dir, name), image.bytes);
          console.log(`  saved screenshot ${name}`);
        },
      });
      recordedEvents = recorder.count();
      console.log(
        `recorded ${recordedEvents} events (${savedScreenshots} screenshots) → ${recorder.file}`,
      );
      return result;
    })();
    return resultReady;
  }

  it("doAnything.run({ token, instruction, capture, limits }) returns a handle", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    expect(handle.id).toBeTruthy();
    expect(handle.sessionRef?.sessionId).toBeTruthy();
  });

  it("run.status() refreshes the run without re-passing token or ids", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    const status = await handle.status();
    expect(status.id).toBe(handle.id);
    expect(status.status).toBeTruthy();
  });

  it("run.events() yields normalized semantic events", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    const events = await collectRunEvents((signal) => handle.events({ signal }), {
      label: "doAnything run.events",
      minEvents: 2,
    });
    expect(events.some((event) => event.runId === handle.id)).toBe(true);
  });

  it("run.wait() returns the article title, raw events and screenshots on disk", async () => {
    const result = await ensureResult();
    if (!result) return;

    // Real domain content, not a status echo: the answer must contain the
    // exact title of the article the agent navigated to.
    expect(result.status).toBe("succeeded");
    expect(JSON.stringify(result.output ?? "")).toMatch(EXPECTED_TITLE_RE);

    // capture: { screenshots: true } must produce at least one decoded
    // per-step screenshot — silently delivering none is the wire-enum
    // foot-gun the capture switch exists to remove.
    expect(savedScreenshots).toBeGreaterThan(0);
    expect(recordedEvents).toBeGreaterThan(0);
    expect(recordedDir && fs.existsSync(path.join(recordedDir, "events.jsonl"))).toBe(true);
  });

  it("run.respond() surfaces a wire error for an unknown input request", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    const requestId = process.env.EAK_LIVE_DO_ANYTHING_REQUEST_ID || `${livePrefix}-noop`;
    try {
      await handle.respond(requestId, { approved: true });
      // Reaching here is only expected when a real pending request id was
      // injected via EAK_LIVE_DO_ANYTHING_REQUEST_ID.
    } catch (error) {
      if (process.env.EAK_LIVE_DO_ANYTHING_REQUEST_ID || !(error instanceof EAKError)) {
        throw error;
      }
      expect(error.status).toBeGreaterThanOrEqual(400);
      expect(error.code).toBeTruthy();
    }
  });

  it("run.cancel() is idempotent on a settled run", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    await ensureResult();
    // The contract makes cancel idempotent: cancelling a terminal run returns
    // its terminal state instead of throwing a wire 4xx.
    const status = await handle.cancel("sdk live e2e cleanup");
    expect(["succeeded", "failed", "canceled"]).toContain(status.status);
  });

  it("doAnything.attach() reconnects to the run by id alone", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    const reattached = await client.doAnything.attach(handle.id, { token });
    expect(reattached.id).toBe(handle.id);
    const status = await reattached.status();
    expect(status.id).toBe(handle.id);
    // sessionRef is adopted from the run detail envelope.
    expect(reattached.sessionRef?.sessionId).toBeTruthy();
  });

  // Escape-hatch smoke: the wire layer (api.*) must keep working for advanced
  // users, but it appears ONLY here — everything above is semantic. The
  // session recording read has no semantic counterpart by design (§9 keeps
  // readRecording wire-level).
  it("escape hatch: api.getRun / api.readRecording still speak wire", async () => {
    const handle = await ensureRun();
    if (!handle?.sessionRef) return;
    const sessionId = handle.sessionRef.sessionId;
    const wire = await client.doAnything.api.getRun<JsonObject>({
      token,
      runId: handle.id,
    });
    expect(wire.data).toBeTruthy();
    expect(typeof wire.data.status).toBe("string");
    const recording = await client.doAnything.api.readRecording({ token, sessionId });
    expect(recording.data).toBeTruthy();
  });
});
