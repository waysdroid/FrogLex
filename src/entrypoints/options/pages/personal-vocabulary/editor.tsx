import type { FormEvent } from "react"
import type { VocabularyAiFieldName } from "@/utils/personal-vocabulary/ai-fields"
import type { VocabularyEntry, VocabularyGroup } from "@/utils/personal-vocabulary/records"
import type { VocabularyAiUndoValue } from "@/utils/personal-vocabulary/schema"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { isLLMProviderConfig } from "@/types/config/provider"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import {
  isVocabularyAiField,
  undoVocabularyAiAddition,
} from "@/utils/personal-vocabulary/ai-fields"
import {
  editVocabularyDefinitions,
  getVocabularyDefinitions,
} from "@/utils/personal-vocabulary/definitions"
import { DEFAULT_COLLECTION_ID } from "@/utils/personal-vocabulary/records"
import {
  MAX_TERM_LENGTH,
  MAX_VOCABULARY_DEFINITION_LENGTH,
  MAX_VOCABULARY_TEXT_LENGTH,
  vocabularyDifficultySchema,
  vocabularyEditSchema,
} from "@/utils/personal-vocabulary/schema"
import { resolveModelId } from "@/utils/providers/model-id"
import { VocabularyAiField } from "./ai-field"
import {
  getVocabularyTextFields,
  groupLabel,
  useVocabularyGroups,
  vocabularyError,
  vocabularyNotesFields,
  vocabularyPath,
  vocabularyQueryKey,
  vocabularyRepository,
  VocabularySelect,
} from "./controls"

const shortFields = ["phonetic", "phoneticUk", "phoneticUs", "partOfSpeech"] as const

