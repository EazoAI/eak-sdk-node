import type { EAKEvent, EAKResponse, EAKTransport, JsonObject, RuntimeTokenInput } from "./types";

export function createTrackNamespace(transport: EAKTransport) {
  return {
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
          requiredScopes: ["webagent.track:run"],
        },
      ),

    events: <T = unknown>(
      input: RuntimeTokenInput & { monitorId: string; lastEventId?: string },
    ): AsyncIterable<EAKEvent<T>> =>
      transport.webAgentSSE(
        `/track/monitors/${encodeURIComponent(input.monitorId)}/events`,
        input.token,
        {
          lastEventId: input.lastEventId,
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
          requiredScopes: ["webagent.track:stop"],
        },
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
