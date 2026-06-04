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
  /** @deprecated Prefer host runtime discovery for normal EAK Console gateway access. */
  eakBaseUrl?: string;
  /** @deprecated Use host for normal EAK Gateway access. */
  genauthBaseUrl?: string;
  /** @deprecated Use host for normal EAK Gateway access. */
  gumemBaseUrl?: string;
  /** @deprecated Use host for normal EAK Gateway access. */
  webAgentBaseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface EAKRuntimeConfig {
  eakBaseUrl?: string;
  genauthBaseUrl?: string;
  gumemBaseUrl?: string;
  webAgentBaseUrl?: string;
  services?: {
    eak?: string | { baseUrl?: string; url?: string; host?: string };
    genauth?: string | { baseUrl?: string; url?: string; host?: string };
    gumem?: string | { baseUrl?: string; url?: string; host?: string };
    webAgent?: string | { baseUrl?: string; url?: string; host?: string };
    webagent?: string | { baseUrl?: string; url?: string; host?: string };
  };
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

export interface UserRef {
  id: string;
  subject?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  [key: string]: unknown;
}

interface DelegateTokenBaseInput {
  agent: string;
  scopes: readonly string[];
  expiresIn?: string | number;
  idempotencyKey?: string;
}

export type DelegateTokenSilentInput = DelegateTokenBaseInput & {
  mode?: "silent";
  redirectUri?: string;
  state?: string;
} & (
  | {
      user: UserRef;
      /** @deprecated Use user. */
      userId?: string;
    }
  | {
      user?: UserRef;
      /** @deprecated Use user. */
      userId: string;
    }
);

export interface DelegateTokenInteractiveInput extends DelegateTokenBaseInput {
  mode: "interactive";
  redirectUri: string;
  state: string;
  user?: UserRef;
  /** @deprecated Use user. */
  userId?: string;
}

export type DelegateTokenInput =
  | DelegateTokenSilentInput
  | DelegateTokenInteractiveInput;

/** @deprecated Use DelegateTokenInput. */
export type DelegateAgentInput = DelegateTokenInput;

export interface CompleteDelegateTokenInput {
  grantId: string;
  code: string;
  state: string;
}

/** @deprecated Use CompleteDelegateTokenInput. */
export type CompleteDelegateAgentInput = CompleteDelegateTokenInput;

export interface DelegateTokenResponse {
  mode: DelegationMode;
  tokenType: "Bearer";
  token: string;
  /** @deprecated Use token. */
  delegateAgentToken: string;
  /** @deprecated Use token. */
  delegationToken?: string;
  expiresIn: number;
  grantId: string;
  auditId: string;
  grantedScopes?: string[];
}

export type DelegateTokenSilentResponse = DelegateTokenResponse & { mode: "silent" };

/** @deprecated Use DelegateTokenResponse. */
export type DelegateAgentTokenResponse = DelegateTokenResponse;

/** @deprecated Use DelegateTokenResponse. */
export type DelegationTokenResponse = DelegateTokenResponse;

export interface InteractiveDelegationResponse {
  mode: "interactive";
  authorizationUrl: string;
  grantId: string;
  grantState: string;
  state: string;
  requestedScopes?: string[];
}

export type DelegateAgentResponse =
  | DelegateTokenResponse
  | InteractiveDelegationResponse;

export type DelegateTokenResult = DelegateAgentResponse;

export interface TokenInput {
  token: string;
}

export type RuntimeTokenInput = TokenInput;

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
  requiredScopes?: readonly string[];
}

export interface EAKEvent<T = unknown> {
  id?: string;
  event?: string;
  data: T;
}

export type EAKSSEEvent<T = unknown> = EAKEvent<T>;

export interface EAKTransport {
  eakJson<T>(
    method: EAKHttpMethod,
    path: string,
    token?: string,
    payload?: RequestPayload,
  ): Promise<EAKResponse<T>>;
  genauthJson<T>(
    method: EAKHttpMethod,
    path: string,
    token?: string,
    payload?: RequestPayload,
  ): Promise<EAKResponse<T>>;
  gumemJson<T>(
    method: EAKHttpMethod,
    path: string,
    token?: string,
    payload?: RequestPayload,
  ): Promise<EAKResponse<T>>;
  gumemSSE<T>(
    path: string,
    token?: string,
    payload?: RequestPayload & { lastEventId?: string; signal?: AbortSignal },
  ): AsyncIterable<EAKEvent<T>>;
  webAgentJson<T>(
    method: EAKHttpMethod,
    path: string,
    token?: string,
    payload?: RequestPayload,
  ): Promise<EAKResponse<T>>;
  webAgentSSE<T>(
    path: string,
    token?: string,
    payload?: RequestPayload & { lastEventId?: string; signal?: AbortSignal },
  ): AsyncIterable<EAKEvent<T>>;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
