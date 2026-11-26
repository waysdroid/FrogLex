import type { VocabularyConflictStrategy, VocabularyEntry } from "./records"
import type { PersonalVocabularyRepository } from "./repository"
import type { VocabularyImportItem } from "./schema"
import { vocabularyImportSchema, vocabularyTermKey } from "./schema"

export type VocabularyFileFormat = "txt" | "csv" | "json"
export type VocabularyEncoding = "auto" | "utf-8" | "utf-16le" | "utf-16be" | "gb18030"
export type VocabularyImportSource = {
  file: Blob
  format: VocabularyFileFormat
  encoding: VocabularyEncoding
  header: boolean
}

export const IMPORT_FIELDS = [
  "term",
  "originalTerm",
  "definition",
  "definitionLanguage",
  "meaningsZh",
  "meaningsEn",
  "phonetic",
  "phoneticUk",
  "phoneticUs",
  "partOfSpeech",
  "difficulty",
  "note",
  "memoryTips",
  "examples",
  "collocations",
  "synonyms",
  "antonyms",
  "derivatives",
  "favorite",
  "important",
  "sentence",
  "sentenceTranslation",
  "contextMeaning",
  "sourceTitle",
  "sourceUrl",
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
export type VocabularyMapping = Partial<Record<ImportField, string>>
type RawRow = Record<string, unknown>
const BATCH_SIZE = 100

export async function detectVocabularyEncoding(
  file: Blob,
): Promise<Exclude<VocabularyEncoding, "auto">> {
  const sample = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
  if (sample[0] === 255 && sample[1] === 254) return "utf-16le"
  if (sample[0] === 254 && sample[1] === 255) return "utf-16be"
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: sample.length < file.size })
    return "utf-8"
  } catch {
    return "gb18030"
  }
}

