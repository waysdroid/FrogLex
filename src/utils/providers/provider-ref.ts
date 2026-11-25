import type { ResolvedProviderRef, SystemProviderRef } from "./provider-registry"
import type { HostedAiTextStreamRoute } from "@/types/background-stream"
import type { Config } from "@/types/config/config"
import type { LLMProviderConfig, TranslateProviderConfig } from "@/types/config/provider"
import type { ErrorAction } from "@/utils/error-action"
import type {
  HostedAiFeature,
  HostedAiModelTier,
  HostedAiReasoning,
  HostedAiUnavailableReason,
} from "@/utils/hosted-ai/types"
import { isLLMProviderConfig } from "@/types/config/provider"
import { resolveProviderRefForCapability } from "./provider-registry"

/**
 * A provider flattened for structured-clone transport to the background. Local
 * providers carry their whole config; Built-in AI models carry what the hosted
 * call and the cache key need, resolved together so a cache entry is filed
 * under exactly what produced it.
 */
export type SerializableProviderRef =
  | { kind: "local"; config: TranslateProviderConfig }
  | SystemSerializableProviderRef

export interface SystemSerializableProviderRef {
  kind: "system"
  providerId: SystemProviderRef["id"]
  /** The model's id in the server's catalog. */
  model: string
  /** The model's tier, for older servers; one that knows models goes by `model`. */
  modelTier: HostedAiModelTier
  /** Changes when the model's output would. */
  modelRevision: string
  /**
   * The reasoning level the request asks for (see
   * `getRequestedHostedAiReasoning`). Null asks for none: language detection,
   * or a model this client knows nothing about with no level picked.
   */
  reasoning: HostedAiReasoning | null
}

/**
 * A ref that can be prompted for free-form text. Structural, not branded:
 * `LLMProviderConfig` is a real subtype of `TranslateProviderConfig`, so this
 * stays assignable to `SerializableProviderRef` — caches, transport and
 * `getProviderCacheIdentity` see no difference.
 *
 * Message payloads that prompt a model require this type, which turns
 * "forgot the promptability check" from a silent per-request failure into a
 * compile error at the sender: the only way to produce one is
 * `canProviderRefGenerateText` or a resolution that applied it.
 */
export type PromptableProviderRef =
  | { kind: "local"; config: LLMProviderConfig }
  | SystemSerializableProviderRef

export class HostedAiProviderUnavailableError extends Error {
  constructor(
    readonly provider: SystemProviderRef,
    message: string,
    /** What the user can do about it, such as choosing another model. */
    readonly action?: ErrorAction,
    /** Why the server refused, when its status said so. */
    readonly reason?: HostedAiUnavailableReason,
  ) {
    super(message)
    this.name = "HostedAiProviderUnavailableError"
  }
}

/**
 * The provider page translation runs on in this document instead of the configured one, or
 * null to follow the config. Set for each page-translation run; see `PageTranslationManager`.
 */
let pageTranslationProviderIdOverride: string | null = null

export function setPageTranslationProviderIdOverride(providerId: string | null): void {
  pageTranslationProviderIdOverride = providerId
}

/** The provider page translation runs on: the override, or the configured one. */
export function getPageTranslationProviderId(config: Config): string {
  return pageTranslationProviderIdOverride ?? config.pageTranslation.providerId
}

export function resolvePageTranslationProvider(
  config: Config,
): ResolvedProviderRef<TranslateProviderConfig> {
  const providerId = getPageTranslationProviderId(config)
  const resolved = resolveProviderRefForCapability(
    "pageTranslation",
    config.providersConfig,
    providerId,
  )
  if (!resolved) {
    throw new Error(`No page translation provider for id "${providerId}"`)
  }
  return resolved
}

export function resolvePageTranslationProviderOrNull(
  config: Config,
): ResolvedProviderRef<TranslateProviderConfig> | null {
  try {
    return resolvePageTranslationProvider(config)
  } catch {
    return null
  }
}

