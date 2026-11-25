import type { ContractRouterClient } from "@orpc/contract"
import type { contract } from "@read-frog/api-contract"
import type { ClientContextHeaderInput } from "@read-frog/definitions"

export interface ExtensionORPCClientContext {
  /** Legacy call context used by shared Notebase callers. It stays inside the extension. */
  analytics?: ClientContextHeaderInput
}

export type ExtensionORPCClient = ContractRouterClient<typeof contract, ExtensionORPCClientContext>

export function buildExtensionORPCHeaders(): Record<string, string> {
  return { "x-orpc-source": "extension" }
}
