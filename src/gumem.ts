import type { EAKResponse, EAKTransport, JsonObject, TokenInput } from "./types";

export interface GumemCreateSessionInput extends TokenInput {
  userId?: string;
  sessionId?: string;
  /** @deprecated Use userId. */
  user_id?: string;
  /** @deprecated Use sessionId. */
  session_id?: string;
  title?: string;
  metadata?: JsonObject;
}

export interface GumemAddMessagesInput extends TokenInput {
  sessionId: string;
  messages: JsonObject[];
  sync?: boolean;
  userId?: string;
  /** @deprecated Use userId. */
  user_id?: string;
}

export interface GumemRecallInput extends TokenInput {
  sessionId?: string;
  query?: string;
  details?: boolean;
  recallConfig?: JsonObject;
  metadataFilters?: JsonObject;
  /** @deprecated Use recallConfig. */
  recall_config?: JsonObject;
  /** @deprecated Use metadataFilters. */
  metadata_filters?: JsonObject;
}

export interface GumemUploadResourceInput extends TokenInput {
  userId?: string;
  sessionId?: string;
  /** @deprecated Use userId. */
  user_id?: string;
  /** @deprecated Use sessionId. */
  session_id?: string;
  file: Blob | File;
  filename?: string;
  contentType?: string;
}

export function createGumemNamespace(transport: EAKTransport) {
  return {
    createSession: <T = unknown>(input: GumemCreateSessionInput): Promise<EAKResponse<T>> =>
      transport.gumemJson("POST", "/api/sessions", input.token, {
        body: gumemBody(omit(input, "token")),
      }),

    addMessages: <T = unknown>(input: GumemAddMessagesInput): Promise<EAKResponse<T>> =>
      transport.gumemJson(
        "POST",
        `/api/sessions/${encodeURIComponent(input.sessionId)}/messages`,
        input.token,
        { body: gumemBody(omit(input, "token", "sessionId")) },
      ),

    recall: <T = unknown>(input: GumemRecallInput): Promise<EAKResponse<T>> =>
      transport.gumemJson(
        "POST",
        `/api/sessions/${encodeURIComponent(input.sessionId || "default")}/context`,
        input.token,
        {
          query: { query: input.query || "", details: input.details ?? false },
          body: gumemBody(omit(input, "token", "sessionId", "query", "details")),
        },
      ),

    uploadResource: <T = unknown>(input: GumemUploadResourceInput): Promise<EAKResponse<T>> => {
      const form = new FormData();
      form.set("file", input.file, input.filename);
      const userId = input.userId ?? input.user_id;
      const sessionId = input.sessionId ?? input.session_id;
      if (userId) form.set("user_id", userId);
      if (sessionId) form.set("session_id", sessionId);
      if (input.contentType) form.set("content_type", input.contentType);
      return transport.gumemJson("POST", "/api/resources", input.token, { body: form });
    },

    actions: {
      record: <T = unknown>(input: TokenInput & JsonObject): Promise<EAKResponse<T>> =>
        transport.gumemJson("POST", "/api/user/actions", input.token, {
          body: omit(input, "token"),
        }),

      recall: <T = unknown>(input: TokenInput & JsonObject): Promise<EAKResponse<T>> =>
        transport.gumemJson("GET", "/api/user/actions/query", input.token, {
          query: omit(input, "token"),
        }),

      stream: <T = unknown>(input: TokenInput & JsonObject): Promise<EAKResponse<T>> =>
        transport.gumemJson("GET", "/api/user/actions/stream", input.token, {
          query: omit(input, "token"),
        }),
    },
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

function gumemBody(value: JsonObject): JsonObject {
  return renameKeys(value, {
    userId: "user_id",
    sessionId: "session_id",
    recallConfig: "recall_config",
    metadataFilters: "metadata_filters",
  });
}

function renameKeys(value: JsonObject, mapping: Record<string, string>): JsonObject {
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const target = mapping[key] || key;
    if (out[target] === undefined) out[target] = item;
  }
  return out;
}
