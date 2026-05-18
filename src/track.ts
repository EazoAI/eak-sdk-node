import type { EAKEvent, EAKResponse, EAKTransport, JsonObject, TokenInput } from "./types";

export function createTrackNamespace(transport: EAKTransport) {
  return {
    createMonitor: <T = unknown>(input: TokenInput & JsonObject): Promise<EAKResponse<T>> =>
      transport.webAgentJson("POST", "/track/monitors", input.token, {
        body: omit(input, "token"),
      }),

    getMonitor: <T = unknown>(
      input: TokenInput & { monitorId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/track/monitors/${encodeURIComponent(input.monitorId)}`,
        input.token,
      ),

    runNow: <T = unknown>(
      input: TokenInput & { monitorId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/track/monitors/${encodeURIComponent(input.monitorId)}/run_now`,
        input.token,
        { body: {} },
      ),

    events: <T = unknown>(
      input: TokenInput & { monitorId: string; lastEventId?: string },
    ): AsyncIterable<EAKEvent<T>> =>
      transport.webAgentSSE(
        `/track/monitors/${encodeURIComponent(input.monitorId)}/events`,
        input.token,
        { lastEventId: input.lastEventId },
      ),

    updateMonitor: <T = unknown>(
      input: TokenInput & { monitorId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "PATCH",
        `/track/monitors/${encodeURIComponent(input.monitorId)}`,
        input.token,
        { body: omit(input, "token", "monitorId") },
      ),

    deleteMonitor: <T = unknown>(
      input: TokenInput & { monitorId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "DELETE",
        `/track/monitors/${encodeURIComponent(input.monitorId)}`,
        input.token,
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
