import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EAKError } from "../../src";
import {
  allowLiveEnvironmentConstraint,
  collectSomeEvents,
  delegateLiveToken,
  extractId,
  liveE2EEnabled,
  liveClient,
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
          // A real, evergreen query that search engines can always match.
          // Do NOT embed livePrefix here: engines tokenize the nonce into
          // noise ("sdk", "live") and return 0 hits or junk nondeterministically;
          // run traceability comes from runId, not the query text.
          query: "EAK SDK quickstart guide",
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

  it("webSearch.events({ runId, signal })", async () => {
    const id = await ensureRun();
    if (!id) return;
    await collectSomeEvents(
      (signal) => client.webSearch.events({ token, runId: id, signal }),
      { label: "webSearch.events", referenceId: id },
    );
  });

  // Same recording pattern as do-anything: persist the raw event stream under
  // .secrets/runs/web_search-<runId>/ (override with EAK_OUT_DIR) and echo
  // each event to the console as it arrives.
  it("records the event stream to disk", async () => {
    const id = await ensureRun();
    if (!id) return;
    const outDir =
      process.env.EAK_OUT_DIR || path.join(process.cwd(), ".secrets", "runs", `web_search-${id}`);
    fs.mkdirSync(outDir, { recursive: true });
    const eventsFile = path.join(outDir, "events.jsonl");
    fs.writeFileSync(eventsFile, ""); // truncate any prior run's log
    console.log(`recording run ${id} → ${outDir}`);

    let total = 0;
    const signal = AbortSignal.timeout(
      Number(process.env.EAK_LIVE_STREAM_TIMEOUT_MS || 60_000),
    );
    try {
      for await (const ev of client.webSearch.events({ token, runId: id, signal })) {
        total++;
        fs.appendFileSync(
          eventsFile,
          JSON.stringify({ receivedAt: new Date().toISOString(), ...ev }) + "\n",
        );
        const type = String(ev.event || "");
        console.log(`  [${type}] ${JSON.stringify(ev.data ?? {}).slice(0, 110)}`);
        if (type === "run.completed") {
          // The run was created with maxResultsPerQuery: 1 — assert the
          // server actually honored the cap, not just accepted the field.
          const results = (ev.data as { output?: { results?: unknown[] } } | undefined)?.output
            ?.results;
          if (Array.isArray(results)) {
            expect(results.length).toBeLessThanOrEqual(1);
            // The run was created with siteWhitelist — every returned URL
            // must be on (or under) one of the whitelisted hosts.
            const whitelist = ["eazo.ai", "authing.cn"];
            for (const item of results as Array<{ url?: string }>) {
              if (!item?.url) continue;
              const host = new URL(item.url).hostname.toLowerCase();
              expect(
                whitelist.some((d) => host === d || host.endsWith(`.${d}`)),
                `result ${item.url} is off-whitelist`,
              ).toBe(true);
            }
          }
        }
        if (type === "run.completed" || type === "run.failed") break;
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    }
    console.log(`recorded ${total} events → ${eventsFile}`);
    expect(total).toBeGreaterThan(0);
  });

  it("webSearch.cancel({ runId, reason })", async () => {
    const id = await ensureRun();
    if (!id) return;
    try {
      await client.webSearch.cancel({ token, runId: id, reason: "sdk live e2e cleanup" });
    } catch (error) {
      // The recording test may have ridden the run to its terminal event —
      // canceling a finished run 4xxes. Accept that.
      if (!(error instanceof EAKError) || (error.status ?? 0) < 400) throw error;
    }
    canceled = true;
  });
});
