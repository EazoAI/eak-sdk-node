import type { EAKResponse, EAKTransport } from "./types";

export interface GenAuthAccessTokenInput {
  accessToken: string;
}

export interface GenAuthDelegationIntrospectionInput {
  token?: string;
  /** @deprecated Use token. */
  delegateAgentToken?: string;
}

export function createGenAuthNamespace(transport: EAKTransport) {
  return {
    userInfo: <T = unknown>(input: GenAuthAccessTokenInput): Promise<EAKResponse<T>> =>
      transport.genauthJson("GET", "/oidc/me", input.accessToken),

    jwks: <T = unknown>(): Promise<EAKResponse<T>> =>
      transport.genauthJson("GET", "/oidc/.well-known/jwks.json"),

    discovery: <T = unknown>(): Promise<EAKResponse<T>> =>
      transport.genauthJson("GET", "/oidc/.well-known/openid-configuration"),

    introspectDelegationToken: <T = unknown>(
      input: GenAuthDelegationIntrospectionInput,
    ): Promise<EAKResponse<T>> =>
      transport.genauthJson("POST", "/api/v3/eak/delegations/introspect", undefined, {
        body: { token: requiredDelegationToken(input) },
      }),
  };
}

function requiredDelegationToken(input: GenAuthDelegationIntrospectionInput): string {
  const token = input.token ?? input.delegateAgentToken;
  if (token?.trim()) return token;
  throw new Error("GenAuth delegation introspection requires token");
}
