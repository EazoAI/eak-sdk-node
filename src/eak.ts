import type {
  CompleteDelegateAgentInput,
  CompleteDelegateTokenInput,
  DelegateAgentInput,
  DelegateAgentResponse,
  DelegateTokenInteractiveInput,
  DelegateTokenInput,
  DelegateTokenResponse,
  DelegateTokenSilentResponse,
  DelegateTokenSilentInput,
  EAKResponse,
  EAKTransport,
  InteractiveDelegationResponse,
} from "./types";

type DelegateToken = {
  (input: DelegateTokenInteractiveInput): Promise<EAKResponse<InteractiveDelegationResponse>>;
  (input: DelegateTokenSilentInput): Promise<EAKResponse<DelegateTokenSilentResponse>>;
  (input: DelegateTokenInput): Promise<EAKResponse<DelegateAgentResponse>>;
};
type CompleteDelegateToken = (
  input: CompleteDelegateTokenInput,
) => Promise<EAKResponse<DelegateTokenResponse>>;

export function createEakNamespace(
  _transport: EAKTransport,
  delegateToken: DelegateToken,
  completeDelegateToken: CompleteDelegateToken,
) {
  return {
    delegateToken,
    /** @deprecated Use delegateToken. */
    delegateAgent: (input: DelegateAgentInput) => delegateToken(input),
    completeDelegateToken,
    /** @deprecated Use completeDelegateToken. */
    completeDelegateAgent: (input: CompleteDelegateAgentInput) =>
      completeDelegateToken(input),
  };
}
