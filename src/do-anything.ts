import type {
  EAKEvent,
  EAKResponse,
  EAKTransport,
  JsonObject,
  TokenInput,
} from "./types";

export interface DoAnythingRunInput extends TokenInput {
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

    createSession: <T = unknown>(input: TokenInput & JsonObject): Promise<EAKResponse<T>> =>
      transport.webAgentJson("POST", "/do_anything/sessions", input.token, {
        body: omit(input, "token"),
      }),

    createRun: <T = unknown>(
      input: TokenInput & { sessionId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs`,
        input.token,
        { body: omit(input, "token", "sessionId") },
      ),

    getRun: <T = unknown>(
      input: TokenInput & { sessionId: string; runId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}`,
        input.token,
      ),

    events: <T = unknown>(
      input: TokenInput & { sessionId: string; runId?: string; lastEventId?: string },
    ): AsyncIterable<EAKEvent<T>> => {
      const path = input.runId
        ? `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/events`
        : `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/events`;
      return transport.webAgentSSE(path, input.token, {
        lastEventId: input.lastEventId,
      });
    },

    intervene: <T = unknown>(
      input: TokenInput & { sessionId: string; runId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/interventions`,
        input.token,
        { body: omit(input, "token", "sessionId", "runId") },
      ),

    cancel: <T = unknown>(
      input: TokenInput & { sessionId: string; runId: string; reason?: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/cancel`,
        input.token,
        { body: omit(input, "token", "sessionId", "runId") },
      ),

    readArtifacts: <T = unknown>(
      input: TokenInput & { sessionId: string; artifactId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/artifacts/${encodeURIComponent(input.artifactId)}`,
        input.token,
      ),

    readRecording: <T = unknown>(
      input: TokenInput & { sessionId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/do_anything/sessions/${encodeURIComponent(input.sessionId)}/recording`,
        input.token,
      ),
  };

  return namespace;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
