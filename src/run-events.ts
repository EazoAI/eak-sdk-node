import { isJsonObject, type EAKEvent, type JsonObject } from "./types";

/**
 * Semantic run events — the public event surface for doAnything / webSearch /
 * deepResearch run handles and Track monitor handles. Wire envelopes
 * (`{ type, task_id, session_id, occurred_at, data }`, snake_case payloads,
 * data-URI screenshots) are normalized here; the original wire event stays
 * reachable on `event.raw`.
 */
export type RunEventType =
  | "status"
  | "action"
  | "screenshot"
  | "inputRequest"
  | "message"
  | "cost"
  | "progress"
  | "completed"
  | "failed";

/** A decoded screenshot frame. `bytes` are the raw image bytes. */
export interface RunImage {
  bytes: Uint8Array;
  mime: string;
  pageUrl?: string;
  step?: number;
}

interface RunEventBase {
  /** The run this event belongs to. */
  runId: string;
  /** ISO 8601 timestamp of when the event occurred. */
  at: string;
  /** Flat, camelCase payload — narrowed per `type`. */
  data: JsonObject;
  /** The original wire event (escape hatch — shape may evolve with the API). */
  raw: EAKEvent<unknown>;
}

export type RunEvent =
  | (RunEventBase & {
      type: "status" | "action" | "inputRequest" | "message" | "cost" | "progress";
      isTerminal: false;
    })
  | (RunEventBase & { type: "screenshot"; isTerminal: false; image: RunImage })
  | (RunEventBase & { type: "completed" | "failed"; isTerminal: true });

const TERMINAL_FAILURE_REASONS = new Set(["failed", "expired", "canceled"]);

export function isTerminalRunStatus(status: unknown): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

/** Convert a snake_case key to camelCase. Keys without underscores pass through. */
function camelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Recursively camelCase the keys of a wire payload. Values are untouched;
 * arrays are mapped element-wise.
 */
export function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (!isJsonObject(value)) return value;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    out[camelKey(key)] = camelizeKeys(item);
  }
  return out;
}

export function camelizeRecord(value: unknown): JsonObject {
  const out = camelizeKeys(value);
  return isJsonObject(out) ? out : {};
}

/** Decode a `data:` URI into bytes + mime. Returns undefined for non-data URLs. */
export function decodeDataUri(uri: string): { bytes: Uint8Array; mime: string } | undefined {
  const match = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(uri);
  if (!match) return undefined;
  const [, mime, isBase64, body] = match;
  const bytes = isBase64
    ? new Uint8Array(Buffer.from(body, "base64"))
    : new TextEncoder().encode(decodeURIComponent(body));
  return { bytes, mime: mime || "application/octet-stream" };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function decodeScreenshotImage(payload: JsonObject): RunImage | undefined {
  const url = asString(payload.screenshot_url);
  if (!url) return undefined;
  const decoded = decodeDataUri(url);
  if (!decoded) return undefined;
  return {
    ...decoded,
    pageUrl: asString(payload.page_url) ?? asString(payload.url),
    step: asNumber(payload.step) ?? asNumber(payload.step_index),
  };
}

export interface NormalizeRunEventOptions {
  /**
   * The id of the run the stream was opened for. Terminal events of OTHER
   * runs on the same stream (internal sub-runs on a doAnything session) are
   * demoted to `progress` so they never end the caller's iterator. Pass
   * undefined for streams without a single top-level run (Track monitors).
   */
  topRunId?: string;
}

/**
 * Normalize one wire SSE event into a semantic `RunEvent`.
 *
 * Returns null for frames that carry no event envelope at all (heartbeats /
 * comments). Every recognizable envelope is surfaced — unmapped wire types
 * become `progress` rather than being silently dropped.
 */
export function normalizeRunEvent(
  wire: EAKEvent<unknown>,
  options: NormalizeRunEventOptions = {},
): RunEvent | null {
  const envelope = isJsonObject(wire.data) ? wire.data : undefined;
  const wireType = wire.event ?? asString(envelope?.type);
  if (!wireType) return null;

  const payload = isJsonObject(envelope?.data) ? (envelope.data as JsonObject) : {};
  const taskId = asString(envelope?.task_id);
  const runId = taskId ?? options.topRunId ?? "";
  const at =
    asString(envelope?.occurred_at) ??
    asString(payload.occurred_at) ??
    asString(payload.timestamp) ??
    new Date().toISOString();
  const data = camelizeRecord(payload);
  const base = { runId, at, data, raw: wire };
  const isSubRun = Boolean(options.topRunId && taskId && taskId !== options.topRunId);

  switch (wireType) {
    case "run.status_changed":
      return { ...base, type: "status", isTerminal: false };
    case "run.action.started":
    case "run.action.completed":
    case "run.action.failed":
    case "run.action_result":
      return { ...base, type: "action", isTerminal: false };
    case "run.screenshot": {
      const image = decodeScreenshotImage(payload);
      // A screenshot event whose image could not be inlined (storage hiccup
      // server-side) degrades to progress — `screenshot` guarantees `image`.
      if (!image) return { ...base, type: "progress", isTerminal: false };
      return { ...base, type: "screenshot", isTerminal: false, image };
    }
    case "run.input_request":
      return { ...base, type: "inputRequest", isTerminal: false };
    case "run.message":
      return { ...base, type: "message", isTerminal: false };
    case "run.cost_update":
      return { ...base, type: "cost", isTerminal: false };
    case "run.completed": {
      // Sub-run terminals must not end the top-level stream.
      if (isSubRun) return { ...base, type: "progress", isTerminal: false };
      return { ...base, type: terminalEventType(payload), isTerminal: true };
    }
    default:
      // Everything else (plans, subtasks, phases, live-url changes, product
      // specific events) is observable progress; `raw` keeps the wire shape.
      return { ...base, type: "progress", isTerminal: false };
  }
}

function terminalEventType(payload: JsonObject): "completed" | "failed" {
  const reason = asString(payload.terminal_reason);
  if (reason && TERMINAL_FAILURE_REASONS.has(reason)) return "failed";
  if (payload.is_task_successful === false) return "failed";
  if (asString(payload.status) === "failed" || asString(payload.status) === "canceled") {
    return "failed";
  }
  return "completed";
}
