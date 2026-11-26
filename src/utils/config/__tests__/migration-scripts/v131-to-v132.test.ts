import { describe, expect, it } from "vitest"
import { configSchema } from "@/types/config/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { DEFAULT_PROVIDER_CONFIG, PROVIDER_GROUPS } from "@/utils/constants/providers"
import { migrateConfig } from "../../migration"
import { migrate } from "../../migration-scripts/v131-to-v132"

const retiredPresets = [
  { id: "jalape-personal", provider: "jalapenocloud", name: "Old Jalapeno", enabled: true },
  { id: "if-personal", provider: "ifapi", name: "Old IF API", enabled: true },
  { id: "atlas-personal", provider: "atlascloud", name: "Old Atlas", enabled: false },
]

describe("retired provider migration", () => {
  it("removes the presets from all Add Provider groups", () => {
    const offeredProviders = Object.values(PROVIDER_GROUPS).flatMap((group) => [...group.types])
    for (const { provider } of retiredPresets) {
      expect(offeredProviders).not.toContain(provider)
    }
    expect(offeredProviders).toContain("openai-compatible")
  })

  it("preserves unrelated settings and repairs every provider selection in a v131 backup", async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    const custom = {
      ...DEFAULT_PROVIDER_CONFIG["openai-compatible"],
      name: "Private gateway",
      apiKey: "test-secret",
      baseURL: "https://example.test/v1",
    }
    config.providersConfig.push(custom)
    config.pageTranslation.providerId = "atlas-personal"
    config.pageTranslation.mode = "translationOnly"
    config.inputTranslation.providerId = "if-personal"
    config.videoSubtitles.providerId = custom.id
    config.selectionToolbar.features.translate.providerId = "jalape-personal"
    config.selectionToolbar.builtInActions.dictionary.providerId = "jalape-personal"
    config.selectionToolbar.customActions = [
      {
        id: "user-action",
        name: "Explain an idiom",
        enabled: true,
        providerId: "if-personal",
        icon: "tabler:sparkles",
        systemPrompt: "",
        prompt: "Explain {{selection}}",
        outputSchema: [{ id: "meaning", name: "meaning", type: "string", description: "" }],
      },
    ]
    config.translationHub.selectedProviderIds = ["if-personal", custom.id, "atlas-personal"]
    config.languageDetection = { mode: "llm", providerId: "if-personal" }
    config.uiLanguage = "zh-CN"
    const old = { ...config, providersConfig: [...config.providersConfig, ...retiredPresets] }

    const result = await migrateConfig(old, 131)
    expect(result.providersConfig).toContainEqual(custom)
    expect(result.providersConfig).toHaveLength(config.providersConfig.length)
    expect(result.pageTranslation).toMatchObject({
      providerId: "google-translate-default",
      mode: "translationOnly",
    })
    expect(result.inputTranslation.providerId).toBe("microsoft-translate-default")
    expect(result.videoSubtitles.providerId).toBe(custom.id)
    expect(result.selectionToolbar.features.translate.providerId).toBe(
      "microsoft-translate-default",
    )
    expect(result.selectionToolbar.builtInActions.dictionary.providerId).toBe(
      "unconfigured-local-ai",
    )
    expect(result.selectionToolbar.customActions[0]).toMatchObject({
      providerId: "unconfigured-local-ai",
      prompt: "Explain {{selection}}",
    })
    expect(result.translationHub.selectedProviderIds).toEqual([custom.id])
    expect(result.languageDetection).toEqual({ mode: "basic" })
    expect(result.uiLanguage).toBe("zh-CN")
    expect(configSchema.parse(old)).toEqual(result)
    expect(migrate(result)).toBe(result)
    expect(old.pageTranslation.providerId).toBe("atlas-personal")
  })

  it("adds a usable translation provider when only the retired preset was available", async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.pageTranslation.mode = "translationOnly"
    config.pageTranslation.providerId = "if-personal"
    config.inputTranslation.providerId = "if-personal"
    config.videoSubtitles.providerId = "if-personal"
    config.selectionToolbar.features.translate.providerId = "if-personal"
    config.translationHub.selectedProviderIds = ["if-personal"]

    const result = await migrateConfig({ ...config, providersConfig: [retiredPresets[1]] }, 131)
    expect(result.providersConfig).toEqual([DEFAULT_PROVIDER_CONFIG["microsoft-translate"]])
    expect(result.pageTranslation).toMatchObject({
      providerId: "microsoft-translate-default",
      mode: "bilingual",
    })
    expect(result.translationHub.selectedProviderIds).toBeNull()
  })
})
