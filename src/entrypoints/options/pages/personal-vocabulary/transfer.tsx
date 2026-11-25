import type { VocabularyBackup } from "@/utils/personal-vocabulary/backup"
import type { VocabularyConflictStrategy } from "@/utils/personal-vocabulary/records"
import type {
  VocabularyEncoding,
  VocabularyFileFormat,
  VocabularyImportSource,
  VocabularyImportSummary,
  VocabularyMapping,
} from "@/utils/personal-vocabulary/transfer"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { i18n } from "@/utils/i18n"
import { parseVocabularyBackup } from "@/utils/personal-vocabulary/backup"
import { DEFAULT_COLLECTION_ID } from "@/utils/personal-vocabulary/records"
import { vocabularyTermKey } from "@/utils/personal-vocabulary/schema"
import {
  downloadVocabularyFile,
  exportVocabularyEntries,
  IMPORT_FIELDS,
  inspectVocabularySource,
  processVocabularyImport,
} from "@/utils/personal-vocabulary/transfer"
import {
  groupLabel,
  useVocabularyGroups,
  vocabularyError,
  vocabularyPath,
  vocabularyQueryKey,
  vocabularyRepository,
  VocabularySelect,
} from "./controls"

const formats = ["txt", "csv", "json"] as const
const encodings = ["auto", "utf-8", "utf-16le", "utf-16be", "gb18030"] as const
const strategies = ["skip", "merge", "overwrite"] as const

function ConflictSelect({
  value,
  onChange,
}: {
  value: VocabularyConflictStrategy
  onChange: (value: VocabularyConflictStrategy) => void
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      {i18n.t("personalVocabulary.conflictStrategy")}
      <VocabularySelect
        value={value}
        onChange={(event) => onChange(event.target.value as VocabularyConflictStrategy)}
      >
        {strategies.map((strategy) => (
          <option value={strategy} key={strategy}>
            {i18n.t(`personalVocabulary.strategy.${strategy}`)}
          </option>
        ))}
      </VocabularySelect>
    </label>
  )
}

function previewCell(value: unknown) {
  if (typeof value === "string") return value.slice(0, 150)
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  return ""
}

function importingError(error: unknown) {
  return error instanceof SyntaxError ||
    error instanceof TypeError ||
    (error instanceof Error &&
      /json array|csv header|backup|ZodError/iu.test(`${error.name} ${error.message}`))
    ? i18n.t("personalVocabulary.errors.import")
    : vocabularyError(error)
}

