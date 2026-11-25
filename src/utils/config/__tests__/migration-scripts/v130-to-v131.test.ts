import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { DEFAULT_CONFIG, buildFreshDefaultConfig } from "@/utils/constants/config"
import { UNCONFIGURED_AI_PROVIDER_ID } from "@/utils/constants/provider-ids"
import { MICROSOFT_TRANSLATE_PROVIDER_ID } from "@/utils/constants/providers"
import { resolveProviderRefForCapability } from "@/utils/providers/provider-registry"
import { migrate } from "../../migration-scripts/v130-to-v131"

describe("personal edition provider migration", () => {
  it("moves old official selections to local defaults and preserves user-owned configuration", () => {
    const config = structuredClone(DEFAULT_CONFIG)
    const google = config.providersConfig.find(
      (provider) => provider.provider === "google-translate",
    )!
    google.enabled = false
    const ownProvider = config.providersConfig.find((provider) => provider.provider === "openai")!
    const officialId = "read-frog-ai:example"
    ownProvider.enabled = true
    config.pageTranslation = {
      ...config.pageTranslation,
      providerId: officialId,
      mode: "translationOnly",
    }
    config.inputTranslation.providerId = ownProvider.id
    config.selectionToolbar.builtInActions.dictionary.providerId = officialId
    config.selectionToolbar.builtInActions.improveWriting.providerId = ownProvider.id
    config.languageDetection = { ...config.languageDetection, mode: "llm", providerId: officialId }
    config.translationHub.selectedProviderIds = [officialId, ownProvider.id]

    const old = {
      ...config,
      builtInAi: { models: {} },
      selectionToolbar: {
        ...config.selectionToolbar,
        noteSuggestion: { enabled: true, providerId: officialId },
      },
    }
    const result = configSchema.parse(migrate(old))
    expect(result.pageTranslation.mode).toBe("bilingual")
    expect(result.inputTranslation.providerId).toBe(ownProvider.id)
    expect(result.selectionToolbar.builtInActions.dictionary.providerId).toBe(
      UNCONFIGURED_AI_PROVIDER_ID,
    )
    expect(result.selectionToolbar.builtInActions.improveWriting.providerId).toBe(ownProvider.id)
    expect(result.languageDetection.mode).toBe("basic")
    expect(result.translationHub.selectedProviderIds).toEqual([ownProvider.id])
    expect(result.providersConfig).toContainEqual(ownProvider)
    expect(result).not.toHaveProperty("builtInAi")
    expect(result.selectionToolbar).not.toHaveProperty("noteSuggestion")
    expect(
      resolveProviderRefForCapability("pageTranslation", result.providersConfig, officialId),
    ).toBeNull()
  })

  it("starts a fresh profile with a machine translator and unassigned AI actions", () => {
    const config = configSchema.parse(buildFreshDefaultConfig())
    expect(config.pageTranslation.providerId).toBe(MICROSOFT_TRANSLATE_PROVIDER_ID)
    expect(config.selectionToolbar.builtInActions.dictionary.providerId).toBe(
      UNCONFIGURED_AI_PROVIDER_ID,
    )
    expect(config.providersConfig.map((provider) => provider.provider)).toEqual([
      "google-translate",
      "microsoft-translate",
    ])
  })
})
