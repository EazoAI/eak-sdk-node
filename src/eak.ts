import type {
  CompleteDelegateAgentInput,
  DelegateAgentInput,
  DelegateAgentResponse,
  DelegateTokenInput,
  EAKResponse,
  EAKTransport,
  JsonObject,
  TokenInput,
} from "./types";

export interface EAKWorkspaceGetInput extends TokenInput {
  eakTenantId: string;
}

export interface EAKWorkspaceCreateInput extends TokenInput {
  name: string;
  displayName?: string;
  metadata?: JsonObject;
}

export interface EAKWorkspaceUpdateInput extends TokenInput {
  eakTenantId: string;
  name?: string;
  displayName?: string;
  metadata?: JsonObject;
}

export interface EAKCredentialListInput extends TokenInput {
  eakTenantId: string;
}

export interface EAKCredentialCreateInput extends EAKCredentialListInput {
  allowedScopes?: readonly string[];
  expiresAt?: string;
  metadata?: JsonObject;
}

export interface EAKCredentialRotateInput extends EAKCredentialListInput {
  accessKeyId: string;
}

export interface EAKCredentialUpdateInput extends EAKCredentialRotateInput {
  enabled?: boolean;
  allowedScopes?: readonly string[];
  expiresAt?: string | null;
  metadata?: JsonObject;
}

type DelegateToken = (
  input: DelegateTokenInput,
) => Promise<EAKResponse<DelegateAgentResponse>>;
type CompleteDelegateAgent = (
  input: CompleteDelegateAgentInput,
) => Promise<EAKResponse<Exclude<DelegateAgentResponse, { authorizationUrl: string }>>>;

export function createEakNamespace(
  transport: EAKTransport,
  delegateToken: DelegateToken,
  completeDelegateAgent: CompleteDelegateAgent,
) {
  return {
    delegateToken,
    /** @deprecated Use delegateToken. */
    delegateAgent: (input: DelegateAgentInput) => delegateToken(input),
    /** @deprecated Interactive grants are not part of the recommended one-step delegateToken flow. */
    completeDelegateAgent,

    workspaces: {
      list: <T = unknown>(input: TokenInput): Promise<EAKResponse<T>> =>
        transport.eakJson("GET", "/api/v3/eak/tenants", input.token),

      get: <T = unknown>(input: EAKWorkspaceGetInput): Promise<EAKResponse<T>> =>
        transport.eakJson(
          "GET",
          `/api/v3/eak/tenants/${encodeURIComponent(input.eakTenantId)}`,
          input.token,
        ),

      create: <T = unknown>(input: EAKWorkspaceCreateInput): Promise<EAKResponse<T>> =>
        transport.eakJson("POST", "/api/v3/eak/tenants", input.token, {
          body: omit(input, "token"),
        }),

      update: <T = unknown>(input: EAKWorkspaceUpdateInput): Promise<EAKResponse<T>> =>
        transport.eakJson(
          "PATCH",
          `/api/v3/eak/tenants/${encodeURIComponent(input.eakTenantId)}`,
          input.token,
          { body: omit(input, "token", "eakTenantId") },
        ),
    },

    credentials: {
      list: <T = unknown>(input: EAKCredentialListInput): Promise<EAKResponse<T>> =>
        transport.eakJson(
          "GET",
          `/api/v3/eak/tenants/${encodeURIComponent(input.eakTenantId)}/credentials`,
          input.token,
        ),

      create: <T = unknown>(input: EAKCredentialCreateInput): Promise<EAKResponse<T>> =>
        transport.eakJson(
          "POST",
          `/api/v3/eak/tenants/${encodeURIComponent(input.eakTenantId)}/credentials`,
          input.token,
          { body: omit(input, "token", "eakTenantId", "allowedAgents") },
        ),

      rotate: <T = unknown>(input: EAKCredentialRotateInput): Promise<EAKResponse<T>> =>
        transport.eakJson(
          "POST",
          `/api/v3/eak/tenants/${encodeURIComponent(
            input.eakTenantId,
          )}/credentials/${encodeURIComponent(input.accessKeyId)}/rotate`,
          input.token,
        ),

      update: <T = unknown>(input: EAKCredentialUpdateInput): Promise<EAKResponse<T>> =>
        transport.eakJson(
          "PATCH",
          `/api/v3/eak/tenants/${encodeURIComponent(
            input.eakTenantId,
          )}/credentials/${encodeURIComponent(input.accessKeyId)}`,
          input.token,
          { body: omit(input, "token", "eakTenantId", "accessKeyId", "allowedAgents") },
        ),
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