async function* textChunks(source: VocabularyImportSource) {
  const encoding =
    source.encoding === "auto" ? await detectVocabularyEncoding(source.file) : source.encoding
  const decoder = new TextDecoder(encoding, { fatal: true })
  const reader = source.file.stream().getReader()
  try {
    for (let current = await reader.read(); !current.done; current = await reader.read()) {
      yield decoder.decode(current.value, { stream: true })
    }
    yield decoder.decode()
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

async function* delimitedRows(source: VocabularyImportSource) {
  const separator = source.format === "csv" ? "," : "\t"
  const quoting = source.format === "csv"
  let field = ""
  let row: string[] = []
  let state: "plain" | "quoted" | "quote" = "plain"
  let skipLf = false
  let dirty = false
  let invalid = false

  function finishField() {
    row.push(field)
    field = ""
    state = "plain"
  }

  function finishRow() {
    finishField()
    const result = invalid ? null : row
    row = []
    dirty = false
    invalid = false
    return result
  }

  for await (const chunk of textChunks(source)) {
    for (const char of chunk) {
      if (skipLf) {
        skipLf = false
        if (char === "\n") continue
      }
      dirty = true
      if (state === "quoted") {
        if (char === '"') state = "quote"
        else field += char
        continue
      }
      if (state === "quote" && char === '"') {
        field += char
        state = "quoted"
        continue
      }
      if (char === separator) finishField()
      else if (char === "\r" || char === "\n") {
        skipLf = char === "\r"
        yield finishRow()
      } else if (quoting && char === '"' && !field && state === "plain") {
        state = "quoted"
      } else if (state === "quote" || (quoting && char === '"')) {
        invalid = true
      } else {
        field += char
      }
    }
  }
  if (dirty) {
    if (state === "quoted") invalid = true
    yield finishRow()
  }
}

async function* jsonArrayRows(source: VocabularyImportSource) {
  let opened = false
  let closed = false
  let afterComma = false
  let depth = 0
  let quoted = false
  let escaped = false
  let record = ""
  for await (const chunk of textChunks(source)) {
    for (const char of chunk) {
      if (!opened) {
        if (/\s/u.test(char)) continue
        if (char !== "[") throw new Error("Expected a JSON array")
        opened = true
        continue
      }
      if (closed) {
        if (!/\s/u.test(char)) throw new Error("Unexpected text after the JSON array")
        continue
      }
      if (!quoted && depth === 0 && (char === "," || char === "]")) {
        if (record.trim()) yield JSON.parse(record) as unknown
        else if (char === "," || afterComma) throw new Error("Missing item in JSON array")
        closed = char === "]"
        afterComma = char === ","
        record = ""
        continue
      }
      record += char
      if (quoted) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === "{" || char === "[") depth++
      else if (char === "}" || char === "]") {
        if (depth === 0) throw new Error("Unexpected closing token in JSON array")
        depth--
      }
    }
  }
  if (!closed) throw new Error("Incomplete JSON array")
}

async function* rawRows(source: VocabularyImportSource) {
  if (source.format === "json") {
    for await (const row of jsonArrayRows(source)) {
      if (typeof row === "string") yield { term: row }
      else if (typeof row === "object" && row !== null && !Array.isArray(row)) yield row as RawRow
      else yield null
    }
    return
  }
  for await (const cells of delimitedRows(source)) {
    if (!cells) yield null
    else if (cells.some((cell) => cell.trim())) {
      yield Object.fromEntries(cells.map((cell, index) => [String(index), cell]))
    }
  }
}

async function* dataRows(source: VocabularyImportSource) {
  let skipHeader = source.format === "csv" && source.header
  for await (const row of rawRows(source)) {
    if (skipHeader) {
      if (!row) throw new Error("Malformed CSV header")
      skipHeader = false
    } else {
      yield row
    }
  }
}

const aliases: Record<string, ImportField> = {
  word: "term",
  lemma: "term",
  单词: "term",
  词条: "term",
  原形: "term",
  原始词形: "originalTerm",
  meaning: "definition",
  translation: "definition",
  释义: "definition",
  中文释义: "meaningsZh",
  英文释义: "meaningsEn",
  笔记: "note",
  记忆技巧: "memoryTips",
  example: "sentence",
  原句: "sentence",
  来源: "sourceUrl",
  url: "sourceUrl",
}

export async function inspectVocabularySource(source: VocabularyImportSource) {
  const columns = new Map<string, string>()
  const rows: { position: number; row: RawRow }[] = []
  let position = 0
  let isHeader = source.format === "csv" && source.header
  for await (const row of rawRows(source)) {
    position++
    if (!row) {
      if (isHeader) throw new Error("Malformed CSV header")
      continue
    }
    for (const key of Object.keys(row)) {
      if (!columns.has(key)) columns.set(key, isHeader ? String(row[key]) : key)
    }
    if (isHeader) isHeader = false
    else rows.push({ position, row })
    if (rows.length >= 6) break
  }
  const mapping: VocabularyMapping = {}
  for (const [key, label] of columns) {
    const externalName = label.trim().toLowerCase()
    const field =
      IMPORT_FIELDS.find((candidate) => candidate.toLowerCase() === externalName) ??
      (Object.hasOwn(aliases, externalName) ? aliases[externalName] : undefined)
    if (field && mapping[field] === undefined) mapping[field] = key
  }
  const firstColumn = columns.keys().next().value
  if (source.format !== "json" && mapping.term === undefined) mapping.term = firstColumn
  if (source.format === "txt" && columns.has("1")) mapping.definition = "1"
  return { columns: [...columns].map(([key, label]) => ({ key, label })), rows, mapping }
}

function mapRow(row: RawRow | null, mapping: VocabularyMapping, language: string) {
  if (!row) return null
  function text(field: ImportField) {
    const key = mapping[field]
    if (key === undefined || !Object.hasOwn(row!, key)) return undefined
    const value = row![key]
    return typeof value === "string" ? value.trim() || undefined : undefined
  }
  function marker(field: "favorite" | "important") {
    const key = mapping[field]
    const value = key === undefined ? undefined : row![key]
    if (typeof value === "boolean") return value
    const normalized = text(field)?.toLowerCase()
    if (normalized === "true" || normalized === "1") return true
    if (normalized === "false" || normalized === "0") return false
    return undefined
  }

  const definition = text("definition")
  const definitionLanguage = text("definitionLanguage") ?? language
  const sentence = text("sentence")
  const translation = text("sentenceTranslation")
  const meaning = text("contextMeaning")
  const sourceUrl = text("sourceUrl")
  const result = vocabularyImportSchema.safeParse({
    term: text("term"),
    originalTerm: text("originalTerm"),
    meaningsZh: text("meaningsZh"),
    meaningsEn: text("meaningsEn"),
    phonetic: text("phonetic"),
    phoneticUk: text("phoneticUk"),
    phoneticUs: text("phoneticUs"),
    partOfSpeech: text("partOfSpeech"),
    difficulty: text("difficulty")?.toUpperCase(),
    note: text("note"),
    memoryTips: text("memoryTips"),
    examples: text("examples"),
    collocations: text("collocations"),
    synonyms: text("synonyms"),
    antonyms: text("antonyms"),
    derivatives: text("derivatives"),
    favorite: marker("favorite"),
    important: marker("important"),
    definition: definition ? { text: definition, language: definitionLanguage } : undefined,
    context:
      sentence || sourceUrl
        ? {
            sentence,
            translation: translation
              ? { text: translation, language: definitionLanguage }
              : undefined,
            meaning: meaning ? { text: meaning, language: definitionLanguage } : undefined,
            source: sourceUrl ? { url: sourceUrl, title: text("sourceTitle") } : undefined,
          }
        : undefined,
  })
  return result.success ? result.data : null
}

export type VocabularyImportSummary = {
  written: number
  valid: number
  invalid: number
  duplicates: number
  failed: number
}

/** Preview and import use the same parser and mapping and only retain one write batch. */
export async function processVocabularyImport({
  repository,
  source,
  mapping,
  language,
  destination,
  onProgress,
  signal,
}: {
  repository: PersonalVocabularyRepository
  source: VocabularyImportSource
  mapping: VocabularyMapping
  language: string
  destination?: { strategy: VocabularyConflictStrategy; collectionId: string }
  onProgress: (summary: VocabularyImportSummary) => void
  signal: AbortSignal
}) {
  const summary = { written: 0, valid: 0, invalid: 0, duplicates: 0, failed: 0 }
  const seen = new Set<string>()
  let pending: VocabularyImportItem[] = []
  let processed = 0
  async function flush() {
    signal.throwIfAborted()
    if (pending.length === 0) return
    if (destination) {
      try {
        const counts = await repository.importEntries(
          pending,
          destination.strategy,
          destination.collectionId,
        )
        summary.written += counts.written
        summary.invalid += counts.invalid
        summary.duplicates += counts.duplicates
      } catch (error) {
        summary.failed += pending.length
        onProgress({ ...summary })
        throw error
      }
    } else {
      const keys = pending.map(({ term }) => vocabularyTermKey(term))
      const existing = await repository.existingTermKeys(keys)
      for (const key of keys) {
        if (existing.has(key) || seen.has(key)) summary.duplicates++
        seen.add(key)
      }
    }
    pending = []
    onProgress({ ...summary })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  for await (const raw of dataRows(source)) {
    signal.throwIfAborted()
    const item = mapRow(raw, mapping, language)
    if (!item) summary.invalid++
    else {
      summary.valid++
      pending.push(item)
    }
    processed++
    if (processed % BATCH_SIZE === 0) {
      if (pending.length) await flush()
      else {
        onProgress({ ...summary })
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
  }
  await flush()
  onProgress({ ...summary })
  return summary
}

function portableEntry(entry: VocabularyEntry) {
  return {
    term: entry.term,
    originalTerm: entry.originalTerm,
    definition: entry.definition?.text,
    definitionLanguage: entry.definition?.language,
    meaningsZh: entry.meaningsZh,
    meaningsEn: entry.meaningsEn,
    phonetic: entry.phonetic,
    phoneticUk: entry.phoneticUk,
    phoneticUs: entry.phoneticUs,
    partOfSpeech: entry.partOfSpeech,
    difficulty: entry.difficulty,
    note: entry.note,
    memoryTips: entry.memoryTips,
    examples: entry.examples,
    collocations: entry.collocations,
    synonyms: entry.synonyms,
    antonyms: entry.antonyms,
    derivatives: entry.derivatives,
    favorite: entry.favorite,
    important: entry.important,
  }
}

function csvCell(value: string) {
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export async function exportVocabularyEntries(
  repository: PersonalVocabularyRepository,
  format: VocabularyFileFormat,
) {
  const chunks: string[] = []
  const fields = IMPORT_FIELDS.slice(0, IMPORT_FIELDS.indexOf("sentence"))
  if (format === "csv") chunks.push(`\uFEFF${fields.join(",")}\r\n`)
  if (format === "json") chunks.push("[")
  let hasEntry = false
  for await (const entry of repository.exportEntries()) {
    const row = portableEntry(entry)
    if (format === "json") chunks.push(hasEntry ? ",\n" : "\n", JSON.stringify(row))
    else if (format === "csv") {
      chunks.push(
        fields.map((field) => csvCell(String(row[field as keyof typeof row] ?? ""))).join(","),
        "\r\n",
      )
    } else chunks.push(entry.term, "\n")
    hasEntry = true
  }
  if (format === "json") chunks.push("\n]\n")
  const mime = { csv: "text/csv", txt: "text/plain", json: "application/json" }[format]
  return new Blob(chunks, { type: `${mime};charset=utf-8` })
}

export function downloadVocabularyFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file)
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
