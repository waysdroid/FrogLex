import type { ProviderConfig, ProvidersConfig } from "@/types/config/provider"
import type { FeatureKey } from "@/utils/constants/feature-providers"
import type { HostedAiModel } from "@/utils/hosted-ai/models"
import type {
  ProviderSelectorOption,
  SystemProviderSelectorItem,
} from "@/utils/providers/provider-display"
import readFrogLogo from "@/assets/providers/read-frog-provider.png?url&no-inline"
import { isLLMProviderConfig, isTranslateProviderConfig } from "@/types/config/provider"
import { UNCONFIGURED_AI_PROVIDER_ID } from "@/utils/constants/provider-ids"
import {
  type BuiltInAiProviderId,
  DEFAULT_BUILT_IN_AI_MODEL_ID,
  getBuiltInAiModelId,
  getBuiltInAiProviderId,
} from "@/utils/constants/provider-ids"

export {
  DEFAULT_BUILT_IN_AI_PROVIDER_ID,
  getBuiltInAiModelId,
  getBuiltInAiProviderId,
  isBuiltInAiProviderId,
} from "@/utils/constants/provider-ids"
export const BUILT_IN_AI_PROVIDER_LOGO = readFrogLogo

export type ProviderCapability = FeatureKey | "customAction" | "languageDetection"
type ProviderConfigPredicate<T extends ProviderConfig = ProviderConfig> = (
  provider: ProviderConfig,
) => provider is T

/**
 * Every Built-in AI model can be picked for every one of these. Which ones an
 * account may run is the server's call, read from `hostedAi.status` (see
 * provider-availability.ts), not something a model declares here.
 */
const BUILT_IN_AI_CAPABILITIES: readonly ProviderCapability[] = [
  "pageTranslation",
  "selectionTranslation",
  "videoSubtitles",
  "inputTranslation",
  "customAction",
  "languageDetection",
]

export interface LocalProviderRef<T extends ProviderConfig = ProviderConfig> {
  kind: "local"
  config: T
  id: string
  name: string
}

/** A Built-in AI model, which is a provider of its own. */
export interface SystemProviderRef {
  kind: "system"
  id: BuiltInAiProviderId
  /** The model's display name, or its id when no model list was at hand to name it. */
  name: string
  /** The model's id in the server's catalog. */
  model: string
}

export type ResolvedProviderRef<T extends ProviderConfig = ProviderConfig> =
  | LocalProviderRef<T>
  | SystemProviderRef

const LOCAL_PROVIDER_CAPABILITY_PREDICATES = {
  pageTranslation: isTranslateProviderConfig,
  videoSubtitles: isTranslateProviderConfig,
  selectionTranslation: isTranslateProviderConfig,
  inputTranslation: isTranslateProviderConfig,
  customAction: isLLMProviderConfig,
  languageDetection: isLLMProviderConfig,
} as const satisfies Record<ProviderCapability, ProviderConfigPredicate>

export type ProviderConfigForCapability<C extends ProviderCapability> =
  (typeof LOCAL_PROVIDER_CAPABILITY_PREDICATES)[C] extends ProviderConfigPredicate<infer T>
    ? T
    : never

export type ProviderRefForCapability<C extends ProviderCapability> = ResolvedProviderRef<
  ProviderConfigForCapability<C>
>

export type CustomActionProviderRef = ProviderRefForCapability<"customAction">
export type SelectionTranslationProviderRef = ProviderRefForCapability<"selectionTranslation">

/** The list the extension knows of, when one is at hand: live from status, or the last one stored. */
export type BuiltInAiModelList = readonly HostedAiModel[] | null | undefined

export function isBuiltInAiCapability(capability: ProviderCapability): boolean {
  return BUILT_IN_AI_CAPABILITIES.includes(capability)
}

/** A model's display name, or its id when the list does not name it. */
export function getBuiltInAiModelName(models: BuiltInAiModelList, modelId: string): string {
  return models?.find((model) => model.id === modelId)?.name ?? modelId
}

/** The display name of a Built-in AI provider id: its model's name. */
export function getBuiltInAiProviderName(
  providerId: BuiltInAiProviderId,
  models: BuiltInAiModelList,
): string {
  const modelId = getBuiltInAiModelId(providerId)
  return modelId === null ? providerId : getBuiltInAiModelName(models, modelId)
}

export function createBuiltInAiSelectorItem(model: HostedAiModel): SystemProviderSelectorItem {
  return {
    kind: "system",
    id: getBuiltInAiProviderId(model.id),
    name: model.name,
    logo: () => BUILT_IN_AI_PROVIDER_LOGO,
    model: model.id,
    vendor: model.vendor,
    tier: model.tier,
    available: model.available,
  }
}

/**
 * An option for a model no list names. With a list at hand the model is gone
 * from it, so it cannot run; without one, nothing is known either way.
 */
