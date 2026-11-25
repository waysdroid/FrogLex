import { Icon } from "@iconify/react"
import { browser } from "#imports"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/base-ui/dropdown-menu"
import { toastManager } from "@/components/ui/base-ui/toast"
import { i18n } from "@/utils/i18n"
import { createLogger } from "@/utils/logging/logger"
import { sendMessage } from "@/utils/message"

const log = createLogger("popup/more-menu")

/** Opens the panel on the page itself, then gets out of its way. */
async function diagnoseCurrentPage() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined) throw new Error("No active tab")
    await sendMessage("togglePageTranslationDiagnostics", undefined, { tabId: tab.id, frameId: 0 })
    window.close()
  } catch (error) {
    // Pages the extension cannot run on (browser pages, the store, disabled sites).
    log.warn("Could not open the page diagnosis", { error })
    toastManager.add({ type: "error", title: i18n.t("pageDiagnosis.unavailable") })
  }
}

export function MoreMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 hover:bg-neutral-300 dark:hover:bg-neutral-700"
          />
        }
      >
        <Icon icon="tabler:dots" className="size-4" strokeWidth={1.6} />
        <span className="text-[13px] font-medium">{i18n.t("popup.more.title")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuItem onClick={() => void diagnoseCurrentPage()} className="cursor-pointer">
          <Icon icon="tabler:stethoscope" className="size-4" strokeWidth={1.6} />
          {i18n.t("popup.more.diagnosePage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
