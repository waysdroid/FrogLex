import type {
  VocabularyEntry,
  VocabularyFilters,
  VocabularySort,
} from "@/utils/personal-vocabulary/records"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { Badge } from "@/components/ui/base-ui/badge"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getUiLocale, i18n } from "@/utils/i18n"
import {
  DEFAULT_COLLECTION_ID,
  DEFAULT_VOCABULARY_FILTERS,
} from "@/utils/personal-vocabulary/records"
import { vocabularyDifficultySchema } from "@/utils/personal-vocabulary/schema"
import { PageLayout } from "../../components/page-layout"
import {
  getVocabularyTextFields,
  groupLabel,
  useVocabularyGroups,
  vocabularyError,
  vocabularyPath,
  vocabularyQueryKey,
  vocabularyRepository,
  VocabularySelect,
} from "./controls"
import { VocabularyContextEditor, VocabularyEditor } from "./editor"
import { VocabularyGroups } from "./groups"
import { VocabularyTransfer } from "./transfer"

function EntryHeading({ entry }: { entry: VocabularyEntry }) {
  return (
    <>
      <span lang={entry.language} className="font-medium wrap-anywhere">
        {entry.term}
      </span>
      {entry.phonetic && (
        <span className="text-sm wrap-anywhere text-muted-foreground">{entry.phonetic}</span>
      )}
    </>
  )
}

