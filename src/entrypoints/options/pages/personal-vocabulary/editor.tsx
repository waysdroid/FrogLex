import type { FormEvent } from "react"
import type { VocabularyEntry, VocabularyGroup } from "@/utils/personal-vocabulary/records"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { i18n } from "@/utils/i18n"
import { DEFAULT_COLLECTION_ID } from "@/utils/personal-vocabulary/records"
import {
  MAX_TERM_LENGTH,
  MAX_VOCABULARY_TEXT_LENGTH,
  vocabularyDifficultySchema,
  vocabularyEditSchema,
} from "@/utils/personal-vocabulary/schema"
import {
  groupLabel,
  useVocabularyGroups,
  vocabularyError,
  vocabularyPath,
  vocabularyQueryKey,
  vocabularyRepository,
  VocabularySelect,
} from "./controls"

const shortFields = ["phonetic", "phoneticUk", "phoneticUs", "partOfSpeech"] as const
export const longFields = [
  "meaningsZh",
  "meaningsEn",
  "memoryTips",
  "note",
  "examples",
  "collocations",
  "synonyms",
  "antonyms",
  "derivatives",
] as const

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
      const parsed = vocabularyEditSchema.parse({
        term,
        originalTerm: text("originalTerm") ?? term,
        lemmaSource: entry && entry.term === term ? entry.lemmaSource : "user",
        ...Object.fromEntries([...shortFields, ...longFields].map((field) => [field, text(field)])),
        difficulty: text("difficulty"),
        definition: definition && {
          text: definition,
          language: text("definitionLanguage") ?? "zh-CN",
        },
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

  if (groups.isPending || (entry && membership.isPending)) {
    return <p role="status">{i18n.t("personalVocabulary.loading")}</p>
  }
  if (groups.error || membership.error || !groups.data) {
    return <p role="alert">{vocabularyError(groups.error ?? membership.error)}</p>
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-medium">
        {i18n.t(entry ? "personalVocabulary.editEntry" : "personalVocabulary.addEntry")}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
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
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.fields.definitionLanguage")}
          <Input
            name="definitionLanguage"
            defaultValue={entry?.definition?.language ?? "zh-CN"}
            maxLength={35}
          />
        </label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">
          {i18n.t("personalVocabulary.definition")}
          <Textarea
            name="definition"
            defaultValue={entry?.definition?.text}
            maxLength={MAX_VOCABULARY_TEXT_LENGTH}
          />
        </label>
        {longFields.map((field) => (
          <label key={field} className="grid gap-1.5 text-sm">
            {i18n.t(`personalVocabulary.fields.${field}`)}
            <Textarea
              name={field}
              defaultValue={entry?.[field]}
              maxLength={field === "note" ? 12000 : MAX_VOCABULARY_TEXT_LENGTH}
            />
          </label>
        ))}
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
