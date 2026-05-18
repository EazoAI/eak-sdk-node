export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = Record<string, unknown>;

export type DelegationMode = "silent" | "interactive";
export type EAKService = "eak" | "genauth" | "gumem" | "webagent";
export type EAKHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface EAKOptions {
  accessKey?: string;
  secretKey?: string;
  host?: string;
  /** @deprecated Use accessKey. */
  accessKeyId?: string;
  /** @deprecated Use secretKey. */
  accessKeySecret?: string;
  /** @deprecated Use host for normal EAK Gateway access. */
  genauthBaseUrl?: string;
  /** @deprecated Use host for normal EAK Gateway access. */
  gumemBaseUrl?: string;
  /** @deprecated Use host for normal EAK Gateway access. */
  webAgentBaseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface EAKMeta {
  requestId?: string;
  traceId?: string;
  auditId?: string;
  service?: EAKService;
  [key: string]: unknown;
}

export interface EAKResponse<T = unknown> {
  data: T;
  meta: EAKMeta;
}

export interface DelegateAgentInput {
  userId: string;
  agent: string | { id: string; name?: string; description?: string };
  scopes: readonly string[];
  mode?: DelegationMode;
  redirectUri?: string;
  expiresIn?: number;
}

export interface CompleteDelegateAgentInput {
  grantId: string;
  code: string;
  state: string;
}

export interface DelegateAgentTokenResponse {
  mode: DelegationMode;
  tokenType: "Bearer";
  delegateAgentToken: string;
  /** @deprecated Use delegateAgentToken. */
  delegationToken?: string;
  expiresIn: number;
  grantId: string;
  auditId: string;
  grantedScopes?: string[];
}

/** @deprecated Use DelegateAgentTokenResponse. */
export type DelegationTokenResponse = DelegateAgentTokenResponse;

export interface InteractiveDelegationResponse {
  mode: "interactive";
  authorizationUrl: string;
  grantId: string;
  state: string;
  requestedScopes?: string[];
}

export type DelegateAgentResponse =
  | DelegateAgentTokenResponse
  | InteractiveDelegationResponse;

export interface TokenInput {
  token: string;
}

export interface RawRequestInput extends TokenInput {
  method: EAKHttpMethod;
  path: string;
  query?: JsonObject;
  body?: JsonObject;
  headers?: Record<string, string>;
}

export interface RequestPayload {
  query?: JsonObject;
  body?: JsonObject | BodyInit;
  headers?: Record<string, string>;
}

export interface EAKEvent<T = unknown> {
  id?: string;
  event?: string;
  data: T;
}

export type EAKSSEEvent<T = unknown> = EAKEvent<T>;

export interface EAKTransport {
  gumemJson<T>(
    method: EAKHttpMethod,
    path: string,
    token: string,
    payload?: RequestPayload,
  ): Promise<EAKResponse<T>>;
  gumemSSE<T>(
    path: string,
    token: string,
    payload?: RequestPayload & { lastEventId?: string },
  ): AsyncIterable<EAKEvent<T>>;
  webAgentJson<T>(
    method: EAKHttpMethod,
    path: string,
    token: string,
    payload?: RequestPayload,
  ): Promise<EAKResponse<T>>;
  webAgentSSE<T>(
    path: string,
    token: string,
    payload?: RequestPayload & { lastEventId?: string },
  ): AsyncIterable<EAKEvent<T>>;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
