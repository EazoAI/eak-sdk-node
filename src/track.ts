import { EAKValidationError } from "./errors";
import { camelizeRecord, normalizeRunEvent, type MonitorEvent } from "./run-events";
import {
  isJsonObject,
  type EAKEvent,
  type EAKResponse,
  type EAKTransport,
  type JsonObject,
  type RuntimeTokenInput,
} from "./types";

export interface TrackCreateOptions {
  /** Delegation token — passed once here; the returned handle holds it. */
  token: string;
  /** Natural-language description of what to monitor. */
  prompt: string;
  /** Rest of the monitor definition (url, schedule, …) — camelCase keys. */
  [key: string]: unknown;
}

export interface TrackAttachOptions {
  token: string;
}

export interface MonitorEventsOptions {
  lastEventId?: string;
  signal?: AbortSignal;
}

export interface MonitorRunsOptions {
  limit?: number;
  offset?: number;
}

interface MonitorWireOps {
  get(): Promise<JsonObject>;
  update(input: JsonObject): Promise<JsonObject>;
  runNow(): Promise<JsonObject>;
  streamEvents(opts: MonitorEventsOptions): AsyncIterable<EAKEvent<unknown>>;
  respond(requestId: string, response: unknown, hasResponse: boolean): Promise<void>;
  listRuns(opts: MonitorRunsOptions): Promise<JsonObject>;
  getRun(runId: string): Promise<JsonObject>;
  delete(): Promise<void>;
}

/**
 * Handle to a Track monitor — a resident resource (unlike a one-shot run).
 * Holds the delegation token and monitor id internally; no method takes a
 * token or an id.
 */
export class MonitorHandle {
  readonly id: string;

  constructor(private readonly ops: MonitorWireOps, id: string) {
    this.id = id;
  }

  /** Refresh and return the monitor (normalized camelCase fields). */
  async get(): Promise<JsonObject> {
    return camelizeRecord(await this.ops.get());
  }

  /** Update the monitor definition (camelCase keys accepted). */
  async update(input: JsonObject): Promise<JsonObject> {
    return camelizeRecord(await this.ops.update(snakeifyKeys(input)));
  }

  /** Trigger an immediate tick outside the schedule. */
  async runNow(): Promise<JsonObject> {
    return camelizeRecord(await this.ops.runNow());
  }

  /**
   * Stream semantic monitor events. Monitors are resident, so the stream has
   * no terminal event — it ends only when closed by the caller or the server.
   */
  async *events(opts: MonitorEventsOptions = {}): AsyncIterable<MonitorEvent> {
    for await (const wire of this.ops.streamEvents(opts)) {
      const event = normalizeRunEvent(wire);
      // The monitor stream only carries core + Track events; the cast narrows
      // the full RunEvent union to that subset.
      if (event) yield event as MonitorEvent;
    }
  }

  /**
   * Answer a HITL request on the monitor (e.g. unlock a `needs_reauth` park
   * after the user re-logged in). Omitting `response` skips the request.
   */
  async respond(requestId: string, response?: unknown): Promise<void> {
    await this.ops.respond(requestId, response, response !== undefined);
  }

  /**
   * Read-only list of the runs the monitor's ticks produced. Tick runs are
   * owned by the scheduler — to stop monitoring use `update()` / `delete()`.
   */
  async runs(opts: MonitorRunsOptions = {}): Promise<JsonObject[]> {
    const data = await this.ops.listRuns(opts);
    const items = Array.isArray(data.items) ? data.items : Array.isArray(data.runs) ? data.runs : [];
    return items.filter(isJsonObject).map(normalizeMonitorRun);
  }

  /** Read-only detail of a single tick run. */
  async run(runId: string): Promise<JsonObject> {
    return normalizeMonitorRun(await this.ops.getRun(runId));
  }

  /** Delete the monitor. */
  async delete(): Promise<void> {
    await this.ops.delete();
  }
}

