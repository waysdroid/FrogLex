// V1.1 removes Read Frog's account providers. Keep existing local providers,
// prompts and shortcuts. The separate personal vocabulary database is untouched.
const MACHINE_PROVIDER = {
  id: "microsoft-translate-default",
  name: "Microsoft Translate",
  enabled: true,
  provider: "microsoft-translate",
}
const UNCONFIGURED_AI = "unconfigured-local-ai"

function isOfficialProvider(id: unknown): boolean {
  return (
    typeof id === "string" &&
    (id.startsWith("read-frog-ai:") || id === "read-frog-free-ai" || id === "read-frog-advance-ai")
  )
}

export function migrate(oldConfig: any): any {
  if (!oldConfig || typeof oldConfig !== "object" || !Array.isArray(oldConfig.providersConfig)) {
    return oldConfig
  }

  const next = structuredClone(oldConfig)
  delete next.builtInAi
  next.providersConfig = next.providersConfig.filter(
    (provider: any) => !isOfficialProvider(provider?.id),
  )

  const toolbar = next.selectionToolbar
  const translation = [
    next.pageTranslation,
    next.inputTranslation,
    next.videoSubtitles,
    toolbar?.features?.translate,
  ]
  if (translation.some((section) => isOfficialProvider(section?.providerId))) {
    const fallback = next.providersConfig.find(
      (provider: any) =>
        provider?.enabled &&
        (provider.provider === "microsoft-translate" || provider.provider === "google-translate"),
    )
    if (!fallback) {
      next.providersConfig = [
        ...next.providersConfig.filter((provider: any) => provider?.id !== MACHINE_PROVIDER.id),
        MACHINE_PROVIDER,
      ]
    }
    for (const section of translation) {
      if (isOfficialProvider(section?.providerId)) {
        section.providerId = fallback?.id ?? MACHINE_PROVIDER.id
      }
    }
    if (
      isOfficialProvider(oldConfig.pageTranslation?.providerId) &&
      next.pageTranslation?.mode === "translationOnly" &&
      fallback?.provider !== "google-translate"
    ) {
      next.pageTranslation.mode = "bilingual"
    }
  }

  if (toolbar && typeof toolbar === "object") {
    delete toolbar.noteSuggestion
    const actions = [
      ...Object.values(toolbar.builtInActions ?? {}),
      ...(Array.isArray(toolbar.customActions) ? toolbar.customActions : []),
    ]
    for (const action of actions) {
      if (!action || typeof action !== "object") continue
      delete action.notebaseConnection
      if (isOfficialProvider(action.providerId)) action.providerId = UNCONFIGURED_AI
    }
  }

  if (isOfficialProvider(next.languageDetection?.providerId)) {
    next.languageDetection = { ...next.languageDetection, mode: "basic" }
    delete next.languageDetection.providerId
  }
  if (Array.isArray(next.translationHub?.selectedProviderIds)) {
    const retained = next.translationHub.selectedProviderIds.filter(
      (id: unknown) => !isOfficialProvider(id),
    )
    next.translationHub.selectedProviderIds = retained.length ? retained : null
  }

  return next
}