function GroupChoices({
  field,
  groups,
  values,
}: {
  field: "collections" | "tags"
  groups: VocabularyGroup[]
  values: string[]
}) {
  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{i18n.t(`personalVocabulary.${field}`)}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {groups.map((group) => (
          <label key={group.id} className="flex items-center gap-2 text-sm wrap-anywhere">
            <input
              name={field}
              type="checkbox"
              value={group.id}
              defaultChecked={values.includes(group.id)}
            />
            {groupLabel(group)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function VocabularyEditor({
  entry,
  onCancel,
}: {
  entry?: VocabularyEntry
  onCancel: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const [undoHistory, setUndoHistory] = useState(entry?.aiUndo ?? {})
  const [providerId, setProviderId] = useState("")
  const providers = useAtomValue(configFieldsAtomMap.providersConfig)
    .filter(isLLMProviderConfig)
    .filter((provider) => provider.enabled && resolveModelId(provider.model))
  const dictionaryId = useAtomValue(configFieldsAtomMap.selectionToolbar).builtInActions.dictionary
    .providerId
  const selectedId =
    providerId ||
    providers.find(({ id }) => id === dictionaryId)?.id ||
    (providers.length === 1 ? providers[0]?.id : "")
  const provider = providers.find(({ id }) => id === selectedId)
  const otherDefinition = getVocabularyDefinitions(entry).definition
  const groups = useVocabularyGroups()
  const membership = useQuery({
    queryKey: [...vocabularyQueryKey, "membership", entry?.id],
    queryFn: () => vocabularyRepository.getMembership(entry!.id),
    enabled: !!entry,
  })
  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      function text(name: string) {
        const value = data.get(name)
        return typeof value === "string" ? value.trim() || undefined : undefined
      }
      const definition = text("definition")
      const term = text("term")
      const definitions = editVocabularyDefinitions(entry, {
        meaningsZh: text("meaningsZh"),
        meaningsEn: text("meaningsEn"),
        definition: definition
          ? { text: definition, language: text("definitionLanguage") ?? "" }
          : undefined,
      })
      const aiUndo = Object.fromEntries(
        Object.entries(undoHistory).filter(
          ([name, snapshot]) =>
            snapshot && undoVocabularyAiAddition(text(name) ?? "", snapshot) !== undefined,
        ),
      )
      const parsed = vocabularyEditSchema.parse({
        term,
        originalTerm: text("originalTerm") ?? term,
        lemmaSource: entry && entry.term === term ? entry.lemmaSource : "user",
        ...Object.fromEntries(
          [...shortFields, ...vocabularyNotesFields].map((field) => [field, text(field)]),
        ),
        ...definitions,
        difficulty: text("difficulty"),
        aiUndo: Object.keys(aiUndo).length ? aiUndo : undefined,
        favorite: data.has("favorite"),
        important: data.has("important"),
        collectionIds: data.getAll("collections"),
        tagIds: data.getAll("tags"),
      })
      return vocabularyRepository.saveEntry(parsed, entry?.id)
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: vocabularyQueryKey })
      if (entry) onCancel()
      else void navigate(`${vocabularyPath}?entry=${id}`)
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate(new FormData(event.currentTarget))
  }

  function getAiInput() {
    const term = formRef.current?.elements.namedItem("term")
    const partOfSpeech = formRef.current?.elements.namedItem("partOfSpeech")
    return {
      term: term instanceof HTMLInputElement ? term.value.trim() : "",
      partOfSpeech: partOfSpeech instanceof HTMLInputElement ? partOfSpeech.value.trim() : "",
    }
  }

  function updateUndo(field: VocabularyAiFieldName, next?: VocabularyAiUndoValue) {
    setUndoHistory((previous) => ({ ...previous, [field]: next }))
  }

  if (groups.isPending || (entry && membership.isPending)) {
    return <p role="status">{i18n.t("personalVocabulary.loading")}</p>
  }
  if (groups.error || membership.error || !groups.data) {
    return <p role="alert">{vocabularyError(groups.error ?? membership.error)}</p>
  }
  return (
    <form ref={formRef} onSubmit={submit} className="space-y-5 rounded-lg border p-4">
      <h2 className="text-lg font-medium">
        {i18n.t(entry ? "personalVocabulary.editEntry" : "personalVocabulary.addEntry")}
      </h2>
      <div className="grid gap-4 @md:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.term")}
          <Input name="term" required defaultValue={entry?.term} maxLength={MAX_TERM_LENGTH} />
        </label>
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.fields.originalTerm")}
          <Input
            name="originalTerm"
            defaultValue={entry?.originalTerm}
            maxLength={MAX_TERM_LENGTH}
          />
        </label>
      </div>
      <section
        className="space-y-2 rounded-lg bg-muted/40 p-3"
        aria-label={i18n.t("personalVocabulary.ai.title")}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {i18n.t("personalVocabulary.ai.model")}
            <VocabularySelect
              value={provider?.id ?? ""}
              onChange={(event) => setProviderId(event.target.value)}
            >
              <option value="" disabled>
                {i18n.t("personalVocabulary.ai.chooseModel")}
              </option>
              {providers.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </VocabularySelect>
          </label>
          {!providers.length && (
            <Link className="text-sm text-primary underline underline-offset-2" to="/api-providers">
              {i18n.t("personalVocabulary.ai.configureModel")}
            </Link>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {i18n.t("personalVocabulary.ai.description")}
        </p>
      </section>
      <div className="space-y-4">
        {getVocabularyTextFields(entry).map(({ name, text }) => {
          if (name === "definition") return null
          const maxLength =
            name === "meaningsZh" || name === "meaningsEn"
              ? MAX_VOCABULARY_DEFINITION_LENGTH
              : name === "note"
                ? 12000
                : MAX_VOCABULARY_TEXT_LENGTH
          return isVocabularyAiField(name) ? (
            <VocabularyAiField
              key={name}
              field={name}
              initialValue={text}
              maxLength={maxLength}
              provider={provider}
              getInput={getAiInput}
              undo={undoHistory[name]}
              onUndoChange={(next) => updateUndo(name, next)}
            />
          ) : (
            <label key={name} className="grid gap-1.5 text-sm font-medium">
              {i18n.t(`personalVocabulary.fields.${name}`)}
              <Textarea
                name={name}
                defaultValue={text}
                maxLength={maxLength}
                className="max-h-72 overflow-y-auto font-normal"
              />
            </label>
          )
        })}
      </div>
      <details open={!!otherDefinition} className="space-y-3 rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {i18n.t("personalVocabulary.otherDefinition")}
        </summary>
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.otherDefinitionLanguage")}
          <Input
            name="definitionLanguage"
            defaultValue={otherDefinition?.language}
            maxLength={35}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.definition")}
          <Textarea
            name="definition"
            defaultValue={otherDefinition?.text}
            maxLength={MAX_VOCABULARY_TEXT_LENGTH}
          />
        </label>
      </details>
      <div className="grid gap-3 border-t pt-4 @md:grid-cols-2">
        {shortFields.map((field) => (
          <label key={field} className="grid gap-1.5 text-sm">
            {i18n.t(`personalVocabulary.fields.${field}`)}
            <Input name={field} defaultValue={entry?.[field]} maxLength={240} />
          </label>
        ))}
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.fields.difficulty")}
          <VocabularySelect name="difficulty" defaultValue={entry?.difficulty ?? ""}>
            <option value="">{i18n.t("personalVocabulary.emptyValue")}</option>
            {vocabularyDifficultySchema.options.map((level) => (
              <option key={level}>{level}</option>
            ))}
          </VocabularySelect>
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input name="favorite" type="checkbox" defaultChecked={entry?.favorite} />
          {i18n.t("personalVocabulary.fields.favorite")}
        </label>
        <label className="flex items-center gap-2">
          <input name="important" type="checkbox" defaultChecked={entry?.important} />
          {i18n.t("personalVocabulary.fields.important")}
        </label>
      </div>
      <GroupChoices
        field="collections"
        groups={groups.data.collections}
        values={membership.data?.collectionIds ?? [DEFAULT_COLLECTION_ID]}
      />
      {!!groups.data.tags.length && (
        <GroupChoices
          field="tags"
          groups={groups.data.tags}
          values={membership.data?.tagIds ?? []}
        />
      )}
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.name === "ZodError"
            ? i18n.t("personalVocabulary.errors.invalid")
            : vocabularyError(mutation.error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {i18n.t("personalVocabulary.confirm")}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {i18n.t("personalVocabulary.cancel")}
        </Button>
      </div>
    </form>
  )
}

export function VocabularyContextEditor({ entryId }: { entryId: string }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const data = new FormData(form)
      function text(name: string) {
        const value = data.get(name)
        return typeof value === "string" ? value.trim() || undefined : undefined
      }
      const url = text("url")
      const translation = text("translation")
      const meaning = text("meaning")
      const language = text("language") ?? "zh-CN"
      return vocabularyRepository
        .addContext(entryId, {
          sentence: text("sentence"),
          source: url ? { url, title: text("title") } : undefined,
          translation: translation ? { text: translation, language } : undefined,
          meaning: meaning ? { text: meaning, language } : undefined,
        })
        .then(() => form.reset())
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vocabularyQueryKey }),
  })
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        {i18n.t("personalVocabulary.addContext")}
      </summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate(event.currentTarget)
        }}
      >
        <label className="grid gap-1.5 text-sm sm:col-span-2">
          {i18n.t("personalVocabulary.fields.sentence")}
          <Textarea name="sentence" required maxLength={MAX_VOCABULARY_TEXT_LENGTH} />
        </label>
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.fields.sentenceTranslation")}
          <Textarea name="translation" maxLength={MAX_VOCABULARY_TEXT_LENGTH} />
        </label>
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.fields.contextMeaning")}
          <Textarea name="meaning" maxLength={MAX_VOCABULARY_TEXT_LENGTH} />
        </label>
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.fields.definitionLanguage")}
          <Input name="language" defaultValue="zh-CN" maxLength={35} />
        </label>
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.fields.sourceTitle")}
          <Input name="title" maxLength={500} />
        </label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">
          {i18n.t("personalVocabulary.fields.sourceUrl")}
          <Input name="url" type="url" maxLength={2048} />
        </label>
        {mutation.error && (
          <p role="alert" className="text-sm text-destructive">
            {i18n.t("personalVocabulary.errors.invalid")}
          </p>
        )}
        <Button type="submit" className="justify-self-start" disabled={mutation.isPending}>
          {i18n.t("personalVocabulary.confirm")}
        </Button>
      </form>
    </details>
  )
}