export function createTrackNamespace(transport: EAKTransport) {
  /**
   * Wire-level escape hatch — 1:1 with the backend HTTP contract. Shapes
   * here may evolve with the API and are not covered by the frozen public
   * contract.
   */
  const api = {
    createMonitor: <T = unknown>(input: RuntimeTokenInput & JsonObject): Promise<EAKResponse<T>> =>
      transport.webAgentJson("POST", "/track/monitors", input.token, {
        body: omit(input, "token"),
        requiredScopes: ["webagent.track:manage"],
      }),

    getMonitor: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/track/monitors/${encodeURIComponent(input.monitorId)}`,
        input.token,
        {
          requiredScopes: ["webagent.track:read"],
        },
      ),

    runNow: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/track/monitors/${encodeURIComponent(input.monitorId)}/run_now`,
        input.token,
        {
          body: {},
          requiredScopes: ["webagent.track:manage"],
        },
      ),

    events: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string; lastEventId?: string; signal?: AbortSignal },
    ): AsyncIterable<EAKEvent<T>> =>
      transport.webAgentSSE(
        `/track/monitors/${encodeURIComponent(input.monitorId)}/events`,
        input.token,
        {
          lastEventId: input.lastEventId,
          requiredScopes: ["webagent.track:read"],
          signal: input.signal,
        },
      ),

    intervene: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/track/monitors/${encodeURIComponent(input.monitorId)}/intervene`,
        input.token,
        {
          body: normalizeTrackInterveneInput(omit(input, "token", "monitorId")),
          requiredScopes: ["webagent.track:manage"],
        },
      ),

    listRuns: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string; limit?: number; offset?: number },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/track/monitors/${encodeURIComponent(input.monitorId)}/runs`,
        input.token,
        {
          query: omit(input, "token", "monitorId"),
          requiredScopes: ["webagent.track:read"],
        },
      ),

    getRun: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string; runId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/track/monitors/${encodeURIComponent(input.monitorId)}/runs/${encodeURIComponent(input.runId)}`,
        input.token,
        {
          requiredScopes: ["webagent.track:read"],
        },
      ),

    updateMonitor: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "PATCH",
        `/track/monitors/${encodeURIComponent(input.monitorId)}`,
        input.token,
        {
          body: omit(input, "token", "monitorId"),
          requiredScopes: ["webagent.track:manage"],
        },
      ),

    deleteMonitor: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "DELETE",
        `/track/monitors/${encodeURIComponent(input.monitorId)}`,
        input.token,
        {
          // Backend DELETE /track/monitors/{id} requires track:manage
          // (see api/v1/track/monitors.py:delete_monitor).
          requiredScopes: ["webagent.track:manage"],
        },
      ),
  };

  function buildOps(token: string | undefined, monitorId: string): MonitorWireOps {
    return {
      get: async () => asRecord((await api.getMonitor<unknown>({ token, monitorId })).data),
      update: async (input) =>
        asRecord((await api.updateMonitor<unknown>({ token, monitorId, ...input })).data),
      runNow: async () => asRecord((await api.runNow<unknown>({ token, monitorId })).data),
      streamEvents: (opts) =>
        api.events({ token, monitorId, lastEventId: opts.lastEventId, signal: opts.signal }),
      respond: async (requestId, response, hasResponse) => {
        await api.intervene({
          token,
          monitorId,
          requestId,
          kind: hasResponse ? "answer" : "skip",
          ...(hasResponse ? { response } : {}),
        });
      },
      listRuns: async (opts) =>
        asRecord((await api.listRuns<unknown>({ token, monitorId, ...opts })).data),
      getRun: async (runId) =>
        asRecord((await api.getRun<unknown>({ token, monitorId, runId })).data),
      delete: async () => {
        await api.deleteMonitor({ token, monitorId });
      },
    };
  }

  return {
    /** Create a monitor. Returns a handle — see `MonitorHandle`. */
    create: async (input: TrackCreateOptions): Promise<MonitorHandle> => {
      const { token, prompt, ...rest } = input;
      if (!prompt || typeof prompt !== "string") {
        throw new EAKValidationError("track.create requires a prompt string");
      }
      const created = await api.createMonitor<{ id?: string; monitor_id?: string }>({
        token,
        intent: prompt,
        ...snakeifyKeys(rest),
      });
      const monitorId = created.data.id || created.data.monitor_id;
      if (!monitorId) {
        throw new EAKValidationError("track monitor create did not return a monitor id");
      }
      return new MonitorHandle(buildOps(token, monitorId), monitorId);
    },

    /** Reconnect to an existing monitor. Verifies it exists before returning. */
    attach: async (monitorId: string, opts: TrackAttachOptions): Promise<MonitorHandle> => {
      const handle = new MonitorHandle(buildOps(opts.token, monitorId), monitorId);
      await handle.get();
      return handle;
    },

    api,
  };
}

// Tick runs are read-only views — normalize to camelCase and guarantee a
// uniform `id` regardless of which wire field carried it.
function normalizeMonitorRun(item: JsonObject): JsonObject {
  const normalized = camelizeRecord(item);
  if (typeof normalized.id !== "string" || !normalized.id) {
    const id = normalized.runId ?? normalized.snapshotId;
    if (typeof id === "string" && id) normalized.id = id;
  }
  return normalized;
}

function normalizeTrackInterveneInput(input: JsonObject): JsonObject {
  return renameKeys(input, { requestId: "request_id" });
}

/** Shallow camelCase → snake_case for wire bodies; nested values untouched. */
function snakeifyKeys(value: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    out[key.replace(/([A-Z])/g, (_, ch: string) => `_${ch.toLowerCase()}`)] = item;
  }
  return out;
}

function asRecord(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

function omit(value: object, ...keys: string[]): JsonObject {
  const skipped = new Set(keys);
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (!skipped.has(key) && item !== undefined) out[key] = item;
  }
  return out;
}

function renameKeys(value: JsonObject, mapping: Record<string, string>): JsonObject {
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const target = mapping[key] || key;
    if (out[target] === undefined) out[target] = item;
  }
  return out;
}
