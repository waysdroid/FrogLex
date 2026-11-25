import type { Browser } from "wxt/browser"
import type { VocabularyResponse } from "@/utils/message"
import type { VocabularyReceipt } from "@/utils/personal-vocabulary/repository"
import { browser } from "#imports"
import { onMessage } from "@/utils/message"
import { personalVocabularyRepository } from "@/utils/personal-vocabulary/repository"
import {
  sanitizeVocabularyUrl,
  vocabularyLookupSchema,
  vocabularySaveSchema,
} from "@/utils/personal-vocabulary/schema"

function getSenderUrl(sender: Browser.runtime.MessageSender) {
  if (sender.id !== browser.runtime.id || !sender.tab || !sender.url) return undefined
  return sanitizeVocabularyUrl(sender.url)
}

export function setupPersonalVocabularyMessageHandlers() {
  onMessage(
    "findPersonalVocabularyEntry",
    async ({ data, sender }): Promise<VocabularyResponse<{ entryId: string } | null>> => {
      const request = vocabularyLookupSchema.safeParse(data)
      if (!getSenderUrl(sender) || !request.success) {
        return { ok: false, reason: "invalid" }
      }
      try {
        const match = await personalVocabularyRepository.findByTerm(request.data)
        return { ok: true, value: match }
      } catch {
        return { ok: false, reason: "storage" }
      }
    },
  )

  onMessage(
    "savePersonalVocabularyEncounter",
    async ({ data, sender }): Promise<VocabularyResponse<VocabularyReceipt>> => {
      const senderUrl = getSenderUrl(sender)
      const request = vocabularySaveSchema.safeParse(data)
      if (!senderUrl || !request.success) {
        return { ok: false, reason: "invalid" }
      }

      const sourceUrl = request.data.context?.source?.url
      if (sourceUrl && new URL(sourceUrl).origin !== new URL(senderUrl).origin) {
        return { ok: false, reason: "invalid" }
      }

      try {
        const receipt = await personalVocabularyRepository.saveEncounter(request.data)
        return { ok: true, value: receipt }
      } catch (error) {
        const reason =
          error instanceof Error && error.name === "QuotaExceededError" ? "quota" : "storage"
        return { ok: false, reason }
      }
    },
  )
}