function VocabularyList() {
  const [filters, setFilters] = useState(DEFAULT_VOCABULARY_FILTERS)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [moveTo, setMoveTo] = useState(DEFAULT_COLLECTION_ID)
  const groups = useVocabularyGroups()
  const queryClient = useQueryClient()
  const search = useDebouncedValue(filters.search, 180)
  const activeFilters = { ...filters, search }
  const result = useQuery({
    queryKey: [...vocabularyQueryKey, "page", activeFilters, page],
    queryFn: () => vocabularyRepository.getPage(activeFilters, page),
    staleTime: 0,
  })
  const mutation = useMutation({
    mutationFn: (action: "remove" | "move") =>
      action === "remove"
        ? vocabularyRepository.deleteEntries(selected)
        : vocabularyRepository.moveEntries(selected, moveTo),
    onSuccess: async () => {
      setSelected([])
      await queryClient.invalidateQueries({ queryKey: vocabularyQueryKey })
    },
  })

  function updateFilter<Key extends keyof VocabularyFilters>(
    key: Key,
    value: VocabularyFilters[Key],
  ) {
    setFilters((previous) => ({ ...previous, [key]: value }))
    setPage(0)
    setSelected([])
  }

  const rows = result.data?.entries ?? []
  const allSelected = rows.length > 0 && rows.every((entry) => selected.includes(entry.id))
  const filterActive =
    search ||
    filters.collectionId ||
    filters.tagId ||
    filters.difficulty ||
    filters.completeness ||
    filters.marker

  return (
    <div className="space-y-5">
      <section
        id="personal-vocabulary-search"
        className="space-y-3"
        aria-label={i18n.t("personalVocabulary.filters")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={filters.search}
            type="search"
            className="w-full @xl:min-w-52 @xl:flex-1"
            aria-label={i18n.t("personalVocabulary.search")}
            placeholder={i18n.t("personalVocabulary.search")}
            onChange={(event) => updateFilter("search", event.target.value)}
          />
          <Button render={<Link to="?new=1" />}>{i18n.t("personalVocabulary.addEntry")}</Button>
          <Button variant="outline" render={<Link to="?transfer=1" />}>
            {i18n.t("personalVocabulary.transfer")}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 @xl:grid-cols-3">
          <VocabularySelect
            aria-label={i18n.t("personalVocabulary.collections")}
            value={filters.collectionId}
            onChange={(event) => updateFilter("collectionId", event.target.value)}
          >
            <option value="">{i18n.t("personalVocabulary.allCollections")}</option>
            {groups.data?.collections.map((group) => (
              <option value={group.id} key={group.id}>
                {groupLabel(group)}
              </option>
            ))}
          </VocabularySelect>
          <VocabularySelect
            aria-label={i18n.t("personalVocabulary.tags")}
            value={filters.tagId}
            onChange={(event) => updateFilter("tagId", event.target.value)}
          >
            <option value="">{i18n.t("personalVocabulary.allTags")}</option>
            {groups.data?.tags.map((group) => (
              <option value={group.id} key={group.id}>
                {group.name}
              </option>
            ))}
          </VocabularySelect>
          <VocabularySelect
            aria-label={i18n.t("personalVocabulary.fields.difficulty")}
            value={filters.difficulty}
            onChange={(event) => updateFilter("difficulty", event.target.value)}
          >
            <option value="">{i18n.t("personalVocabulary.allLevels")}</option>
            {vocabularyDifficultySchema.options.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </VocabularySelect>
          <VocabularySelect
            aria-label={i18n.t("personalVocabulary.completeness")}
            value={filters.completeness}
            onChange={(event) =>
              updateFilter("completeness", event.target.value as VocabularyFilters["completeness"])
            }
          >
            <option value="">{i18n.t("personalVocabulary.completeness")}</option>
            <option value="complete">{i18n.t("personalVocabulary.withDefinition")}</option>
            <option value="missing">{i18n.t("personalVocabulary.withoutDefinition")}</option>
          </VocabularySelect>
          <VocabularySelect
            aria-label={i18n.t("personalVocabulary.markers")}
            value={filters.marker}
            onChange={(event) =>
              updateFilter("marker", event.target.value as VocabularyFilters["marker"])
            }
          >
            <option value="">{i18n.t("personalVocabulary.markers")}</option>
            <option value="favorite">{i18n.t("personalVocabulary.fields.favorite")}</option>
            <option value="important">{i18n.t("personalVocabulary.fields.important")}</option>
          </VocabularySelect>
          <VocabularySelect
            aria-label={i18n.t("personalVocabulary.order")}
            value={filters.sort}
            onChange={(event) => updateFilter("sort", event.target.value as VocabularySort)}
          >
            {(["updated", "added", "alphabetical", "encounters"] as const).map((sort) => (
              <option key={sort} value={sort}>
                {i18n.t(`personalVocabulary.sort.${sort}`)}
              </option>
            ))}
          </VocabularySelect>
        </div>
      </section>
      {result.isPending && <p role="status">{i18n.t("personalVocabulary.loading")}</p>}
      {result.error && (
        <div className="space-y-2">
          <p role="alert">{vocabularyError(result.error)}</p>
          <Button variant="outline" onClick={() => void result.refetch()}>
            {i18n.t("personalVocabulary.retry")}
          </Button>
        </div>
      )}
      {!!result.data && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm text-muted-foreground">
              {i18n.t("personalVocabulary.entryCount", [result.data.total])}
            </p>
            {!!rows.length && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : rows.map(({ id }) => id))}
                />
                {i18n.t("personalVocabulary.selectPage")}
              </label>
            )}
            {!!selected.length && (
              <>
                <span className="text-sm">
                  {i18n.t("personalVocabulary.selectedCount", [selected.length])}
                </span>
                <VocabularySelect
                  aria-label={i18n.t("personalVocabulary.targetCollection")}
                  value={moveTo}
                  onChange={(event) => setMoveTo(event.target.value)}
                >
                  {groups.data?.collections.map((group) => (
                    <option value={group.id} key={group.id}>
                      {groupLabel(group)}
                    </option>
                  ))}
                </VocabularySelect>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => {
                    if (window.confirm(i18n.t("personalVocabulary.confirmMove", [selected.length])))
                      mutation.mutate("move")
                  }}
                >
                  {i18n.t("personalVocabulary.move")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={mutation.isPending}
                  onClick={() => {
                    if (
                      window.confirm(i18n.t("personalVocabulary.confirmDelete", [selected.length]))
                    )
                      mutation.mutate("remove")
                  }}
                >
                  {i18n.t("personalVocabulary.delete")}
                </Button>
              </>
            )}
          </div>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {vocabularyError(mutation.error)}
            </p>
          )}
          {rows.length === 0 ? (
            <p className="rounded-lg border bg-muted/25 p-5 text-sm text-muted-foreground">
              {i18n.t(filterActive ? "personalVocabulary.noMatches" : "personalVocabulary.empty")}
            </p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border">
              {rows.map((entry) => {
                const meaning = entry.definition?.text ?? entry.meaningsZh ?? entry.meaningsEn
                return (
                  <li key={entry.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/60">
                    <input
                      type="checkbox"
                      aria-label={i18n.t("personalVocabulary.selectEntry", [entry.term])}
                      checked={selected.includes(entry.id)}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, entry.id]
                            : selected.filter((id) => id !== entry.id),
                        )
                      }
                      className="mt-1"
                    />
                    <Link
                      to={`?entry=${entry.id}`}
                      className="grid min-w-0 flex-1 gap-1 rounded focus-visible:outline-ring"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <EntryHeading entry={entry} />
                        {entry.favorite && (
                          <Badge variant="secondary">
                            {i18n.t("personalVocabulary.fields.favorite")}
                          </Badge>
                        )}
                        {entry.important && (
                          <Badge variant="outline">
                            {i18n.t("personalVocabulary.fields.important")}
                          </Badge>
                        )}
                      </div>
                      {meaning && (
                        <span className="line-clamp-2 text-sm wrap-anywhere text-muted-foreground">
                          {meaning}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {i18n.t("personalVocabulary.encounters", [entry.encounterCount])}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {result.data.lastPage > 0 && (
            <nav
              aria-label={i18n.t("personalVocabulary.pagination")}
              className="flex items-center justify-end gap-2"
            >
              <Button
                size="sm"
                variant="outline"
                disabled={result.data.page === 0}
                onClick={() => {
                  setPage(result.data.page - 1)
                  setSelected([])
                }}
              >
                {i18n.t("personalVocabulary.previous")}
              </Button>
              <span className="text-sm tabular-nums">
                {result.data.page + 1} / {result.data.lastPage + 1}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={result.data.page >= result.data.lastPage}
                onClick={() => {
                  setPage(result.data.page + 1)
                  setSelected([])
                }}
              >
                {i18n.t("personalVocabulary.next")}
              </Button>
            </nav>
          )}
        </section>
      )}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {i18n.t("personalVocabulary.manageGroups")}
        </summary>
        <div className="mt-3">
          <VocabularyGroups />
        </div>
      </details>
    </div>
  )
}

function VocabularyDetail({ entryId }: { entryId: string }) {
  const [editing, setEditing] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const result = useQuery({
    queryKey: [...vocabularyQueryKey, "detail", entryId],
    queryFn: () => vocabularyRepository.getEntryDetail(entryId),
    staleTime: 0,
  })
  const groups = useVocabularyGroups()
  const membership = useQuery({
    queryKey: [...vocabularyQueryKey, "membership", entryId],
    queryFn: () => vocabularyRepository.getMembership(entryId),
    staleTime: 0,
  })
  const remove = useMutation({
    mutationFn: () => vocabularyRepository.deleteEntries([entryId]),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: vocabularyQueryKey })
      void navigate(vocabularyPath)
    },
  })
  const detail = result.data
  const textFields = getVocabularyTextFields(detail?.entry).filter(({ text }) => text)
  const date = new Intl.DateTimeFormat(getUiLocale(), { dateStyle: "medium" })
  if (editing && detail)
    return <VocabularyEditor entry={detail.entry} onCancel={() => setEditing(false)} />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" render={<Link to={vocabularyPath} />}>
          {i18n.t("personalVocabulary.back")}
        </Button>
        {detail && (
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              {i18n.t("personalVocabulary.editEntry")}
            </Button>
            <Button
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(i18n.t("personalVocabulary.confirmDelete", [1]))) remove.mutate()
              }}
            >
              {i18n.t("personalVocabulary.delete")}
            </Button>
          </>
        )}
      </div>
      {result.isPending && <p role="status">{i18n.t("personalVocabulary.loading")}</p>}
      {(result.error || remove.error) && (
        <p role="alert">{vocabularyError(result.error ?? remove.error)}</p>
      )}
      {detail === null && <p>{i18n.t("personalVocabulary.missingEntry")}</p>}
      {detail && (
        <>
          <section className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="flex flex-wrap items-baseline gap-x-3 text-xl">
                <EntryHeading entry={detail.entry} />
              </h2>
              {detail.entry.favorite && (
                <Badge variant="secondary">{i18n.t("personalVocabulary.fields.favorite")}</Badge>
              )}
              {detail.entry.important && (
                <Badge variant="outline">{i18n.t("personalVocabulary.fields.important")}</Badge>
              )}
            </div>
            {!!textFields.length && (
              <dl className="divide-y">
                {textFields.map(({ name, text, language }) => (
                  <div key={name} className="space-y-1 py-3 first:pt-0 last:pb-0">
                    <dt className="text-sm font-medium">
                      {i18n.t(`personalVocabulary.fields.${name}`)}
                    </dt>
                    <dd
                      lang={language}
                      className="text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap"
                    >
                      {text}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          {!!detail.contexts.length && (
            <section className="space-y-3">
              <h3 className="text-lg font-medium">{i18n.t("personalVocabulary.contexts")}</h3>
              <ul className="space-y-3">
                {detail.contexts.map((context) => (
                  <li key={context.id} className="space-y-2 rounded-lg border p-4">
                    {context.originalTerm !== detail.entry.originalTerm && (
                      <p className="text-xs wrap-anywhere text-muted-foreground">
                        {i18n.t("personalVocabulary.selectedTerm", [context.originalTerm])}
                      </p>
                    )}
                    {context.sentence && (
                      <p lang="en" className="wrap-anywhere whitespace-pre-wrap">
                        {context.sentence}
                      </p>
                    )}
                    {context.meaning && (
                      <p
                        lang={context.meaning.language}
                        className="text-sm wrap-anywhere whitespace-pre-wrap"
                      >
                        {context.meaning.text}
                      </p>
                    )}
                    {context.translation && (
                      <p
                        lang={context.translation.language}
                        className="text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground"
                      >
                        {context.translation.text}
                      </p>
                    )}
                    {context.source && (
                      <a
                        href={context.source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-sm wrap-anywhere text-primary underline"
                      >
                        {context.source.title || context.source.url}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <VocabularyContextEditor entryId={entryId} />
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="font-medium">{i18n.t("personalVocabulary.entryDetails")}</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-4 text-sm @xl:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {i18n.t("personalVocabulary.fields.originalTerm")}
                </dt>
                <dd className="wrap-anywhere">{detail.entry.originalTerm}</dd>
                {detail.entry.lemmaSource === "selection" && (
                  <dd className="text-xs text-muted-foreground">
                    {i18n.t("personalVocabulary.unconfirmedTerm")}
                  </dd>
                )}
              </div>
              {(["partOfSpeech", "difficulty", "phoneticUk", "phoneticUs"] as const).map(
                (field) =>
                  detail.entry[field] && (
                    <div key={field}>
                      <dt className="text-xs text-muted-foreground">
                        {i18n.t(`personalVocabulary.fields.${field}`)}
                      </dt>
                      <dd className="wrap-anywhere">{detail.entry[field]}</dd>
                    </div>
                  ),
              )}
              {!!membership.data?.collectionIds.length && (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {i18n.t("personalVocabulary.collections")}
                  </dt>
                  <dd className="wrap-anywhere">
                    {groups.data?.collections
                      .filter(({ id }) => membership.data.collectionIds.includes(id))
                      .map(groupLabel)
                      .join(" · ")}
                  </dd>
                </div>
              )}
              {!!membership.data?.tagIds.length && (
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {i18n.t("personalVocabulary.tags")}
                  </dt>
                  <dd className="wrap-anywhere">
                    {groups.data?.tags
                      .filter(({ id }) => membership.data.tagIds.includes(id))
                      .map(({ name }) => name)
                      .join(" · ")}
                  </dd>
                </div>
              )}
            </dl>
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              <span>{i18n.t("personalVocabulary.encounters", [detail.entry.encounterCount])}</span>
              <span>
                {i18n.t("personalVocabulary.created", [date.format(detail.entry.createdAt)])}
              </span>
              <span>
                {i18n.t("personalVocabulary.updated", [date.format(detail.entry.updatedAt)])}
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export function PersonalVocabularyPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const entryId = params.get("entry")
  return (
    <PageLayout
      title={i18n.t("personalVocabulary.title")}
      description={i18n.t("personalVocabulary.description")}
    >
      {entryId ? (
        <VocabularyDetail key={entryId} entryId={entryId} />
      ) : params.has("new") ? (
        <VocabularyEditor onCancel={() => void navigate(vocabularyPath)} />
      ) : params.has("transfer") ? (
        <VocabularyTransfer />
      ) : (
        <VocabularyList />
      )}
    </PageLayout>
  )
}