function VocabularyImport() {
  const groups = useVocabularyGroups()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File>()
  const [fileInputKey, setFileInputKey] = useState(0)
  const [clipboard, setClipboard] = useState("")
  const [format, setFormat] = useState<VocabularyFileFormat>("txt")
  const [encoding, setEncoding] = useState<VocabularyEncoding>("auto")
  const [header, setHeader] = useState(true)
  const [strategy, setStrategy] = useState<VocabularyConflictStrategy>("skip")
  const [collection, setCollection] = useState(DEFAULT_COLLECTION_ID)
  const [language, setLanguage] = useState("zh-CN")
  const [inspected, setInspected] = useState<Awaited<ReturnType<typeof inspectVocabularySource>>>()
  const [mapping, setMapping] = useState<VocabularyMapping>({})
  const [checked, setChecked] = useState(false)
  const [summary, setSummary] = useState<VocabularyImportSummary>()
  const [stage, setStage] = useState<"read" | "check" | "write">()
  const [feedback, setFeedback] = useState<string>()
  const active = useRef<AbortController>(null)
  const hasInput = !!file || !!clipboard.trim()

  useEffect(() => () => active.current?.abort(), [])

  function reset() {
    setInspected(undefined)
    setSummary(undefined)
    setFeedback(undefined)
    setChecked(false)
  }

  function getSource(): VocabularyImportSource {
    return file
      ? { file, format, encoding, header }
      : {
          file: new Blob([clipboard], { type: "text/plain" }),
          format,
          encoding: "utf-8",
          header,
        }
  }

  async function inspect() {
    setStage("read")
    reset()
    try {
      const result = await inspectVocabularySource(getSource())
      setMapping(result.mapping)
      setInspected(result)
      if (!result.columns.length) setFeedback(i18n.t("personalVocabulary.emptyImport"))
    } catch (error) {
      setFeedback(importingError(error))
    } finally {
      setStage(undefined)
    }
  }

  async function process(write: boolean) {
    if (!mapping.term || (write && !checked) || active.current) return
    if (
      write &&
      strategy === "overwrite" &&
      !window.confirm(i18n.t("personalVocabulary.confirmOverwrite"))
    )
      return
    setSummary(undefined)
    setFeedback(undefined)
    setStage(write ? "write" : "check")
    const request = new AbortController()
    active.current = request
    try {
      const result = await processVocabularyImport({
        repository: vocabularyRepository,
        source: getSource(),
        mapping,
        language: language.trim(),
        destination: write ? { strategy, collectionId: collection } : undefined,
        onProgress: setSummary,
        signal: request.signal,
      })
      setSummary(result)
      if (!write) setChecked(true)
      if (write) setFeedback(i18n.t("personalVocabulary.importComplete"))
    } catch (error) {
      setFeedback(
        request.signal.aborted
          ? i18n.t("personalVocabulary.importCanceled")
          : importingError(error),
      )
    } finally {
      active.current = null
      if (write) {
        setChecked(false)
        await queryClient.invalidateQueries({ queryKey: vocabularyQueryKey })
      }
      setStage(undefined)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="text-lg font-medium">{i18n.t("personalVocabulary.importEntries")}</h2>
      <fieldset disabled={!!stage} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            {i18n.t("personalVocabulary.chooseFile")}
            <Input
              key={fileInputKey}
              type="file"
              accept=".txt,.csv,.json"
              onChange={(event) => {
                const next = event.target.files?.[0]
                setFile(next)
                if (next) {
                  setClipboard("")
                  const extension = next.name.split(".").at(-1)?.toLowerCase()
                  if (extension === "csv" || extension === "json" || extension === "txt")
                    setFormat(extension)
                }
                reset()
              }}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            {i18n.t("personalVocabulary.fileFormat")}
            <VocabularySelect
              value={format}
              onChange={(event) => {
                setFormat(event.target.value as VocabularyFileFormat)
                reset()
              }}
            >
              {formats.map((item) => (
                <option key={item} value={item}>
                  {item.toUpperCase()}
                </option>
              ))}
            </VocabularySelect>
          </label>
          <label className="grid gap-1.5 text-sm">
            {i18n.t("personalVocabulary.encoding")}
            <VocabularySelect
              value={encoding}
              disabled={!file}
              onChange={(event) => {
                setEncoding(event.target.value as VocabularyEncoding)
                reset()
              }}
            >
              {encodings.map((item) => (
                <option key={item} value={item}>
                  {item === "auto" ? i18n.t("personalVocabulary.autoEncoding") : item.toUpperCase()}
                </option>
              ))}
            </VocabularySelect>
          </label>
          <label className="grid gap-1.5 text-sm">
            {i18n.t("personalVocabulary.fields.definitionLanguage")}
            <Input
              value={language}
              maxLength={35}
              onChange={(event) => {
                setLanguage(event.target.value)
                setChecked(false)
                setSummary(undefined)
              }}
            />
          </label>
        </div>
        {format === "csv" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={header}
              onChange={(event) => {
                setHeader(event.target.checked)
                reset()
              }}
            />
            {i18n.t("personalVocabulary.csvHeader")}
          </label>
        )}
        <label className="grid gap-1.5 text-sm">
          {i18n.t("personalVocabulary.pasteText")}
          <Textarea
            disabled={!!file}
            value={clipboard}
            onChange={(event) => {
              setClipboard(event.target.value)
              reset()
            }}
            placeholder={i18n.t("personalVocabulary.importHint")}
          />
        </label>
        {file && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFile(undefined)
              setFileInputKey((key) => key + 1)
              reset()
            }}
          >
            {i18n.t("personalVocabulary.clearFile")}
          </Button>
        )}
        <div>
          <Button size="sm" disabled={!hasInput} onClick={() => void inspect()}>
            {i18n.t("personalVocabulary.previewImport")}
          </Button>
        </div>
        {inspected && !!inspected.columns.length && (
          <>
            <div className="overflow-auto rounded-md border">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    {inspected.columns.map(({ key, label }, index) => (
                      <th className="px-2 py-1 text-left" key={key}>
                        {label || `#${index + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inspected.rows.map(({ position, row }) => (
                    <tr key={position} className="border-t">
                      {inspected.columns.map(({ key }) => (
                        <td key={key} className="max-w-44 truncate px-2 py-1">
                          {previewCell(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details open={!mapping.term} className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {i18n.t("personalVocabulary.fieldMapping")}
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {IMPORT_FIELDS.map((field) => (
                  <label key={field} className="grid gap-1 text-sm">
                    {i18n.t(`personalVocabulary.fields.${field}`)}
                    <VocabularySelect
                      value={mapping[field] ?? ""}
                      onChange={(event) => {
                        setMapping({ ...mapping, [field]: event.target.value || undefined })
                        setChecked(false)
                        setSummary(undefined)
                      }}
                    >
                      <option value="">{i18n.t("personalVocabulary.emptyValue")}</option>
                      {inspected.columns.map(({ key, label }, index) => (
                        <option value={key} key={key}>
                          {label || `#${index + 1}`}
                        </option>
                      ))}
                    </VocabularySelect>
                  </label>
                ))}
              </div>
            </details>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                {i18n.t("personalVocabulary.targetCollection")}
                <VocabularySelect
                  value={collection}
                  onChange={(event) => setCollection(event.target.value)}
                >
                  {groups.data?.collections.map((group) => (
                    <option value={group.id} key={group.id}>
                      {groupLabel(group)}
                    </option>
                  ))}
                </VocabularySelect>
              </label>
              <ConflictSelect value={strategy} onChange={setStrategy} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!mapping.term}
                onClick={() => void process(false)}
              >
                {i18n.t("personalVocabulary.checkImport")}
              </Button>
              <Button
                size="sm"
                disabled={!checked || !summary?.valid}
                onClick={() => void process(true)}
              >
                {i18n.t("personalVocabulary.runImport")}
              </Button>
            </div>
          </>
        )}
      </fieldset>
      {stage && (
        <p role="status" className="text-sm">
          {i18n.t("personalVocabulary.processing")}
        </p>
      )}
      {(stage === "check" || stage === "write") && (
        <Button size="sm" variant="outline" onClick={() => active.current?.abort()}>
          {i18n.t("personalVocabulary.cancel")}
        </Button>
      )}
      {summary && (
        <p role="status" className="text-sm">
          {i18n.t("personalVocabulary.importStats", [
            summary.valid,
            summary.duplicates,
            summary.invalid,
            summary.written,
            summary.failed,
          ])}
        </p>
      )}
      {feedback && (
        <p className="text-sm" role="status">
          {feedback}
        </p>
      )}
    </section>
  )
}

