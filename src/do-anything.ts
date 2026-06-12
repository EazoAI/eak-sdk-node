import { EAKValidationError } from "./errors";
import { EAKEventTypes } from "./events";
import {
  RunHandle,
  type CaptureOptions,
  type RunWireOps,
  type SessionRef,
} from "./run-handle";
import {
  isJsonObject,
  type EAKEvent,
  type EAKResponse,
  type EAKTransport,
  type JsonObject,
  type RuntimeTokenInput,
} from "./types";

/**
 * A structured snapshot of the agent's state at a single step — not just an
 * image. The screenshot is one field (an inline reference/data), alongside the
 * metadata and extracted page state captured at that moment.
 */
export interface DoAnythingSnapshot {
  /** When the snapshot was captured (ISO 8601). */
  capturedAt?: string;
  /** Which step of the run this snapshot belongs to. */
  stepIndex?: number;
  /** The page the agent was on. */
  url?: string;
  /** Title of the page, if known. */
  title?: string;
  /** The screenshot image — carried in JSON (base64) and/or by reference. */
  image?: SnapshotImage;
  /** Important interactive/visible elements extracted from the page. */
  elements?: SnapshotElement[];
  /** What the agent was doing at this step. */
  action?: SnapshotAction;
}

export interface SnapshotImage {
  /** Base64-encoded image bytes (no data: prefix). */
  base64?: string;
  /** MIME type, e.g. "image/jpeg". */
  contentType?: string;
  /** Direct URL to the image, when the backend exposes one. */
  url?: string;
  /** Artifact id, when the image is stored as an artifact. */
  artifactId?: string;
  width?: number;
  height?: number;
}