function createUnlistedBuiltInAiSelectorItem(
  modelId: string,
  listKnown: boolean,
): SystemProviderSelectorItem {
  return {
    kind: "system",
    id: getBuiltInAiProviderId(modelId),
    name: modelId,
    logo: () => BUILT_IN_AI_PROVIDER_LOGO,
    model: modelId,
    ...(listKnown && { available: false }),
  }
}

/**
 * The Built-in AI options a menu offers: one per model in the list, then any
 * selected model the list does not name, so the menu still shows what is
 * selected (as unavailable) instead of a blank. With no list at all, the
 * default model and the selected ones, named by id, so a feature on Built-in
 * AI keeps a menu entry until the list arrives.
 */
export function getBuiltInAiSelectorItems(
  builtInAiModels: BuiltInAiModelList,
  selectedProviderIds: Iterable<string> = [],
): SystemProviderSelectorItem[] {
  const items = (builtInAiModels ?? []).map(createBuiltInAiSelectorItem)
  const listed = new Set(items.map((item) => item.model))
  const extraModelIds = builtInAiModels ? [] : [DEFAULT_BUILT_IN_AI_MODEL_ID]
  for (const providerId of selectedProviderIds) {
    const modelId = getBuiltInAiModelId(providerId)
    if (modelId !== null) {
      extraModelIds.push(modelId)
    }
  }
  for (const modelId of extraModelIds) {
    if (!listed.has(modelId)) {
      listed.add(modelId)
      items.push(
        createUnlistedBuiltInAiSelectorItem(
          modelId,
          builtInAiModels !== null && builtInAiModels !== undefined,
        ),
      )
    }
  }
  return items
}

export function isSystemProviderId(providerId: string): boolean {
  return getBuiltInAiModelId(providerId) !== null
}

export function getLocalProviderPredicateForCapability<C extends ProviderCapability>(
  capability: C,
): ProviderConfigPredicate<ProviderConfigForCapability<C>> {
  return LOCAL_PROVIDER_CAPABILITY_PREDICATES[capability] as ProviderConfigPredicate<
    ProviderConfigForCapability<C>
  >
}

export function isLocalProviderConfigCompatibleWithCapability<C extends ProviderCapability>(
  capability: C,
  providerConfig: ProviderConfig,
): providerConfig is ProviderConfigForCapability<C> {
  return getLocalProviderPredicateForCapability(capability)(providerConfig)
}

/**
 * The Built-in AI provider ids that can run a capability: one per model in the
 * list, or, with no list at hand, the default model's, so a caller that only
 * needs "some Built-in AI" still has one to offer.
 */

/** Built-in account models are recognized only by the legacy config reader. */
export function getSystemProviderIdsForCapability(
  _capability: ProviderCapability,
  _models?: BuiltInAiModelList,
): string[] {
  return []
}

export function doesProviderSupportsCapability(
  capability: ProviderCapability,
  providersConfig: ProvidersConfig,
  providerId: string,
  options: { requireEnable?: boolean } = {},
): boolean {
  const provider = providersConfig.find((item) => item.id === providerId)
  if (!provider) {
    return (
      (capability === "customAction" && providerId === UNCONFIGURED_AI_PROVIDER_ID) ||
      (isSystemProviderId(providerId) && isBuiltInAiCapability(capability))
    )
  }
  return (
    (!options.requireEnable || provider.enabled) &&
    isLocalProviderConfigCompatibleWithCapability(capability, provider)
  )
}

export function getProviderIdsForCapability(
  capability: ProviderCapability,
  providersConfig: ProvidersConfig,
  options: { requireEnable?: boolean; builtInAiModels?: BuiltInAiModelList } = {},
): string[] {
  return providersConfig
    .filter(
      (provider) =>
        (!options.requireEnable || provider.enabled) &&
        isLocalProviderConfigCompatibleWithCapability(capability, provider),
    )
    .map((provider) => provider.id)
}

export function getSelectableProvidersForCapability(
  capability: ProviderCapability,
  providersConfig: ProvidersConfig,
  _models?: BuiltInAiModelList,
  _selectedProviderIds?: Iterable<string>,
): ProviderSelectorOption[] {
  return providersConfig.filter(
    (provider) =>
      provider.enabled && isLocalProviderConfigCompatibleWithCapability(capability, provider),
  )
}

export function resolveProviderRefForCapability<C extends ProviderCapability>(
  capability: C,
  providersConfig: ProvidersConfig,
  providerId: string,
  _models?: BuiltInAiModelList,
): ProviderRefForCapability<C> | null {
  const provider = providersConfig.find((item) => item.id === providerId)
  if (!provider || !isLocalProviderConfigCompatibleWithCapability(capability, provider)) {
    return null
  }
  return { kind: "local", config: provider, id: provider.id, name: provider.name }
}
