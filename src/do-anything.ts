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

    events: <T = unknown>(
      input: RuntimeTokenInput & {
        sessionId: string;
        runId?: string;
        lastEventId?: string;
        signal?: AbortSignal;
      },
    ): AsyncIterable<EAKEvent<T>> => {
      const path = input.runId
        ? `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/events`
        : `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/events`;
      return transport.webAgentSSE(path, input.token, {
        lastEventId: input.lastEventId,
        requiredScopes: ["webagent.do_anything:read"],
        signal: input.signal,
      });
    },

    intervene: <T = unknown>(
      input: RuntimeTokenInput & { sessionId: string; runId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/interventions`,
        input.token,
        {
          body: omit(input, "token", "sessionId", "runId"),
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

// `run` composes createSession + createRun; the backend run envelope already
// carries `session_id`, but guarantee it for any backend that omits it so the
// merged result always has both ids. Inject under the canonical snake_case key
// (NOT camelCase) so callers read one consistent `session_id` field.
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