export interface SnapshotElement {
  /** Stable index the agent uses to reference this element. */
  index?: number;
  /** "button" | "link" | "input" | ... */
  role?: string;
  /** Visible label/text. */
  label?: string;
  /** Bounding box in viewport coordinates. */
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface SnapshotAction {
  /** "navigate" | "click" | "type" | ... */
  kind?: string;
  /** The element/URL/value the action targeted. */
  target?: string;
  /** Human-readable summary of the action. */
  summary?: string;
}

export interface RunLimits {
  maxDurationMinutes?: number;
  /** Decimal string to avoid float precision, e.g. "5.00". */
  maxCostUsd?: string;
}

export interface DoAnythingRunOptions {
  /** Delegation token — passed once here; the returned handle holds it. */
  token: string;
  instruction: string;
  capture?: CaptureOptions;
  limits?: RunLimits;
  /** Reuse an existing browser session; a new one is created by default. */
  session?: SessionRef;
  // Product-specific options stay camelCase.
  profileId?: string;
  workspaceId?: string;
  proxyCountryCode?: string;
  keepAlive?: boolean;
  outputSchema?: JsonObject;
  allowedActions?: string[];
  skills?: string[];
  model?: string;
  callbackUrl?: string;
  [key: string]: unknown;
}

export interface DoAnythingAttachOptions {
  token: string;
  /**
   * doAnything runs are session-scoped on the wire today — pass the
   * originating handle's `sessionRef`.
   */
  session: SessionRef;
  capture?: CaptureOptions;
}

// Core wire event subscriptions — always on, regardless of `capture`. Missing
// one of these silently starves the semantic stream, so they are never
// caller-configurable.
const CORE_RUN_EVENTS: readonly string[] = [
  EAKEventTypes.RUN_STATUS_CHANGED,
  EAKEventTypes.RUN_ACTION_STARTED,
  EAKEventTypes.RUN_ACTION_COMPLETED,
  EAKEventTypes.RUN_ACTION_FAILED,
  EAKEventTypes.RUN_ACTION_PROGRESS,
  EAKEventTypes.RUN_ACTION_RESULT,
  EAKEventTypes.RUN_INPUT_REQUEST,
  EAKEventTypes.RUN_INPUT_REQUEST_RESOLVED,
  EAKEventTypes.RUN_MESSAGE,
  EAKEventTypes.RUN_COST_UPDATE,
  EAKEventTypes.RUN_COMPLETED,
];

// `capture` → wire event subscription for the run create body.
function captureToStream(capture: CaptureOptions | undefined): JsonObject {
  return {
    events: [
      ...CORE_RUN_EVENTS,
      ...(capture?.screenshots ? [EAKEventTypes.RUN_SCREENSHOT] : []),
      ...(capture?.videoFrames ? ["browser_video_frame"] : []),
    ],
  };
}

// Input keys that live on the session-create wire body (browser/session
// level) rather than the run-create body.
const SESSION_LEVEL_KEYS: Record<string, string> = {
  profileId: "profile_id",
  workspaceId: "workspace_id",
  proxyCountryCode: "proxy_country_code",
  keepAlive: "keep_alive",
  outputSchema: "output_schema",
  recording: "recording",
  schedule: "schedule",
  agentmail: "agentmail",
  cacheScript: "cache_script",
};

export function createDoAnythingNamespace(transport: EAKTransport) {
  /**
   * Wire-level escape hatch — 1:1 with the backend HTTP contract
   * (snake_case fields, session+run double addressing). Shapes here may
   * evolve with the API and are not covered by the frozen public contract.
   */
  const api = {
    createSession: <T = unknown>(input: RuntimeTokenInput & JsonObject): Promise<EAKResponse<T>> =>
      transport.webAgentJson("POST", "/do_anything/sessions", input.token, {
        body: omit(input, "token"),
        requiredScopes: ["webagent.do_anything:manage"],
      }),

    createRun: <T = unknown>(
      input: RuntimeTokenInput & { sessionId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs`,
        input.token,
        {
          body: normalizeDoAnythingRunInput(omit(input, "token", "sessionId")),
          requiredScopes: ["webagent.do_anything:manage"],
        },
      ),

    getRun: <T = unknown>(
      input: RuntimeTokenInput & { sessionId: string; runId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}`,
        input.token,
        {
          requiredScopes: ["webagent.do_anything:read"],
        },
      ),

    events: async function* <T = unknown>(
      input: RuntimeTokenInput & {
        sessionId: string;
        runId?: string;
        lastEventId?: string;
        signal?: AbortSignal;
        /**
         * Forwarded as the `include_screenshots` query flag — set false to
         * skip `run.screenshot` rows in the replay/backfill window.
         */
        includeScreenshots?: boolean;
        /**
         * Drop events for internal sub-runs (planning / grading) and yield only
         * the top-level run's events. Requires `runId`; matches on
         * `event.data.task_id`. Default false.
         */
        onlyTopLevel?: boolean;
        onReconnect?: (info: { attempt: number; lastEventId?: string; error: unknown }) => void;
      },
    ): AsyncIterable<EAKEvent<T>> {
      const path = input.runId
        ? `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/events`
        : `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/events`;
      const stream = transport.webAgentSSE<T>(path, input.token, {
        lastEventId: input.lastEventId,
        requiredScopes: ["webagent.do_anything:read"],
        signal: input.signal,
        onReconnect: input.onReconnect,
        ...(input.includeScreenshots === undefined
          ? {}
          : { query: { include_screenshots: input.includeScreenshots } }),
      });
      for await (const event of stream) {
        if (input.onlyTopLevel && input.runId) {
          const taskId = envelopeTaskId(event);
          if (taskId && taskId !== input.runId) continue; // skip sub-run events
        }
        yield event;
      }
    },

    intervene: <T = unknown>(
      input: RuntimeTokenInput & { sessionId: string; runId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/intervene`,
        input.token,
        {
          body: normalizeDoAnythingInterveneInput(omit(input, "token", "sessionId", "runId")),
          requiredScopes: ["webagent.do_anything:manage"],
        },
      ),

    cancel: <T = unknown>(
      input: RuntimeTokenInput & { sessionId: string; runId: string; reason?: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/cancel`,
        input.token,
        {
          body: omit(input, "token", "sessionId", "runId"),
          requiredScopes: ["webagent.do_anything:manage"],
        },
      ),

    readArtifacts: <T = DoAnythingSnapshot>(
      input: RuntimeTokenInput & { sessionId: string; artifactId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/artifacts/${encodeURIComponent(input.artifactId)}`,
        input.token,
        {
          requiredScopes: ["webagent.do_anything:read"],
        },
      ),

    readRecording: <T = unknown>(
      input: RuntimeTokenInput & { sessionId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/recording`,
        input.token,
        {
          requiredScopes: ["webagent.do_anything:read"],
        },
      ),
  };

  function buildOps(
    token: string | undefined,
    sessionId: string,
    runId: string,
    capture: CaptureOptions | undefined,
  ): RunWireOps {
    return {
      getDetail: async () =>
        asRecord((await api.getRun<unknown>({ token, sessionId, runId })).data),
      streamEvents: (opts) =>
        api.events({
          token,
          sessionId,
          runId,
          lastEventId: opts.lastEventId,
          signal: opts.signal,
          // Skip screenshot rows in backfill when the caller did not opt in.
          includeScreenshots: capture?.screenshots ? undefined : false,
        }),
      respond: async (requestId, response, hasResponse) => {
        await api.intervene({
          token,
          sessionId,
          runId,
          requestId,
          ...(hasResponse ? { response } : {}),
        });
      },
      cancel: async (reason) =>
        asRecord(
          (
            await api.cancel<unknown>({
              token,
              sessionId,
              runId,
              ...(reason === undefined ? {} : { reason }),
            })
          ).data,
        ),
    };
  }

  return {
    /** Start a run. Returns a handle — see `RunHandle` for the run lifecycle. */
    run: async (input: DoAnythingRunOptions): Promise<RunHandle> => {
      const { token, instruction, capture, limits, session, ...rest } = input;
      if (!instruction || typeof instruction !== "string") {
        throw new EAKValidationError("doAnything.run requires an instruction string");
      }

      const sessionBody: JsonObject = {};
      const runBody: JsonObject = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value === undefined) continue;
        const sessionKey = SESSION_LEVEL_KEYS[key];
        if (sessionKey) sessionBody[sessionKey] = value;
        else runBody[key] = value;
      }
      if (limits?.maxDurationMinutes !== undefined) {
        sessionBody.max_duration_minutes = limits.maxDurationMinutes;
      }
      if (limits?.maxCostUsd !== undefined) {
        runBody.max_cost_usd = limits.maxCostUsd;
      }

      let sessionId = session?.sessionId;
      if (!sessionId) {
        const created = await api.createSession<{ id?: string; session_id?: string }>({
          token,
          ...sessionBody,
        });
        sessionId = created.data.id || created.data.session_id;
        if (!sessionId) {
          throw new EAKValidationError("doAnything session create did not return a session id");
        }
      }

      const run = await api.createRun<{ run_id?: string; id?: string }>({
        token,
        sessionId,
        instruction,
        ...runBody,
        stream: captureToStream(capture),
      });
      const runId = run.data.run_id || run.data.id;
      if (!runId) {
        throw new EAKValidationError("doAnything run create did not return a run id");
      }

      return new RunHandle(buildOps(token, sessionId, runId, capture), {
        id: runId,
        sessionRef: { sessionId },
        capture,
      });
    },

    /** Reconnect to an existing run. Verifies the run exists before returning. */
    attach: async (runId: string, opts: DoAnythingAttachOptions): Promise<RunHandle> => {
      const sessionId = opts.session?.sessionId;
      if (!sessionId) {
        throw new EAKValidationError(
          "doAnything.attach requires the run's session — pass { session: handle.sessionRef } " +
            "(doAnything runs are session-scoped on the wire today)",
        );
      }
      const handle = new RunHandle(buildOps(opts.token, sessionId, runId, opts.capture), {
        id: runId,
        sessionRef: { sessionId },
        capture: opts.capture,
      });
      await handle.status();
      return handle;
    },

    api,
  };
}

function normalizeDoAnythingRunInput(input: JsonObject): JsonObject {
  const body = renameKeys(input, {
    instruction: "instructions",
    profileId: "profile_id",
    workspaceId: "workspace_id",
    proxyCountryCode: "proxy_country_code",
    keepAlive: "keep_alive",
    allowedActions: "allowed_actions",
    maxDurationMinutes: "max_duration_minutes",
    outputSchema: "output_schema",
    callbackUrl: "callback_url",
  });
  return body;
}

function normalizeDoAnythingInterveneInput(input: JsonObject): JsonObject {
  const body = renameKeys(input, { requestId: "input_request_id" });
  if (body.input_request_id !== undefined && body.kind === undefined) {
    body.kind = body.response === undefined ? "skip_input_request" : "answer_input_request";
  }
  return body;
}

// The run/task id on a WebAgent run event envelope (`event.data.task_id`) —
// used to tell a top-level run's events from its internal sub-runs.
function envelopeTaskId(event: EAKEvent): string | undefined {
  const env = event.data as { task_id?: unknown } | null | undefined;
  return env && typeof env === "object" && typeof env.task_id === "string"
    ? env.task_id
    : undefined;
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
