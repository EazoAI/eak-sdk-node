import type { EAKEvent, EAKResponse, EAKTransport, JsonObject, RuntimeTokenInput } from "./types";

/**
 * DeepResearch capability namespace — runs are created with a research
 * `topic`, gated by an optional HITL outline approval, then stream events
 * until a cited report is produced. Mirrors the backend contract at
 * `/api/v1/projects/{tenant}/deep_research/...`.
 */
export function createDeepResearchNamespace(transport: EAKTransport) {
  return {
    run: <T = unknown>(input: RuntimeTokenInput & JsonObject): Promise<EAKResponse<T>> =>
      transport.webAgentJson("POST", "/deep_research/runs", input.token, {
        body: normalizeDeepResearchRunInput(omit(input, "token")),
        requiredScopes: ["webagent.deep_research:run"],
      }),

    get: <T = unknown>(input: RuntimeTokenInput & { runId: string }): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/deep_research/runs/${encodeURIComponent(input.runId)}`,
        input.token,
        {
          requiredScopes: ["webagent.deep_research:read"],
        },
      ),

    events: <T = unknown>(
      input: RuntimeTokenInput & { runId: string; lastEventId?: string; signal?: AbortSignal },
    ): AsyncIterable<EAKEvent<T>> =>
      transport.webAgentSSE(
        `/deep_research/runs/${encodeURIComponent(input.runId)}/events`,
        input.token,
        {
          lastEventId: input.lastEventId,
          requiredScopes: ["webagent.deep_research:read"],
          signal: input.signal,
        },
      ),

    intervene: <T = unknown>(
      input: RuntimeTokenInput & { runId: string; requestId: string; response: unknown },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/deep_research/runs/${encodeURIComponent(input.runId)}/intervene`,
        input.token,
        {
          body: renameKeys(omit(input, "token", "runId"), { requestId: "request_id" }),
          requiredScopes: ["webagent.deep_research:control"],
        },
      ),

    followUp: <T = unknown>(
      input: RuntimeTokenInput & { runId: string; text: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/deep_research/runs/${encodeURIComponent(input.runId)}/messages`,
        input.token,
        {
          body: omit(input, "token", "runId"),
          requiredScopes: ["webagent.deep_research:control"],
        },
      ),

    cancel: <T = unknown>(
      input: RuntimeTokenInput & { runId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/deep_research/runs/${encodeURIComponent(input.runId)}/cancel`,
        input.token,
        {
          body: {},
          requiredScopes: ["webagent.deep_research:stop"],
        },
      ),

    feedback: <T = unknown>(
      input: RuntimeTokenInput & { runId: string } & JsonObject,
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "POST",
        `/deep_research/runs/${encodeURIComponent(input.runId)}/feedback`,
        input.token,
        {
          body: renameKeys(omit(input, "token", "runId"), { feedbackText: "feedback_text" }),
          requiredScopes: ["webagent.deep_research:control"],
        },
      ),

    listArtifacts: <T = unknown>(
      input: RuntimeTokenInput & { runId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/deep_research/runs/${encodeURIComponent(input.runId)}/artifacts`,
        input.token,
        {
          requiredScopes: ["webagent.deep_research:read"],
        },
      ),

    getArtifact: <T = unknown>(
      input: RuntimeTokenInput & { runId: string; artifactId: string },
    ): Promise<EAKResponse<T>> =>
      transport.webAgentJson(
        "GET",
        `/deep_research/runs/${encodeURIComponent(input.runId)}/artifacts/${encodeURIComponent(input.artifactId)}`,
        input.token,
        {
          requiredScopes: ["webagent.deep_research:read"],
        },
      ),
  };
}

function normalizeDeepResearchRunInput(input: JsonObject): JsonObject {
  return renameKeys(input, {
    outputFormat: "output_format",
    targetAudience: "target_audience",
    requireOutlineApproval: "require_outline_approval",
    maxCostUsd: "max_cost_usd",
    maxDurationMinutes: "max_duration_minutes",
    callbackUrl: "callback_url",
    domainWhitelist: "domain_whitelist",
    domainBlacklist: "domain_blacklist",
  });
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
