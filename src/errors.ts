import { isJsonObject, type JsonObject } from "./types";

export interface EAKErrorOptions {
  code?: string;
  status?: number;
  requestId?: string;
  traceId?: string;
  auditId?: string;
  retryable?: boolean;
  body?: unknown;
  cause?: unknown;
}

export class EAKError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly auditId?: string;
  readonly retryable: boolean;
  readonly body?: unknown;

  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message);
    this.name = "EAKError";
    this.code = options.code || "eak_error";
    this.status = options.status;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.auditId = options.auditId;
    this.retryable = options.retryable ?? false;
    this.body = options.body;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class EAKAuthError extends EAKError {
  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message, { code: "auth.failed", ...options });
    this.name = "EAKAuthError";
  }
}

export class EAKDelegationRequiredError extends EAKError {
  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message, { code: "delegation.required", ...options });
    this.name = "EAKDelegationRequiredError";
  }
}

export class EAKPermissionDeniedError extends EAKError {
  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message, { code: "permission_denied", ...options });
    this.name = "EAKPermissionDeniedError";
  }
}

export class EAKTokenExpiredError extends EAKError {
  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message, { code: "token.expired", ...options });
    this.name = "EAKTokenExpiredError";
  }
}

export class EAKValidationError extends EAKError {
  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message, { code: "validation.failed", ...options });
    this.name = "EAKValidationError";
  }
}

export class EAKRateLimitError extends EAKError {
  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message, { code: "rate_limit.exceeded", retryable: true, ...options });
    this.name = "EAKRateLimitError";
  }
}

export class EAKUpstreamError extends EAKError {
  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message, { code: "upstream.failed", retryable: true, ...options });
    this.name = "EAKUpstreamError";
  }
}

export class EAKTimeoutError extends EAKError {
  constructor(message: string, options: EAKErrorOptions = {}) {
    super(message, { code: "timeout", retryable: true, ...options });
    this.name = "EAKTimeoutError";
  }
}

export function errorFromPayload(
  status: number,
  payload: unknown,
  fallbackMessage: string,
): EAKError {
  const detail = isJsonObject(payload) ? payload.detail : undefined;
  const detailObject = isJsonObject(detail) ? detail : undefined;
  const source = detailObject || (isJsonObject(payload) ? payload : {});
  const code = stringField(source, "code") || statusCodeToCode(status);
  const message =
    stringField(source, "message") ||
    stringField(source, "detail") ||
    fallbackMessage;
  const options: EAKErrorOptions = {
    code,
    status,
    requestId: stringField(payload, "requestId") || stringField(source, "requestId"),
    traceId: stringField(payload, "traceId") || stringField(source, "traceId"),
    auditId: stringField(payload, "auditId") || stringField(source, "auditId"),
    retryable: status === 429 || status >= 500,
    body: payload,
  };

  if (isTokenExpired(code, message)) return new EAKTokenExpiredError(message, options);
  if (isDelegationRequired(code)) return new EAKDelegationRequiredError(message, options);
  if (status === 401) return new EAKAuthError(message, options);
  if (status === 403 || isPermissionDenied(code)) {
    return new EAKPermissionDeniedError(message, options);
  }
  if (status === 400 || status === 422) return new EAKValidationError(message, options);
  if (status === 429) return new EAKRateLimitError(message, options);
  if (status >= 500) return new EAKUpstreamError(message, options);
  return new EAKError(message, options);
}

export function timeoutError(cause: unknown): EAKTimeoutError {
  return new EAKTimeoutError("EAK request timed out", { cause });
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const field = (value as JsonObject)[key];
  return typeof field === "string" && field ? field : undefined;
}

function statusCodeToCode(status: number): string {
  if (status === 401) return "auth.failed";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation.failed";
  if (status === 429) return "rate_limit.exceeded";
  if (status >= 500) return "upstream.failed";
  return "eak_error";
}

function isPermissionDenied(code: string): boolean {
  return code.includes("permission") || code.includes("insufficient_scope");
}

function isDelegationRequired(code: string): boolean {
  return code.includes("interactive_required") || code.includes("delegation.required");
}

function isTokenExpired(code: string, message: string): boolean {
  return code.includes("expired") || /token expired/i.test(message);
}
