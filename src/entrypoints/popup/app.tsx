import { Icon } from "@iconify/react"
import { browser } from "#imports"
import { useFeatureOn } from "@/hooks/use-feature-on"
import { i18n } from "@/utils/i18n"
import { openOptionsPage } from "@/utils/navigation"
import { version } from "../../../package.json"
import { AISmartContext } from "./components/ai-smart-context"
import { AlwaysTranslate } from "./components/always-translate"
import LanguageOptionsSelector from "./components/language-options-selector"
import { MoreMenu } from "./components/more-menu"
import Hotkey from "./components/node-translation-hotkey-selector"
import ProvidersField from "./components/providers-field"
import { SimpleModeButton } from "./components/simple-mode-button"
import { SiteControlToggle } from "./components/site-control-toggle"
import TranslateButton from "./components/translate-button"
import TranslatePromptSelector from "./components/translate-prompt-selector"
import { TranslationHubButton } from "./components/translation-hub-button"
import TranslationModeSelector from "./components/translation-mode-selector"

function App() {
  const pageTranslationOn = useFeatureOn("pageTranslation")
  const translationHubOn = useFeatureOn("translationHub")

  return (
    <>
      <div className="relative">
        <div className="flex flex-col gap-4 bg-background px-6 pt-5 pb-4">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">
              {i18n.t("personalVocabulary.title")}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {translationHubOn && <TranslationHubButton />}
              <SimpleModeButton />
            </div>
          </div>
          <LanguageOptionsSelector />
          <ProvidersField />
          {pageTranslationOn && (
            <>
              <TranslatePromptSelector />
              <div className="flex w-full items-center gap-2">
                <TranslationModeSelector />
                <TranslateButton className="min-w-0 flex-1" />
              </div>
            </>
          )}
          <SiteControlToggle />
          {pageTranslationOn && (
            <>
              <AlwaysTranslate />
              <Hotkey />
              <AISmartContext />
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between bg-neutral-200 px-2 py-1 dark:bg-neutral-800">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-300 dark:hover:bg-neutral-700"
          onClick={() => {
            void openOptionsPage()
          }}
        >
          <Icon icon="tabler:settings" className="size-4" strokeWidth={1.6} />
          <span className="text-[13px] font-medium">{i18n.t("popup.options")}</span>
        </button>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          {browser.runtime.getManifest().version_name ?? version}
        </span>
        <MoreMenu />
      </div>
    </>
  )
}

export default App
