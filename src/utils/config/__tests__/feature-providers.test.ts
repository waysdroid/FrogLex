import type { ProviderConfig } from "@/types/config/provider"
import { describe, expect, it } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { buildFeatureProviderPatch } from "@/utils/constants/feature-providers"
import {
  computeLanguageDetectionFallbackAfterDeletion,
  computeProviderFallbacksAfterDeletion,
  computeSelectionToolbarCustomActionFallbacksAfterDeletion,
  findFeatureMissingProvider,
  resolveLanguageDetectionConfigForModeChange,
} from "../helpers"

function getProviderById(id: string): ProviderConfig {
  const provider = DEFAULT_CONFIG.providersConfig.find((item) => item.id === id)
  if (!provider) throw new Error(`Provider "${id}" not found in DEFAULT_CONFIG.providersConfig`)
  return provider
}

/** Every hosted feature reporting the same verdict on both tiers. */

describe("feature providers", () => {
  describe("buildFeatureProviderPatch", () => {
    it("builds patch for a single feature assignment", () => {
      const patch = buildFeatureProviderPatch({
        pageTranslation: "openai-default",
      })

      expect(patch).toEqual({
        pageTranslation: {
          providerId: "openai-default",
        },
      })
    })

    it("builds patch for multiple feature assignments", () => {
      const patch = buildFeatureProviderPatch({
        pageTranslation: "google-translate-default",
        selectionTranslation: "openai-default",
      })

      expect(patch).toEqual({
        pageTranslation: {
          providerId: "google-translate-default",
        },
        selectionToolbar: {
          features: {
            translate: {
              providerId: "openai-default",
            },
          },
        },
      })
    })
  })

  describe("computeProviderFallbacksAfterDeletion", () => {
    it("returns fallback assignments for every affected feature when candidates exist", () => {
      const config = {
        ...DEFAULT_CONFIG,
        pageTranslation: {
          ...DEFAULT_CONFIG.pageTranslation,
          providerId: "deleted-provider",
        },
        videoSubtitles: {
          ...DEFAULT_CONFIG.videoSubtitles,
          providerId: "deleted-provider",
        },
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          features: {
            ...DEFAULT_CONFIG.selectionToolbar.features,
            translate: { enabled: true, providerId: "deleted-provider", shortcut: "Alt+T" },
          },
        },
        inputTranslation: {
          ...DEFAULT_CONFIG.inputTranslation,
          providerId: "deleted-provider",
        },
      }

      const remainingProviders = [
        getProviderById("google-translate-default"),
        getProviderById("openai-default"),
      ]

      const fallbacks = computeProviderFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(fallbacks).toEqual({
        pageTranslation: "google-translate-default",
        videoSubtitles: "google-translate-default",
        selectionTranslation: "google-translate-default",
        inputTranslation: "google-translate-default",
      })
    })

    it("keeps a fresh profile off Microsoft when it deletes its provider in translationOnly mode", () => {
      // Microsoft cannot run translationOnly page mode (translation-only-gate.ts), and the
      // provider pickers hide it while that mode is active — falling back onto it leaves the
      // page-translate slot pointing at an option missing from its own list, which is what the
      // selector then crashes on. Nothing in the fallback consults the gate, so the guarantee
      // rests entirely on Google leading DEFAULT_PROVIDER_CONFIG_LIST.
      const config = {
        ...DEFAULT_CONFIG,
        pageTranslation: {
          ...DEFAULT_CONFIG.pageTranslation,
          mode: "translationOnly" as const,
          providerId: "deleted-provider",
        },
      }

      const fallbacks = computeProviderFallbacksAfterDeletion(
        "deleted-provider",
        config,
        DEFAULT_CONFIG.providersConfig,
      )

      expect(fallbacks.pageTranslation).toBe("google-translate-default")
    })
  })

  describe("findFeatureMissingProvider", () => {
    // Built-in AI declares every FEATURE_KEYS capability and is synthesized by
    // the registry rather than stored in providersConfig. With no status to
    // judge them by, they count as usable — so deleting local providers cannot
    // report a feature missing. These cases used to report videoSubtitles
    // missing; that was only true while the built-ins lacked the capability.
    // The status-aware cases below cover when they do not count.

    it("returns null when all features have at least one compatible provider", () => {
      const remainingProviders = [getProviderById("google-translate-default")]

      expect(findFeatureMissingProvider(remainingProviders)).toBeNull()
    })

    // The built-ins are in every capability list, so "a provider exists" is
    // always true and cannot gate anything. Judged against a status that walls
    // them off, the guard becomes able to fire again.
  })

  describe("computeSelectionToolbarCustomActionFallbacksAfterDeletion", () => {
    it("reassigns affected custom actions to the first enabled llm provider", () => {
      const config = {
        ...DEFAULT_CONFIG,
        selectionToolbar: {
          ...DEFAULT_CONFIG.selectionToolbar,
          customActions: [
            {
              id: "action-a",
              name: "Action A",
              enabled: true,
              icon: "tabler:sparkles",
              providerId: "deleted-provider",
              systemPrompt: "",
              prompt: "{{selection}}",
              outputSchema: [
                {
                  id: "field-a",
                  name: "summary",
                  type: "string" as const,
                  description: "",
                },
              ],
            },
          ],
        },
      }

      const remainingProviders = [
        {
          ...getProviderById("openai-default"),
          enabled: false,
        },
        getProviderById("deepseek-default"),
      ]

      const result = computeSelectionToolbarCustomActionFallbacksAfterDeletion(
        "deleted-provider",
        config,
        remainingProviders,
      )

      expect(result?.customActions).toEqual([
        expect.objectContaining({
          id: "action-a",
          providerId: "deepseek-default",
        }),
      ])
    })
  })

  describe("resolveLanguageDetectionConfigForModeChange", () => {
    it("assigns the first enabled llm provider when switching from basic to llm", () => {
      const result = resolveLanguageDetectionConfigForModeChange(
        DEFAULT_CONFIG.languageDetection,
        "llm",
        DEFAULT_CONFIG.providersConfig,
      )

      expect(result).toEqual({
        mode: "llm",
        providerId: "openai-default",
      })
    })

    it("keeps the current provider when it is already an enabled llm provider", () => {
      const result = resolveLanguageDetectionConfigForModeChange(
        {
          mode: "basic",
          providerId: "deepseek-default",
        },
        "llm",
        DEFAULT_CONFIG.providersConfig,
      )

      expect(result).toEqual({
        mode: "llm",
        providerId: "deepseek-default",
      })
    })
  })

  describe("computeLanguageDetectionFallbackAfterDeletion", () => {
    it("reassigns language detection to the first enabled llm provider", () => {
      const config = {
        ...DEFAULT_CONFIG,
        languageDetection: {
          mode: "llm" as const,
          providerId: "deleted-provider",
        },
      }

      const result = computeLanguageDetectionFallbackAfterDeletion("deleted-provider", config, [
        {
          ...getProviderById("openai-default"),
          enabled: false,
        },
        getProviderById("deepseek-default"),
      ])

      expect(result).toBe("deepseek-default")
    })
  })
})
