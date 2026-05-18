import type { EAKEvent, EAKResponse, EAKTransport, JsonObject, TokenInput } from "./types";

export function createWebSearchNamespace(transport: EAKTransport) {
  return {
    run: <T = unknown>(input: TokenInput & JsonObject): Promise<EAKResponse<T>> =>
      transport.webAgentJson("POST", "/web_search/runs", input.token, {
        body: omit(input, "token"),
      }),

    get: <T = unknown>(input: TokenInput & { runId: string }): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/web_search/runs/${encodeURIComponent(input.runId)}`,
        input.token,
      ),

    refine: <T = unknown>(
      input: TokenInput & { runId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/web_search/runs/${encodeURIComponent(input.runId)}/messages`,
        input.token,
        { body: omit(input, "token", "runId") },
      ),

    events: <T = unknown>(
      input: TokenInput & { runId: string; lastEventId?: string },
    ): AsyncIterable<EAKEvent<T>> =>
      transport.webAgentSSE(
        `/web_search/runs/${encodeURIComponent(input.runId)}/events`,
        input.token,
        { lastEventId: input.lastEventId },
      ),

    cancel: <T = unknown>(
      input: TokenInput & { runId: string; reason?: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/web_search/runs/${encodeURIComponent(input.runId)}/cancel`,
        input.token,
        { body: omit(input, "token", "runId") },
      ),
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
