import { EAKEventTypes } from "./events";
import type {
  EAKEvent,
  EAKResponse,
  EAKTransport,
  JsonObject,
  RuntimeTokenInput,
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

export interface DoAnythingRunInput extends RuntimeTokenInput {
  instruction?: string;
  /** @deprecated Use instruction. */
  instructions?: string;
  session?: JsonObject;
  stream?: { events?: string[]; includeFrames?: boolean };
  tools?: JsonObject;
  [key: string]: unknown;
}

/**
 * Result of `doAnything.run` — the run envelope returned by the backend.
 * Wire keys are snake_case `run_id` / `session_id` (the canonical run
 * naming shared by Do Anything, Deep Research, and Web Search). Pass both
 * to `events`/`getRun`/`intervene`/`cancel` to address the run. Other
 * envelope fields (status, output, costs, …) ride along under the index
 * signature.
 */
export interface DoAnythingRunResult {
  run_id: string;
  session_id: string;
  [key: string]: unknown;
}

/** Settled outcome of `doAnything.runAndWait`. */
export interface DoAnythingResult {
  runId: string;
  sessionId: string;
  /** Mapped terminal status. `timed_out` is client-side (the `timeoutMs` cap elapsed). */
  status: "succeeded" | "failed" | "canceled" | "timed_out";
  /** Backend `terminal_reason` (done / failed / canceled / expired), when known. */
  terminalReason?: string;
  /** Whether the backend judged the task successful, when reported. */
  isTaskSuccessful?: boolean;
  /** Final answer / output payload (shape is task-specific). */
  output?: unknown;
  /**
   * The full run envelope (settled from `getRun`) for fields not mapped above —
   * `total_cost_usd`, `step_count`, `total_input_tokens`, etc. The `run.completed`
   * event payload is leaner than the run-detail response, so `runAndWait` reads
   * the canonical shape here.
   */
  raw?: JsonObject;
}

/**
 * Input for `doAnything.runAndWait`: a `run()` input plus per-event hooks and a
 * wall-clock cap. Hooks receive the event payload (`event.data.data`) and the
 * raw event. Hook / timeout / signal fields are not forwarded to the backend.
 */
export interface DoAnythingRunAndWaitInput extends DoAnythingRunInput {
  onEvent?: (event: EAKEvent) => void | Promise<void>;
  onAction?: (payload: JsonObject, event: EAKEvent) => void | Promise<void>;
  onScreenshot?: (payload: JsonObject, event: EAKEvent) => void | Promise<void>;
  /** Fires on `run.input_request` (login / confirm). `payload.live_url` is the live browser, when present. */
  onInputRequest?: (payload: JsonObject, event: EAKEvent) => void | Promise<void>;
  /** Fires on `run.cost_update` — use for a live running-cost / budget guard. */
  onCostUpdate?: (payload: JsonObject, event: EAKEvent) => void | Promise<void>;
  /** Client-side wall-clock cap. On elapse, resolves with status `timed_out` (does NOT cancel the backend run). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function createDoAnythingNamespace(transport: EAKTransport) {
  const namespace = {
    run: async <T = DoAnythingRunResult>(input: DoAnythingRunInput): Promise<EAKResponse<T>> => {
      const session = await namespace.createSession<{ id?: string; session_id?: string }>({
        token: input.token,
        ...(input.session || {}),
      });
      const sessionId = session.data.id || session.data.session_id;
      if (!sessionId) throw new Error("doAnything.createSession did not return a session id");
      const run = await namespace.createRun<T>({
        ...omit(input, "session"),
        token: input.token,
        sessionId,
      });
      return attachSessionId(run, sessionId);
    },

    // High-level: start a run and drive its event stream to a terminal state,
    // returning a settled { status, output, ... }. Internally handles run() +
    // events() + RUN_COMPLETED detection + a getRun() fallback if the stream
    // closes without a terminal event. Use events() directly for fine control.
    runAndWait: async (input: DoAnythingRunAndWaitInput): Promise<DoAnythingResult> => {
      const {
        onEvent,
        onAction,
        onScreenshot,
        onInputRequest,
        onCostUpdate,
        timeoutMs,
        signal,
        ...runInput
      } = input;
      const run = await namespace.run<DoAnythingRunResult>(runInput as DoAnythingRunInput);
      const runId = String(run.data.run_id ?? "");
      const sessionId = String(run.data.session_id ?? "");
      if (!runId || !sessionId) {
        throw new Error(
          `doAnything.runAndWait: run did not return ids: ${JSON.stringify(run.data)}`,
        );
      }

      const { signal: waitSignal, timedOut } = withTimeout(signal, timeoutMs);
      let sawTerminal = false;
      let terminalPayload: JsonObject = {};
      try {
        for await (const event of namespace.events<JsonObject>({
          token: input.token,
          sessionId,
          runId,
          signal: waitSignal,
          onlyTopLevel: true, // sub-run events don't concern the caller's run
        })) {
          await onEvent?.(event);
          const payload = eventPayload(event);
          if (event.event === EAKEventTypes.RUN_ACTION_STARTED) await onAction?.(payload, event);
          else if (event.event === EAKEventTypes.RUN_SCREENSHOT) await onScreenshot?.(payload, event);
          else if (event.event === EAKEventTypes.RUN_INPUT_REQUEST)
            await onInputRequest?.(payload, event);
          else if (event.event === EAKEventTypes.RUN_COST_UPDATE) await onCostUpdate?.(payload, event);
          else if (event.event === EAKEventTypes.RUN_COMPLETED) {
            sawTerminal = true;
            terminalPayload = payload;
            break;
          }
        }
      } catch (err) {
        if (timedOut() && !signal?.aborted) return { runId, sessionId, status: "timed_out" };
        throw err; // user abort or non-retryable stream error
      }
      // Settle from the run-detail envelope, not the leaner run.completed payload,
      // so the result carries the canonical shape (total_cost_usd, step_count,
      // tokens, …) on `result.raw`. Fall back to the terminal event payload if
      // getRun is unavailable.
      try {
        const detail = await namespace.getRun<JsonObject>({ token: input.token, sessionId, runId });
        return settleRun(runId, sessionId, detail.data);
      } catch (err) {
        if (sawTerminal) return settleRun(runId, sessionId, terminalPayload);
        throw err;
      }
    },

    createSession: <T = unknown>(input: RuntimeTokenInput & JsonObject): Promise<EAKResponse<T>> =>
      transport.webAgentJson("POST", "/do_anything/sessions", input.token, {
        body: omit(input, "token"),
        requiredScopes: ["webagent.do_anything:run"],
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
          requiredScopes: ["webagent.do_anything:run"],
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
          requiredScopes: ["webagent.do_anything:control"],
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
          requiredScopes: ["webagent.do_anything:stop"],
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

  return namespace;
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

// `run` composes createSession + createRun; the backend run envelope already
// carries `session_id`, but guarantee it for any backend that omits it so the
// merged result always has both ids. Inject under the canonical snake_case key
// (NOT camelCase) so callers read one consistent `session_id` field.
// The run/task id on a WebAgent run event envelope (`event.data.task_id`) —
// used to tell a top-level run's events from its internal sub-runs.
function envelopeTaskId(event: EAKEvent): string | undefined {
  const env = event.data as { task_id?: unknown } | null | undefined;
  return env && typeof env === "object" && typeof env.task_id === "string"
    ? env.task_id
    : undefined;
}

// The per-event payload (`event.data.data`) for WebAgent run events.
function eventPayload(event: EAKEvent): JsonObject {
  const envelope = event.data as { data?: unknown } | null | undefined;
  const inner = envelope && typeof envelope === "object" ? envelope.data : undefined;
  return inner && typeof inner === "object" ? (inner as JsonObject) : {};
}

// Map a terminal run payload (a run.completed event's payload, or a getRun
// response) to a settled DoAnythingResult. Completion defaults to "succeeded"
// unless the backend signals failure / cancellation.
function settleRun(runId: string, sessionId: string, p: JsonObject): DoAnythingResult {
  const terminalReason = typeof p.terminal_reason === "string" ? p.terminal_reason : undefined;
  const isTaskSuccessful = typeof p.is_task_successful === "boolean" ? p.is_task_successful : undefined;
  let status: DoAnythingResult["status"];
  if (terminalReason === "canceled") status = "canceled";
  else if (terminalReason === "failed" || terminalReason === "expired" || isTaskSuccessful === false)
    status = "failed";
  else status = "succeeded";
  return { runId, sessionId, status, terminalReason, isTaskSuccessful, output: p.output, raw: p };
}

// Combine an optional user signal with an optional wall-clock timeout into one
// signal (Node 18 has no AbortSignal.any). `timedOut()` reports whether OUR
// timer fired (vs the user aborting), so the caller can distinguish them.
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal?: AbortSignal; timedOut: () => boolean } {
  if (!timeoutMs) return { signal, timedOut: () => false };
  const controller = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    controller.abort();
  }, timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, timedOut: () => fired };
}

function attachSessionId<T>(response: EAKResponse<T>, sessionId: string): EAKResponse<T> {
  if (!isRecord(response.data)) return response;
  if (typeof response.data.sessionId === "string" || typeof response.data.session_id === "string") {
    return response;
  }
  return {
    ...response,
    data: {
      ...response.data,
      session_id: sessionId,
    } as T,
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