function VocabularyExport() {
  const exportFile = useMutation({
    mutationFn: async (format: VocabularyFileFormat) => {
      const blob = await exportVocabularyEntries(vocabularyRepository, format)
      downloadVocabularyFile(blob, `read-frog-vocabulary.${format}`)
    },
  })
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-lg font-medium">{i18n.t("personalVocabulary.exportEntries")}</h2>
      <div className="flex flex-wrap gap-2">
        {formats.map((format) => (
          <Button
            key={format}
            variant="outline"
            size="sm"
            disabled={exportFile.isPending}
            onClick={() => exportFile.mutate(format)}
          >
            {format.toUpperCase()}
          </Button>
        ))}
      </div>
      {exportFile.isPending && (
        <p role="status" className="text-sm">
          {i18n.t("personalVocabulary.processing")}
        </p>
      )}
      {exportFile.error && (
        <p role="alert" className="text-sm text-destructive">
          {vocabularyError(exportFile.error)}
        </p>
      )}
    </section>
  )
}

function VocabularyBackupPanel() {
  const queryClient = useQueryClient()
  const [backup, setBackup] = useState<{ document: VocabularyBackup; duplicates: number }>()
  const [strategy, setStrategy] = useState<VocabularyConflictStrategy>("merge")
  const action = useMutation({
    mutationFn: async (request: { preview: File } | "export" | "restore") => {
      if (request === "export") {
        const current = await vocabularyRepository.createBackup()
        downloadVocabularyFile(
          new Blob([JSON.stringify(current)], { type: "application/json" }),
          `read-frog-vocabulary-backup-${new Date().toISOString().slice(0, 10)}.json`,
        )
      } else if (request === "restore" && backup) {
        const result = await vocabularyRepository.restoreBackup(backup.document, strategy)
        await queryClient.invalidateQueries({ queryKey: vocabularyQueryKey })
        return result
      } else if (typeof request === "object") {
        const document = parseVocabularyBackup(JSON.parse(await request.preview.text()))
        let duplicates = 0
        for (let index = 0; index < document.entries.length; index += 500) {
          const keys = document.entries
            .slice(index, index + 500)
            .map(({ term }) => vocabularyTermKey(term))
          duplicates += (await vocabularyRepository.existingTermKeys(keys)).size
        }
        setBackup({ document, duplicates })
      }
      return undefined
    },
  })

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-lg font-medium">{i18n.t("personalVocabulary.backup")}</h2>
      <Button
        variant="outline"
        size="sm"
        disabled={action.isPending}
        onClick={() => action.mutate("export")}
      >
        {i18n.t("personalVocabulary.createBackup")}
      </Button>
      <label className="grid gap-1.5 text-sm">
        {i18n.t("personalVocabulary.restore")}
        <Input
          type="file"
          accept=".json,application/json"
          disabled={action.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0]
            setBackup(undefined)
            action.reset()
            if (file) action.mutate({ preview: file })
          }}
        />
      </label>
      {backup && (
        <>
          <p className="text-sm">
            {i18n.t("personalVocabulary.backupStats", [
              backup.document.version,
              backup.document.entries.length,
              backup.document.collections.length,
              backup.document.tags.length,
              backup.document.contexts.length,
              backup.duplicates,
            ])}
          </p>
          <p className="text-sm text-muted-foreground">
            {i18n.t("personalVocabulary.restoreBehavior")}
          </p>
          <ConflictSelect value={strategy} onChange={setStrategy} />
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() => {
              const key =
                strategy === "overwrite"
                  ? "personalVocabulary.confirmOverwrite"
                  : "personalVocabulary.confirmRestore"
              if (window.confirm(i18n.t(key))) action.mutate("restore")
            }}
          >
            {i18n.t("personalVocabulary.confirmRestore")}
          </Button>
        </>
      )}
      {action.data && (
        <p role="status" className="text-sm">
          {i18n.t("personalVocabulary.restoreComplete", [
            action.data.written,
            action.data.duplicates,
          ])}
        </p>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {importingError(action.error)}
        </p>
      )}
      {action.isPending && (
        <p role="status" className="text-sm">
          {i18n.t("personalVocabulary.processing")}
        </p>
      )}
    </section>
  )
}

export function VocabularyTransfer() {
  return (
    <div className="space-y-4">
      <Button variant="outline" render={<Link to={vocabularyPath} />}>
        {i18n.t("personalVocabulary.back")}
      </Button>
      <VocabularyImport />
      <VocabularyExport />
      <VocabularyBackupPanel />
    </div>
  )
}
