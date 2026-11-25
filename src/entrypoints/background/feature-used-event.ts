import { recordFeatureActiveDay } from "@/utils/feature-active-days"
import { onMessage } from "@/utils/message"

/** Keeps the browser-local active-day count used by the store review prompt. */
export function setupFeatureUsedEventHandlers(): void {
  onMessage("trackFeatureUsedEvent", ({ data }) => {
    const isSaveRequest = data.feature === "note_save" && data.action_id === "save_requested"
    if (data.outcome === "success" && !isSaveRequest) {
      void recordFeatureActiveDay()
    }
  })
}
