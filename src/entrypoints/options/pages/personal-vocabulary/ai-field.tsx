import type { LLMProviderConfig } from "@/types/config/provider"
import type { VocabularyAiFieldName } from "@/utils/personal-vocabulary/ai-fields"
import type { VocabularyAiUndoValue } from "@/utils/personal-vocabulary/schema"
import { IconSparkles } from "@tabler/icons-react"
import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/base-ui/dialog"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { i18n } from "@/utils/i18n"
import {
  defaultVocabularyPrompt,
  generateVocabularyField,
  getVocabularyPrompt,
  MAX_VOCABULARY_PROMPT_LENGTH,
  saveVocabularyPrompt,
} from "@/utils/personal-vocabulary/ai"
import { undoVocabularyAiAddition } from "@/utils/personal-vocabulary/ai-fields"
import { comparableVocabularyText, isVocabularyTerm } from "@/utils/personal-vocabulary/schema"

function VocabularyPromptDialog({ field, label }: { field: VocabularyAiFieldName; label: string }) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const promptId = useId()

  useEffect(() => {
    if (!open) return undefined
    let active = true
    void getVocabularyPrompt(field).then(
      (value) => {
        if (active) setPrompt(value)
      },
      () => {
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [field, open])

  async function save() {
    if (prompt === undefined) return
    setSaving(true)
    setFailed(false)
    try {
      await saveVocabularyPrompt(field, prompt)
      setOpen(false)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        if (next) {
          setPrompt(undefined)
          setFailed(false)
        }
        setOpen(next)
      }}
    >
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" />}
        aria-label={i18n.t("personalVocabulary.ai.promptTitle", [label])}
      >
        {i18n.t("personalVocabulary.ai.prompt")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{i18n.t("personalVocabulary.ai.promptTitle", [label])}</DialogTitle>
          <DialogDescription>{i18n.t("personalVocabulary.ai.promptDescription")}</DialogDescription>
        </DialogHeader>
        <label htmlFor={promptId}>
          {i18n.t("personalVocabulary.ai.prompt")}
          <Textarea
            id={promptId}
            className="mt-1.5 max-h-64 min-h-36 overflow-y-auto"
            maxLength={MAX_VOCABULARY_PROMPT_LENGTH}
            disabled={saving || prompt === undefined}
            value={prompt ?? ""}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        {failed && (
          <p role="alert" className="text-destructive">
            {i18n.t("personalVocabulary.errors.storage")}
          </p>
        )}
        <DialogFooter className="flex-wrap">
          <Button
            type="button"
            variant="ghost"
            disabled={saving || prompt === undefined}
            onClick={() => setPrompt(defaultVocabularyPrompt(field))}
          >
            {i18n.t("personalVocabulary.ai.resetPrompt")}
          </Button>
          <DialogClose render={<Button type="button" variant="outline" disabled={saving} />}>
            {i18n.t("personalVocabulary.cancel")}
          </DialogClose>
          <Button
            type="button"
            disabled={saving || prompt === undefined}
            onClick={() => void save()}
          >
            {i18n.t("personalVocabulary.ai.savePrompt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type VocabularyAiInput = { term: string; partOfSpeech: string }
type VocabularyAiFeedback = "invalidTerm" | "failed" | "empty" | "duplicate" | "tooLong" | "stale"

export function VocabularyAiField({
  field,
  initialValue,
  maxLength,
  provider,
  getInput,
  undo,
  onUndoChange,
}: {
  field: VocabularyAiFieldName
  initialValue?: string
  maxLength: number
  provider?: LLMProviderConfig
  getInput: () => VocabularyAiInput
  undo?: VocabularyAiUndoValue
  onUndoChange: (next?: VocabularyAiUndoValue) => void
}) {
  const [value, setValue] = useState(initialValue ?? "")
  const [suggestion, setSuggestion] = useState<(VocabularyAiInput & { text: string }) | null>(null)
  const [feedback, setFeedback] = useState<VocabularyAiFeedback | null>(null)
  const [generating, setGenerating] = useState(false)
  const request = useRef<AbortController | null>(null)
  const id = useId()
  const label = i18n.t(`personalVocabulary.fields.${field}`)
  const undoValue = undo && undoVocabularyAiAddition(value, undo)

  useEffect(() => () => request.current?.abort(), [])

  async function generate() {
    if (!provider || request.current) return
    const input = getInput()
    if (!isVocabularyTerm(input.term)) {
      setFeedback("invalidTerm")
      return
    }
    const controller = new AbortController()
    request.current = controller
    setGenerating(true)
    setSuggestion(null)
    setFeedback(null)
    try {
      const text = await generateVocabularyField({
        field,
        ...input,
        provider,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (text) setSuggestion({ ...input, text })
      else setFeedback("empty")
    } catch {
      if (!controller.signal.aborted) setFeedback("failed")
    } finally {
      request.current = null
      if (!controller.signal.aborted) setGenerating(false)
    }
  }

  function apply() {
    if (!suggestion) return
    const input = getInput()
    if (input.term !== suggestion.term || input.partOfSpeech !== suggestion.partOfSpeech) {
      setSuggestion(null)
      setFeedback("stale")
      return
    }
    const before = value.trim()
    const duplicate = before
      .split(/\n\s*\n/u)
      .some(
        (block) => comparableVocabularyText(block) === comparableVocabularyText(suggestion.text),
      )
    if (
      duplicate ||
      comparableVocabularyText(before) === comparableVocabularyText(suggestion.text)
    ) {
      setSuggestion(null)
      setFeedback("duplicate")
      return
    }
    const after = before ? `${before}\n\n${suggestion.text}` : suggestion.text
    if (after.length > maxLength) {
      setFeedback("tooLong")
      return
    }
    setValue(after)
    onUndoChange({ before, after })
    setSuggestion(null)
    setFeedback(null)
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <div className="flex flex-wrap gap-1">
          {generating ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                request.current?.abort()
                setGenerating(false)
              }}
            >
              {i18n.t("personalVocabulary.ai.cancelGeneration")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!provider}
              aria-label={i18n.t("personalVocabulary.ai.generateField", [label])}
              onClick={() => void generate()}
            >
              <IconSparkles aria-hidden="true" />
              {i18n.t("personalVocabulary.ai.generate")}
            </Button>
          )}
          <VocabularyPromptDialog field={field} label={label} />
          {undo && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={undoValue === undefined}
              onClick={() => {
                if (undoValue === undefined) return
                setValue(undoValue)
                onUndoChange()
                setFeedback(null)
              }}
            >
              {i18n.t("personalVocabulary.ai.undo")}
            </Button>
          )}
        </div>
      </div>
      <Textarea
        id={id}
        name={field}
        maxLength={maxLength}
        className="max-h-72 overflow-y-auto"
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setFeedback(null)
        }}
      />
      {undo && undoValue === undefined && (
        <p className="text-xs text-muted-foreground">
          {i18n.t("personalVocabulary.ai.undoUnavailable")}
        </p>
      )}
      {generating && (
        <p role="status" className="text-xs text-muted-foreground">
          {i18n.t("personalVocabulary.ai.generating")}
        </p>
      )}
      {suggestion && (
        <div className="space-y-2 rounded-md bg-muted/60 p-3">
          <div className="text-sm font-medium">{i18n.t("personalVocabulary.ai.suggestion")}</div>
          <p className="max-h-52 overflow-y-auto text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">
            {suggestion.text}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={apply}>
              {i18n.t("personalVocabulary.ai.apply")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSuggestion(null)
                setFeedback(null)
              }}
            >
              {i18n.t("personalVocabulary.ai.discard")}
            </Button>
          </div>
        </div>
      )}
      {feedback && (
        <p role="status" className="text-xs text-muted-foreground">
          {i18n.t(`personalVocabulary.ai.feedback.${feedback}`)}
        </p>
      )}
    </div>
  )
}
