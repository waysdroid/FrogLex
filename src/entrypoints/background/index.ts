import "@/utils/zod-config"
import type { Config, UiLanguage } from "@/types/config/config"
import { browser, defineBackground } from "#imports"
import { storageAdapter } from "@/utils/atoms/storage-adapter"
import { CONFIG_STORAGE_KEY } from "@/utils/constants/config"
import { initI18n, setUiLanguage } from "@/utils/i18n"
import { ensureInstalledAtRecorded } from "@/utils/install-time"
import { createLogger } from "@/utils/logging/logger"
import { setupBackgroundLogging } from "@/utils/logging/setup-background"
import { onMessage } from "@/utils/message"
import { openOptionsPage } from "@/utils/navigation"
import { runAiSegmentSubtitles } from "./ai-segmentation"
import { dispatchBackgroundStreamPort } from "./background-stream"
import { initializeActionIcons, registerActionIconListeners } from "./browser-action-icon"
import { ensureInitializedConfig } from "./config"
import { setUpConfigBackup } from "./config-backup"
import { initializeContextMenu, registerContextMenuListeners } from "./context-menu"
import {
  cleanupAllAiSegmentationCache,
  cleanupAllSummaryCache,
  cleanupAllTranslationCache,
  setUpDatabaseCleanup,
} from "./db-cleanup"
import { setupDiagnosticsHandlers } from "./diagnostics"
import { setupEdgeTTSMessageHandlers } from "./edge-tts"
import { setupFeatureUsedEventHandlers } from "./feature-used-event"
import { setupGlossaryMessageHandlers } from "./glossary"
import { setupIframeInjection } from "./iframe-injection"
import { setupLLMGenerateTextMessageHandlers } from "./llm-generate-text"
import { initMockData } from "./mock-data"
import { setupPageTranslationHandlers } from "./page-translation"
import { setupPersonalVocabularyMessageHandlers } from "./personal-vocabulary"
import { proxyFetch } from "./proxy-fetch"
import { setupSelectionToolbarHiddenUntilReload } from "./selection-toolbar-hidden"
import { setupSidePanelMessageHandler } from "./side-panel"
import { setupSubtitlesTranslationHandlers } from "./subtitles-translation"
import { translationMessage } from "./translation-signal"
import { setupTTSPlaybackMessageHandlers } from "./tts-playback"
import { setupVideoSummaryHandlers } from "./video-summary"
import { setupWebDavSync } from "./webdav-sync"

const log = createLogger("background")

export default defineBackground({
  type: "module",
  main: () => {
    // First, so nothing below logs before the local log is there to keep it.
    setupBackgroundLogging()
    setupDiagnosticsHandlers()
    setupPersonalVocabularyMessageHandlers()
    log.debug("Hello background!", { id: browser.runtime.id })

    browser.runtime.onInstalled.addListener(async () => {
      await ensureInstalledAtRecorded()
      await ensureInitializedConfig()
      await browser.runtime.setUninstallURL("").catch(() => {})
    })

    onMessage("openPage", async (message) => {
      const { url, active } = message.data
      log.debug("openPage", { url, active })
      await browser.tabs.create({ url, active: active ?? true })
    })

    onMessage("openOptionsPage", async (message) => {
      log.debug("openOptionsPage", { data: message.data })
      await openOptionsPage(message.data)
    })

    setupSidePanelMessageHandler({
      extensionBrowser: browser,
      registerMessageHandler: onMessage,
    })

    onMessage("aiSegmentSubtitles", async (message) => {
      try {
        return await runAiSegmentSubtitles(message.data)
      } catch (error) {
        log.error("aiSegmentSubtitles failed", { error })
        throw error
      }
    })

    browser.runtime.onConnect.addListener((port) => {
      dispatchBackgroundStreamPort(port)
    })

    onMessage("clearAllTranslationRelatedCache", async () => {
      await cleanupAllTranslationCache()
      await cleanupAllSummaryCache()
    })

    onMessage("clearAiSegmentationCache", async () => {
      await cleanupAllAiSegmentationCache()
    })

    setupFeatureUsedEventHandlers()
    translationMessage()
    registerActionIconListeners()

    // Initialize action icons asynchronously
    void initializeActionIcons()

    // Synchronous: all translation and summary handlers register in the first turn of
    // the SW so wake-triggering messages are never dropped during init.
    setupPageTranslationHandlers()
    setupSubtitlesTranslationHandlers()
    setupVideoSummaryHandlers()
    void setUpDatabaseCleanup()
    setUpConfigBackup()

    // Start config and i18n initialization without delaying synchronous listener
    // registration. Consumers that materialize localized config-derived data await
    // this shared barrier before reading it.
    let currentUiLanguage: UiLanguage | undefined
    const backgroundReady = (async () => {
      const config = await ensureInitializedConfig()
      currentUiLanguage = config?.uiLanguage ?? "auto"
      await initI18n(currentUiLanguage)
    })()

    setupWebDavSync(() => backgroundReady)

    // Register context menu listeners synchronously
    // This ensures listeners are registered before Chrome completes initialization
    registerContextMenuListeners(() => backgroundReady)

    proxyFetch()
    setupGlossaryMessageHandlers()
    setupEdgeTTSMessageHandlers()
    setupLLMGenerateTextMessageHandlers()
    setupTTSPlaybackMessageHandlers()
    void initMockData()

    // Setup on-demand iframe injection after page translation is enabled.
    setupIframeInjection()
    setupSelectionToolbarHiddenUntilReload()

    // i18n bootstrap for the non-React background context. Runs after the synchronous
    // listener registration above (MV3 requires listeners before the first await). The
    // context menu resolves i18n.t at registration time and must await initI18n.
    void (async () => {
      await backgroundReady
      void initializeContextMenu()
    })()

    // Keep background-resolved strings in the selected language when it changes.
    // The context menu re-creates itself via its own config watcher
    // (registerContextMenuListeners), so here we only drive the i18next singleton.
    storageAdapter.watch<Config>(CONFIG_STORAGE_KEY, (newConfig) => {
      void (async () => {
        await backgroundReady
        if (newConfig.uiLanguage === currentUiLanguage) return
        currentUiLanguage = newConfig.uiLanguage
        await setUiLanguage(newConfig.uiLanguage)
      })()
    })
  },
})
