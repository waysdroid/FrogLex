import type { VocabularyCursor, VocabularyEntry } from "@/utils/personal-vocabulary/repository"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Link, useSearchParams } from "react-router"
import { Button } from "@/components/ui/base-ui/button"
import { getUiLocale, i18n } from "@/utils/i18n"
import { personalVocabularyRepository } from "@/utils/personal-vocabulary/repository"
import { PageLayout } from "../../components/page-layout"

const VOCABULARY_PATH = "/personal-vocabulary"

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(getUiLocale(), { dateStyle: "medium" }).format(timestamp)
}

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
  const [cursors, setCursors] = useState<VocabularyCursor[]>([])
  const cursor = cursors.at(-1)
  const result = useQuery({
    queryKey: ["personal-vocabulary", "list", cursor ?? null],
    queryFn: () => personalVocabularyRepository.listEntries(cursor),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
  if (result.isPending) return <p role="status">{i18n.t("personalVocabulary.loading")}</p>
  if (result.isError) {
    return (
      <div className="space-y-2">
        <p role="alert">{i18n.t("personalVocabulary.errors.storage")}</p>
        <Button variant="outline" onClick={() => void result.refetch()}>
          {i18n.t("personalVocabulary.retry")}
        </Button>
      </div>
    )
  }

  const { entries, nextCursor, total } = result.data
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{i18n.t("personalVocabulary.defaultCollection")}</h2>
        <p className="text-sm text-muted-foreground">
          {i18n.t("personalVocabulary.entryCount", [total])}
        </p>
      </div>
      {total === 0 ? (
        <p className="rounded-lg border bg-muted/25 p-5 text-sm text-muted-foreground">
          {i18n.t("personalVocabulary.empty")}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                to={`?entry=${entry.id}`}
                className="grid gap-1 px-4 py-3 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <EntryHeading entry={entry} />
                </div>
                {entry.definition && (
                  <span
                    lang={entry.definition.language}
                    className="line-clamp-2 text-sm text-muted-foreground"
                  >
                    {entry.definition.text}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {i18n.t("personalVocabulary.encounters", [entry.encounterCount])}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(cursors.length > 0 || nextCursor) && (
        <nav
          aria-label={i18n.t("personalVocabulary.pagination")}
          className="flex items-center justify-end gap-2"
        >
          <Button
            size="sm"
            variant="outline"
            disabled={cursors.length === 0}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            {i18n.t("personalVocabulary.previous")}
          </Button>
          <span className="text-sm tabular-nums">{cursors.length + 1}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={!nextCursor}
            onClick={() => {
              if (nextCursor) setCursors([...cursors, nextCursor])
            }}
          >
            {i18n.t("personalVocabulary.next")}
          </Button>
        </nav>
      )}
    </section>
  )
}

function VocabularyDetail({ entryId }: { entryId: string }) {
  const result = useQuery({
    queryKey: ["personal-vocabulary", "detail", entryId],
    queryFn: () => personalVocabularyRepository.getEntryDetail(entryId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  const detail = result.data
  return (
    <section className="space-y-5">
      <Button variant="outline" render={<Link to={VOCABULARY_PATH} />}>
        {i18n.t("personalVocabulary.back")}
      </Button>
      {result.isPending && <p role="status">{i18n.t("personalVocabulary.loading")}</p>}
      {result.isError && <p role="alert">{i18n.t("personalVocabulary.errors.storage")}</p>}
      {detail === null && <p>{i18n.t("personalVocabulary.missingEntry")}</p>}
      {detail && (
        <>
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="flex flex-wrap items-baseline gap-x-3 text-xl">
              <EntryHeading entry={detail.entry} />
            </h2>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {detail.entry.partOfSpeech && <span>{detail.entry.partOfSpeech}</span>}
              {detail.entry.difficulty && <span>{detail.entry.difficulty}</span>}
              <span>{i18n.t("personalVocabulary.encounters", [detail.entry.encounterCount])}</span>
              <span>
                {i18n.t("personalVocabulary.updated", [formatDate(detail.entry.updatedAt)])}
              </span>
            </div>
            <p className="text-sm wrap-anywhere">
              {i18n.t("personalVocabulary.selectedTerm", [detail.entry.originalTerm])}
            </p>
            {detail.entry.lemmaSource === "selection" && (
              <p className="text-sm text-muted-foreground">
                {i18n.t("personalVocabulary.unconfirmedTerm")}
              </p>
            )}
            {detail.entry.definition && (
              <p
                lang={detail.entry.definition.language}
                className="wrap-anywhere whitespace-pre-wrap"
              >
                {detail.entry.definition.text}
              </p>
            )}
          </div>
          {detail.contexts.length > 0 && (
            <div className="space-y-3">
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
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function PersonalVocabularyPage() {
  const [params] = useSearchParams()
  const entryId = params.get("entry")

  return (
    <PageLayout
      title={i18n.t("personalVocabulary.title")}
      description={i18n.t("personalVocabulary.description")}
    >
      {entryId ? <VocabularyDetail entryId={entryId} /> : <VocabularyList />}
    </PageLayout>
  )
}
