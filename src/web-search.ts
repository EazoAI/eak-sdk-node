import type { EAKEvent, EAKResponse, EAKTransport, JsonObject, RuntimeTokenInput } from "./types";

export function createWebSearchNamespace(transport: EAKTransport) {
  return {
    run: <T = unknown>(input: RuntimeTokenInput & JsonObject): Promise<EAKResponse<T>> =>
      transport.webAgentJson("POST", "/web_search/runs", input.token, {
        body: normalizeWebSearchRunInput(omit(input, "token")),
        requiredScopes: ["webagent.web_search:run"],
      }),

    get: <T = unknown>(input: RuntimeTokenInput & { runId: string }): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/web_search/runs/${encodeURIComponent(input.runId)}`,
        input.token,
        {
          requiredScopes: ["webagent.web_search:read"],
        },
      ),

    events: <T = unknown>(
      input: RuntimeTokenInput & { runId: string; lastEventId?: string; signal?: AbortSignal },
    ): AsyncIterable<EAKEvent<T>> =>
      transport.webAgentSSE(
        `/web_search/runs/${encodeURIComponent(input.runId)}/events`,
        input.token,
        {
          lastEventId: input.lastEventId,
          requiredScopes: ["webagent.web_search:read"],
          signal: input.signal,
        },
      ),

    cancel: <T = unknown>(
      input: RuntimeTokenInput & { runId: string; reason?: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/web_search/runs/${encodeURIComponent(input.runId)}/cancel`,
        input.token,
        {
          body: omit(input, "token", "runId"),
          requiredScopes: ["webagent.web_search:stop"],
        },
      ),
  };
}

function normalizeWebSearchRunInput(input: JsonObject): JsonObject {
  const body = renameKeys(input, {
    maxResultsPerQuery: "max_results_per_query",
    siteWhitelist: "site_whitelist",
    siteBlacklist: "site_blacklist",
  });
  if (typeof body.query === "string" && !Array.isArray(body.queries)) {
    body.queries = [body.query];
  }
  delete body.query;
  return body;
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
