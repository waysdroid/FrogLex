import type { ProviderCapability } from "./provider-registry"
import type { ProvidersConfig } from "@/types/config/provider"
import type { HostedAiFeature, HostedAiStatus, HostedAiTierStatus } from "@/utils/hosted-ai/types"
import { findHostedAiModel, getHostedAiModelsFromStatus } from "@/utils/hosted-ai/models"
import { getHostedAiTierStatus } from "@/utils/hosted-ai/status"
import { getBuiltInAiModelId, getProviderIdsForCapability } from "./provider-registry"

/**
 * Capability -> hosted feature. They share names today, but a capability is a
 * client-side provider-picker concept and a feature is the server's billing
 * subject; keeping the mapping explicit is what lets one diverge from the
 * other. `null` means the capability has no hosted route, so no status gate.
 */
const CAPABILITY_HOSTED_FEATURES = {
  pageTranslation: "pageTranslation",
  selectionTranslation: "selectionTranslation",
  videoSubtitles: "videoSubtitles",
  inputTranslation: "inputTranslation",
  customAction: "customAction",
  languageDetection: "languageDetection",
} as const satisfies Record<ProviderCapability, HostedAiFeature>

export function getHostedFeatureForCapability(
  capability: ProviderCapability,
): HostedAiFeature | null {
  return CAPABILITY_HOSTED_FEATURES[capability] ?? null
}

/**
 * Whether a tier is behind a plan this account lacks: running it takes buying
 * Pro or Ultra. Only this locks a Built-in AI option. Everything else is left
 * selectable and surfaces when the feature runs.
 *
 * Signing in is not a wall. A guest may pick any model a free account could
 * run, and the run asks it to log in (`authentication_required` there). That
 * is why a plan wall is read off two fields: a signed-in account gets
 * `pro_required` / `ultra_required`, but a guest gets `authentication_required`
 * on every tier, plan-gated or not, and only `upgradeTo` (the plan it would
 * need after signing in) tells the two apart.
 *
 * Read off the tier status rather than recomputed from `accessAllowed` and the
 * `pools` array. The server already separates the two: it reports an unfunded
 * plan-gated tier as `pro_required` or `ultra_required` ("an upgrade wall, not
 * an outage") and routes every transient condition to `service_unavailable`,
 * including a billing lookup that threw. Deriving the wall from the pools
 * instead conflates them in both directions: a momentary billing failure drops
 * the plan's pools for an account that is perfectly entitled.
 *
 * Everything else the server can report, `quota_exhausted` and
 * `service_unavailable` (open circuit, unconfigured model, unreadable quota
 * pool), is transient and must not make a provider look permanently broken.
 *
 * Unknown status (still loading, or the status fetch failed) reads as open.
 * Not knowing is not the same as knowing it is walled off, and failing closed
 * here would block destructive actions whenever the network hiccups.
 */
export function isPlanWalledTier(tier: HostedAiTierStatus | undefined): boolean {
  return (
    tier?.unavailableReason === "pro_required" ||
    tier?.unavailableReason === "ultra_required" ||
    Boolean(tier?.upgradeTo)
  )
}

/**
 * Only built-in providers can be plan-walled: a local provider carries its own
 * credentials, so its usability is a config question this module does not
 * answer (see the API-key warning on the provider form).
 *
 * A model goes by its tier's status. A model the list does not name has no
 * tier to read and is left open here: whether it can run is the server's
 * call, and the menus mark it unavailable.
 */
export function isProviderIdPlanWalled(
  providerId: string,
  capability: ProviderCapability,
  status: HostedAiStatus | undefined,
): boolean {
  const modelId = getBuiltInAiModelId(providerId)
  if (modelId === null) {
    return false
  }
  const feature = getHostedFeatureForCapability(capability)
  if (!feature) {
    return false
  }
  const model = findHostedAiModel(getHostedAiModelsFromStatus(status), modelId)
  return model !== undefined && isPlanWalledTier(getHostedAiTierStatus(status, feature, model.tier))
}

export function getUsableProviderIdsForCapability(
  capability: ProviderCapability,
  providersConfig: ProvidersConfig,
  _status?: HostedAiStatus,
): string[] {
  return getProviderIdsForCapability(capability, providersConfig, { requireEnable: true })
}
