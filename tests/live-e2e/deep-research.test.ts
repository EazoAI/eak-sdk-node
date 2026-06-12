import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EAKValidationError } from "../../src";
import type { JsonObject, RunHandle, RunResult } from "../../src";
import {
  allowLiveEnvironmentConstraint,
  collectRunEvents,
  deepResearchScopes,
  delegateLiveToken,
  liveE2EEnabled,
  liveClient,
  openRawEventRecorder,
} from "./helpers";

const describeLiveE2E = liveE2EEnabled ? describe : describe.skip;

// A deepResearch run takes 3-7 real minutes AFTER outline approval (the gate
// itself arrives ~1 minute in), so it gets a budget independent of the
// generic stream timeout the other products use.
const DR_WAIT_TIMEOUT_MS = Number(
  process.env.EAK_LIVE_DEEP_RESEARCH_WAIT_TIMEOUT_MS || 600_000,
);

describeLiveE2E("live e2e: Deep Research (semantic surface)", () => {
  let client: ReturnType<typeof liveClient>;
  let token: string;
  let run: RunHandle | undefined;
  let runReady: Promise<RunHandle | undefined> | undefined;
  let resultReady: Promise<RunResult | undefined> | undefined;
  let recordedEvents = 0;
  let recordedFile: string | undefined;
  const approvedRequests: string[] = [];

  beforeAll(async () => {
    client = liveClient();
    token = (await delegateLiveToken(client, deepResearchScopes)).token;
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
        client.deepResearch.run({
          token,
          // Plain researchable topic — no nonce: the topic fans out into real
          // web searches where a nonce only adds noise; run traceability
          // comes from run.id.
          topic: "simply summarize the public example.com page in one paragraph",
          // "light" shrinks the outline section count and the per-section
          // gather budget — standard depth fans this trivial topic into a
          // multi-section plan that runs well past any sane test budget.
          depth: "light",
          outputFormat: "report",
          targetAudience: "SDK maintainers",
          requireOutlineApproval: true,
          limits: {
            maxCostUsd: process.env.EAK_LIVE_DEEP_RESEARCH_MAX_COST_USD || "1.00",
            maxDurationMinutes: Number(
              process.env.EAK_LIVE_DEEP_RESEARCH_MAX_DURATION_MINUTES || 10,
            ),
          },
          domainWhitelist: ["example.com"],
        }),
      );
      run = handle ?? undefined;
      return run;
    })();
    return runReady;
  }

  // One wait() shared across the file — this is the contract's §2 mainline.
  // The run is created with requireOutlineApproval: true, so it parks on an
  // outline-gate input request after PLAN; `onInputRequest` answers it through
  // run.respond(requestId, "approve"). Without this the run waits for a human
  // forever. The recorder persists every original wire envelope (event.raw)
  // under .secrets/runs/deep_research-<runId>/ (EAK_OUT_DIR overrides).
  function ensureResult() {
    resultReady ??= (async () => {
      const handle = await ensureRun();
      if (!handle) return undefined;
      const recorder = openRawEventRecorder(`deep_research-${handle.id}`);
      recordedFile = recorder.file;
      console.log(`recording run ${handle.id} → ${recorder.dir}`);
      const result = await handle.wait({
        timeoutMs: DR_WAIT_TIMEOUT_MS,
        onEvent: (event) => recorder.record(event),
        onInputRequest: async (request) => {
          const requestId = typeof request.requestId === "string" ? request.requestId : "";
          // The outline gate must carry its request id (the SDK cannot answer
          // a gate it cannot address) — empty means the backend regressed.
          expect(requestId, "input request should carry requestId").toBeTruthy();
          if (approvedRequests.includes(requestId)) return; // replayed event
          await handle.respond(requestId, "approve");
          approvedRequests.push(requestId);
          console.log(`  approved outline gate (request ${requestId})`);
        },
      });
      recordedEvents = recorder.count();
      console.log(`recorded ${recordedEvents} events → ${recorder.file}`);
      return result;
    })();
    return resultReady;
  }

  it("deepResearch.run({ token, topic, requireOutlineApproval, limits, ... }) returns a handle", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    expect(handle.id).toBeTruthy();
  });

  it("run.status() refreshes the run without re-passing token or id", async () => {
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
      label: "deepResearch run.events",
    });
    expect(events.some((event) => event.runId === handle.id)).toBe(true);
  });

  it("run.respond() without a response fails loudly — the outline gate cannot be skipped", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    await expect(handle.respond("any-request")).rejects.toThrowError(EAKValidationError);
  });

  it(
    "run.wait() approves the outline gate via respond() and settles with a real report",
    async () => {
      const result = await ensureResult();
      if (!result) return;

      // The gate must have been answered through the semantic surface.
      expect(approvedRequests.length).toBeGreaterThan(0);

      expect(result.status).toBe("succeeded");
      // Domain content: a report, not a status flip. The settled output must
      // be substantial prose about the researched page.
      const reportText = JSON.stringify(result.output ?? "");
      expect(reportText.length).toBeGreaterThan(200);
      expect(reportText.toLowerCase()).toContain("example");

      // Deliverables ride on the settled result (contract §4): deepResearch
      // produces artifacts; content is fetched lazily through the handle.
      expect(Array.isArray(result.artifacts)).toBe(true);
      if (result.artifacts.length > 0) {
        const first = result.artifacts[0];
        expect(first.id).toBeTruthy();
        const bytes = await first.content();
        expect(bytes.byteLength).toBeGreaterThan(0);
      } else {
        console.log("note: run settled with zero artifacts — report only in output");
      }

      expect(recordedEvents).toBeGreaterThan(0);
      expect(recordedFile && fs.existsSync(recordedFile)).toBe(true);
    },
    DR_WAIT_TIMEOUT_MS + 60_000,
  );

  it("run.cancel() is idempotent on a settled run", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    await ensureResult();
    // The contract makes cancel idempotent: cancelling a terminal run returns
    // its terminal state instead of throwing a wire 4xx.
    const status = await handle.cancel("sdk live e2e cleanup");
    expect(["succeeded", "failed", "canceled"]).toContain(status.status);
  });

  // Escape-hatch smoke: the wire layer (api.*) must keep working for advanced
  // users, but it appears ONLY here — everything above is semantic. Report
  // feedback is an application-level capability that exists only on the wire
  // (contract §9), so it is exercised here rather than via the handle.
  it("escape hatch: api.get / api.feedback still speak wire", async () => {
    const handle = await ensureRun();
    if (!handle) return;
    await ensureResult();
    const wire = await client.deepResearch.api.get<JsonObject>({ token, runId: handle.id });
    expect(wire.data).toBeTruthy();
    expect(typeof wire.data.status).toBe("string");
    await client.deepResearch.api.feedback({
      token,
      runId: handle.id,
      rating: 5,
      feedbackText: "SDK live e2e feedback",
    });
  });
});