/**
 * Cache identity for a provider. Local providers hash their whole config, so a
 * changed key or temperature invalidates; a Built-in AI model hashes its id
 * (inside the provider id), its revision, which the server bumps when its
 * output changes, and the reasoning level the request runs at. One helper so
 * every cache (page, subtitles, summaries, segmentation) keys the same way — a
 * local ref still stringifies byte-identically to what those caches used
 * before, so existing BYOK entries survive.
 */
export function getProviderCacheIdentity(ref: SerializableProviderRef): string {
  return ref.kind === "local"
    ? JSON.stringify(ref.config)
    : JSON.stringify({
        providerId: ref.providerId,
        modelRevision: ref.modelRevision,
        reasoning: ref.reasoning,
      })
}

/**
 * Whether this ref can be prompted for free-form text.
 *
 * Capability and promptability are not the same question. A feature's provider
 * list is capability-gated — `videoSubtitles` admits any translate provider —
 * but a summary is a generation, and Google, Microsoft and DeepLX have no model
 * to prompt. Without this, enqueueing a summary for a translate-only subtitles
 * provider is admitted to the queue and can only ever throw, after burning its
 * retries.
 */
export function canProviderRefGenerateText(
  ref: SerializableProviderRef,
): ref is PromptableProviderRef {
  return ref.kind === "local" && isLLMProviderConfig(ref.config)
}

/**
 * Pre-serialization twin of `canProviderRefGenerateText`: the same
 * promptability question, asked of the registry's resolved ref before a
 * hostedAi.status fetch is spent on it. Keep the pair in sync.
 */
export function canResolvedProviderRefGenerateText(
  ref: ResolvedProviderRef,
): ref is ResolvedProviderRef<LLMProviderConfig> {
  return ref.kind === "local" && isLLMProviderConfig(ref.config)
}

/**
 * Routes map many-to-one onto features: both subtitle routes bill against
 * `videoSubtitles`. The status gate is per feature, so collapse first.
 */
export function getHostedFeatureForRoute(route: HostedAiTextStreamRoute): HostedAiFeature {
  return route === "videoSubtitlesSegmentation" ? "videoSubtitles" : route
}

export async function serializeProviderRef(
  provider: ResolvedProviderRef<LLMProviderConfig>,
  route: HostedAiTextStreamRoute,
): Promise<PromptableProviderRef>
export async function serializeProviderRef(
  provider: ResolvedProviderRef<TranslateProviderConfig>,
  route: HostedAiTextStreamRoute,
): Promise<SerializableProviderRef>
export async function serializeProviderRef(
  provider: ResolvedProviderRef<TranslateProviderConfig>,
  _route: HostedAiTextStreamRoute,
): Promise<SerializableProviderRef> {
  if (provider.kind === "system") {
    throw new HostedAiProviderUnavailableError(provider, "Configure a personal AI provider")
  }
  return { kind: "local", config: provider.config }
}

export type ProviderAvailability<Ref extends SerializableProviderRef = SerializableProviderRef> =
  | { available: true; providerRef: Ref }
  | {
      available: false
      message: string
      action?: ErrorAction
      reason?: HostedAiUnavailableReason
      /** The refusal itself, for a caller that hands it on, as to the Built-in AI prompt. */
      error: HostedAiProviderUnavailableError
    }

export async function checkProviderAvailability(
  provider: ResolvedProviderRef<LLMProviderConfig>,
  route: HostedAiTextStreamRoute,
): Promise<ProviderAvailability<PromptableProviderRef>>
export async function checkProviderAvailability(
  provider: ResolvedProviderRef<TranslateProviderConfig>,
  route: HostedAiTextStreamRoute,
): Promise<ProviderAvailability>
export async function checkProviderAvailability(
  provider: ResolvedProviderRef<TranslateProviderConfig>,
  route: HostedAiTextStreamRoute,
): Promise<ProviderAvailability> {
  try {
    return { available: true, providerRef: await serializeProviderRef(provider, route) }
  } catch (error) {
    if (error instanceof HostedAiProviderUnavailableError) {
      return {
        available: false,
        message: error.message,
        action: error.action,
        reason: error.reason,
        error,
      }
    }
    throw error
  }
}
