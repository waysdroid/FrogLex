import type { FormEvent } from "react"
import type { VocabularyReceipt } from "@/utils/personal-vocabulary/repository"
import type { VocabularyDraft } from "@/utils/personal-vocabulary/schema"
import { IconBook2, IconCheck } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Checkbox } from "@/components/ui/base-ui/checkbox"
import { Input } from "@/components/ui/base-ui/input"
import { Label } from "@/components/ui/base-ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/base-ui/popover"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { toastManager } from "@/components/ui/base-ui/toast"
import { useSelectionPopoverOverlayProps } from "@/components/ui/selection-popover"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import {
  isVocabularyTerm,
  MAX_TERM_LENGTH,
  MAX_VOCABULARY_TEXT_LENGTH,
} from "@/utils/personal-vocabulary/schema"

export function SaveToPersonalVocabulary({
  draft,
  operationId,
  targetLanguage,
  waitingForDictionary,
}: {
  draft: VocabularyDraft
  operationId: string
  targetLanguage: string
  waitingForDictionary: boolean
}) {
  const overlay = useSelectionPopoverOverlayProps()
  const [open, setOpen] = useState(false)
  const [editingDraft, setEditingDraft] = useState<VocabularyDraft | null>(null)
  const [keepSource, setKeepSource] = useState(true)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState<VocabularyReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [match, setMatch] = useState<{ term: string; entryId: string } | null>(null)
  const { term, originalTerm, lemmaSource } = draft

  useEffect(() => {
    let active = true
    async function findEntry() {
      try {
        const result = await sendMessage("findPersonalVocabularyEntry", {
          term,
          originalTerm,
          lemmaSource,
        })
        if (active) {
          setMatch(result.ok && result.value ? { term, entryId: result.value.entryId } : null)
        }
      } catch {
        if (active) setMatch(null)
      }
    }

    void findEntry()
    return () => {
      active = false
    }
  }, [term, originalTerm, lemmaSource])

  async function save(next: VocabularyDraft) {
    setPending(true)
    setError(null)
    try {
      const result = await sendMessage("savePersonalVocabularyEncounter", {
        ...next,
        operationId,
      })
      if (result.ok) {
        setSaved(result.value)
        setOpen(false)
      } else {
        reportSaveError(result.reason)
      }
    } catch {
      reportSaveError("storage")
    } finally {
      setPending(false)
    }
  }

  function reportSaveError(reason: "invalid" | "storage" | "quota") {
    const message = i18n.t(`personalVocabulary.errors.${reason}`)
    if (open) setError(message)
    else toastManager.add({ type: "error", title: message })
  }

  async function viewEntry(entryId: string) {
    try {
      await sendMessage("openOptionsPage", { route: `/personal-vocabulary?entry=${entryId}` })
      setError(null)
    } catch {
      toastManager.add({ type: "error", title: i18n.t("personalVocabulary.errors.navigation") })
    }
  }

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) {
      setEditingDraft(draft)
      setKeepSource(true)
      setError(null)
    }
    setOpen(nextOpen)
  }

  const previewMemoryTips = editingDraft?.memoryTips ?? draft.memoryTips

  function submitPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !editingDraft || !isVocabularyTerm(editingDraft.term)) return

    const definition = editingDraft.definition?.text.trim()
    void save({
      ...editingDraft,
      definition: definition
        ? { text: definition, language: editingDraft.definition?.language ?? targetLanguage }
        : undefined,
      memoryTips: previewMemoryTips?.trim() || undefined,
      context: editingDraft.context && {
        ...editingDraft.context,
        source: keepSource ? editingDraft.context.source : undefined,
      },
    })
  }

  const matchingEntryId = match?.term === term ? match.entryId : undefined
  const saveLabel = pending
    ? i18n.t("personalVocabulary.saving")
    : matchingEntryId
      ? i18n.t("personalVocabulary.recordEncounter")
      : waitingForDictionary
        ? i18n.t("personalVocabulary.saveSelection")
        : i18n.t("personalVocabulary.save")
  const savedLabel = saved?.created
    ? i18n.t("personalVocabulary.saved")
    : saved && i18n.t("personalVocabulary.encounters", [saved.encounterCount])
  const existingEntryId = saved?.entryId ?? matchingEntryId
  const viewLabel = i18n.t("personalVocabulary.viewEntry")
  const previewLabel = i18n.t("personalVocabulary.preview")

  return (
    <>
      {saved ? (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <IconCheck aria-hidden="true" className="size-4 shrink-0" />
          {savedLabel}
        </span>
      ) : (
        <>
          <Button size="sm" disabled={pending} onClick={() => void save(draft)}>
            <IconBook2 aria-hidden="true" />
            {saveLabel}
          </Button>
          <Popover open={open} onOpenChange={changeOpen}>
            <PopoverTrigger render={<Button size="sm" variant="outline" disabled={pending} />}>
              {previewLabel}
            </PopoverTrigger>
            <PopoverContent
              container={overlay.container}
              positionerClassName={overlay.positionerClassName}
              side="top"
              align="start"
              className="max-h-[min(26rem,calc(100dvh-2rem))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-3"
            >
              <PopoverTitle>{i18n.t("personalVocabulary.defaultCollection")}</PopoverTitle>
              {editingDraft && (
                <form className="flex flex-col gap-3" onSubmit={submitPreview}>
                  <p className="text-xs wrap-anywhere text-muted-foreground">
                    {i18n.t("personalVocabulary.selectedTerm", [editingDraft.originalTerm])}
                  </p>
                  <Label className="grid gap-1.5">
                    {i18n.t("personalVocabulary.term")}
                    <Input
                      value={editingDraft.term}
                      maxLength={MAX_TERM_LENGTH}
                      required
                      onChange={(event) =>
                        setEditingDraft({
                          ...editingDraft,
                          term: event.target.value,
                          lemmaSource: "user",
                        })
                      }
                    />
                  </Label>
                  <Label className="grid gap-1.5">
                    {i18n.t("personalVocabulary.definition")}
                    <Textarea
                      value={editingDraft.definition?.text ?? ""}
                      maxLength={MAX_VOCABULARY_TEXT_LENGTH}
                      onChange={(event) =>
                        setEditingDraft({
                          ...editingDraft,
                          definition: { text: event.target.value, language: targetLanguage },
                        })
                      }
                    />
                  </Label>
                  <Label className="grid gap-1.5">
                    {i18n.t("personalVocabulary.fields.memoryTips")}
                    <Textarea
                      value={previewMemoryTips ?? ""}
                      maxLength={MAX_VOCABULARY_TEXT_LENGTH}
                      onChange={(event) =>
                        setEditingDraft({ ...editingDraft, memoryTips: event.target.value })
                      }
                    />
                  </Label>
                  {editingDraft.context?.sentence && (
                    <p className="text-xs wrap-anywhere">{editingDraft.context.sentence}</p>
                  )}
                  {editingDraft.context?.source && (
                    <Label className="items-start gap-2 text-xs">
                      <Checkbox checked={keepSource} onCheckedChange={setKeepSource} />
                      <span
                        className="min-w-0 wrap-anywhere"
                        title={editingDraft.context.source.url}
                      >
                        {i18n.t("personalVocabulary.includeSource")}
                        <span className="block text-muted-foreground">
                          {editingDraft.context.source.title || editingDraft.context.source.url}
                        </span>
                      </span>
                    </Label>
                  )}
                  {error && (
                    <p role="alert" className="text-xs text-destructive">
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    size="sm"
                    disabled={pending || !isVocabularyTerm(editingDraft.term)}
                  >
                    {i18n.t(pending ? "personalVocabulary.saving" : "personalVocabulary.confirm")}
                  </Button>
                </form>
              )}
            </PopoverContent>
          </Popover>
        </>
      )}
      {existingEntryId && (
        <Button size="sm" variant="ghost" onClick={() => void viewEntry(existingEntryId)}>
          {viewLabel}
        </Button>
      )}
    </>
  )
}
