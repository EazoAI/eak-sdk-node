import type {
  EAKEvent,
  EAKResponse,
  EAKTransport,
  JsonObject,
  RuntimeTokenInput,
} from "./types";

export interface DoAnythingRunInput extends RuntimeTokenInput {
  instruction?: string;
  /** @deprecated Use instruction. */
  instructions?: string;
  session?: JsonObject;
  stream?: { events?: string[]; includeFrames?: boolean };
  tools?: JsonObject;
  [key: string]: unknown;
}

export function createDoAnythingNamespace(transport: EAKTransport) {
  const namespace = {
    run: async <T = unknown>(input: DoAnythingRunInput): Promise<EAKResponse<T>> => {
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
        requiredScopes: ["webagent.task:run"],
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
          requiredScopes: ["webagent.task:run"],
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
          requiredScopes: ["webagent.task:read"],
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
        requiredScopes: ["webagent.task:read"],
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
          requiredScopes: ["webagent.task:run"],
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
          requiredScopes: ["webagent.task:run"],
        },
      ),

    readArtifacts: <T = unknown>(
      input: RuntimeTokenInput & { sessionId: string; artifactId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/artifacts/${encodeURIComponent(input.artifactId)}`,
        input.token,
        {
          requiredScopes: ["webagent.task:read"],
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
          requiredScopes: ["webagent.task:read"],
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

function attachSessionId<T>(response: EAKResponse<T>, sessionId: string): EAKResponse<T> {
  if (!isRecord(response.data)) return response;
  if (typeof response.data.sessionId === "string" || typeof response.data.session_id === "string") {
    return response;
  }
  return {
    ...response,
    data: {
      ...response.data,
      sessionId,
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
