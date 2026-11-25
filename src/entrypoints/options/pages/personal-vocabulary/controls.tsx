import type { ComponentProps } from "react"
import type { VocabularyGroup } from "@/utils/personal-vocabulary/records"
import { useQuery } from "@tanstack/react-query"
import { i18n } from "@/utils/i18n"
import { DEFAULT_COLLECTION_ID } from "@/utils/personal-vocabulary/records"
import { personalVocabularyRepository } from "@/utils/personal-vocabulary/repository"
import { cn } from "@/utils/styles/utils"

export const vocabularyPath = "/personal-vocabulary"
export const vocabularyQueryKey = ["personal-vocabulary"] as const
export const vocabularyRepository = personalVocabularyRepository

export function useVocabularyGroups() {
  return useQuery({
    queryKey: [...vocabularyQueryKey, "groups"],
    queryFn: () => vocabularyRepository.getOrganization(),
    staleTime: 0,
  })
}

export function groupLabel(group: VocabularyGroup) {
  return group.id === DEFAULT_COLLECTION_ID
    ? i18n.t("personalVocabulary.defaultCollection")
    : group.name
}

export function VocabularySelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  )
}

export function vocabularyError(error: unknown) {
  if (error instanceof Error && error.name === "VocabularyConflict") {
    return i18n.t("personalVocabulary.errors.conflict")
  }
  if (error instanceof Error && error.name === "QuotaExceededError") {
    return i18n.t("personalVocabulary.errors.quota")
  }
  return i18n.t("personalVocabulary.errors.storage")
}
