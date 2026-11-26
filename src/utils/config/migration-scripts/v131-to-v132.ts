const RETIRED_PROVIDERS = new Set(["jalapenocloud", "ifapi", "atlascloud"])

// Keep this independent of the current provider registry so it can read older backups.
export function migrate(oldConfig: any): any {
  if (!oldConfig || typeof oldConfig !== "object" || !Array.isArray(oldConfig.providersConfig)) {
    return oldConfig
  }

  const removedProviders = oldConfig.providersConfig.filter((provider: any) =>
    RETIRED_PROVIDERS.has(provider?.provider),
  )
  if (!removedProviders.length) return oldConfig

  const removedIds = new Set(
    removedProviders
      .map((provider: any) => provider.id)
      .filter((id: unknown) => typeof id === "string"),
  )
  const next = structuredClone(oldConfig)
  next.providersConfig = next.providersConfig.filter(
    (provider: any) => !RETIRED_PROVIDERS.has(provider?.provider),
  )

  const toolbar = next.selectionToolbar
  const translation = [
    next.pageTranslation,
    next.inputTranslation,
    next.videoSubtitles,
    toolbar?.features?.translate,
  ].filter((section) => removedIds.has(section?.providerId))

  if (translation.length) {
    const providers = next.providersConfig
    const google = providers.find(
      (provider: any) => provider?.enabled && provider.provider === "google-translate",
    )
    let fallback =
      providers.find(
        (provider: any) => provider?.enabled && provider.provider === "microsoft-translate",
      ) ?? google
    if (!fallback) {
      let id = "microsoft-translate-default"
      let name = "Microsoft Translator"
      for (
        let suffix = 2;
        providers.some((provider: any) => provider?.id === id || provider?.name === name);
        suffix++
      ) {
        id = `microsoft-translate-${suffix}`
        name = `Microsoft Translator ${suffix}`
      }
      fallback = { id, name, enabled: true, provider: "microsoft-translate" }
      providers.push(fallback)
    }

    for (const section of translation) {
      if (section === next.pageTranslation && section.mode === "translationOnly") {
        if (google) {
          section.providerId = google.id
          continue
        }
        section.mode = "bilingual"
      }
      section.providerId = fallback.id
    }
  }

  for (const action of [
    ...Object.values<Record<string, unknown>>(toolbar?.builtInActions ?? {}),
    ...(Array.isArray(toolbar?.customActions) ? toolbar.customActions : []),
  ]) {
    if (action && removedIds.has(action.providerId)) {
      action.providerId = "unconfigured-local-ai"
    }
  }

  if (removedIds.has(next.languageDetection?.providerId)) {
    next.languageDetection = { ...next.languageDetection, mode: "basic" }
    delete next.languageDetection.providerId
  }
  if (Array.isArray(next.translationHub?.selectedProviderIds)) {
    const kept = next.translationHub.selectedProviderIds.filter(
      (id: unknown) => !removedIds.has(id),
    )
    next.translationHub.selectedProviderIds = kept.length ? kept : null
  }

  return next
}
