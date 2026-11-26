import type { Chunks } from "./client"
import type { VocabularyBackup } from "@/utils/personal-vocabulary/backup"
import { sha256 } from "js-sha256"
import { parseVocabularyBackup } from "@/utils/personal-vocabulary/backup"
import { comparableVocabularyText, vocabularyTermKey } from "@/utils/personal-vocabulary/schema"
import { mergeRows, mergeValue } from "./merge"
import { SyncError } from "./types"

const rowsById = (row: { id: string }) => row.id
const formKey = (row: VocabularyBackup["forms"][number]) =>
  JSON.stringify([row.originalKey, row.entryId])
const collectionKey = (row: VocabularyBackup["entryCollections"][number]) =>
  JSON.stringify([row.entryId, row.collectionId])
const tagKey = (row: VocabularyBackup["entryTags"][number]) =>
  JSON.stringify([row.entryId, row.tagId])
const groupKey = (row: VocabularyBackup["tags"][number]) =>
  comparableVocabularyText(row.name).toLowerCase()
const contextKey = (row: VocabularyBackup["contexts"][number]) =>
  JSON.stringify([row.entryId, row.source?.url ?? "", comparableVocabularyText(row.sentence ?? "")])

const emptyVocabulary: VocabularyBackup = {
  format: "read-frog-personal-vocabulary",
  version: 1,
  exportedAt: 0,
  entries: [],
  contexts: [],
  encounters: [],
  forms: [],
  collections: [],
  tags: [],
  entryCollections: [],
  entryTags: [],
}

const tableKeys = {
  entries: rowsById,
  contexts: rowsById,
  encounters: rowsById,
  forms: formKey,
  collections: rowsById,
  tags: rowsById,
  entryCollections: collectionKey,
  entryTags: tagKey,
}
type TableName = keyof typeof tableKeys
const tableNames = Object.keys(tableKeys) as TableName[]

function stableRows<T>(rows: T[], key: (row: T) => string) {
  return [...rows].sort((left, right) => {
    const a = key(left)
    const b = key(right)
    return a < b ? -1 : a > b ? 1 : 0
  })
}

export function packVocabulary(data: VocabularyBackup): Chunks {
  const buckets = new Map<string, [TableName, unknown][]>()
  function add<T>(table: TableName, rows: T[], key: (row: T) => string) {
    for (const row of stableRows(rows, key)) {
      const name = (Number.parseInt(sha256(`${table}:${key(row)}`).slice(0, 2), 16) % 32)
        .toString(16)
        .padStart(2, "0")
      const bucket = buckets.get(name) ?? []
      bucket.push([table, row])
      buckets.set(name, bucket)
    }
  }
  add("entries", data.entries, rowsById)
  add("contexts", data.contexts, rowsById)
  add("encounters", data.encounters, rowsById)
  add("forms", data.forms, formKey)
  add("collections", data.collections, rowsById)
  add("tags", data.tags, rowsById)
  add("entryCollections", data.entryCollections, collectionKey)
  add("entryTags", data.entryTags, tagKey)
  return new Map([...buckets].map(([name, rows]) => [name, JSON.stringify(rows)]))
}

export function unpackVocabulary(chunks: Chunks) {
  try {
    const data = { ...emptyVocabulary }
    for (const name of tableNames) data[name] = []
    for (const body of chunks.values()) {
      const rows: unknown = JSON.parse(body)
      if (!Array.isArray(rows)) throw new SyncError("invalid")
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 2 || !Object.hasOwn(tableKeys, row[0])) {
          throw new SyncError("invalid")
        }
        data[row[0] as TableName].push(row[1] as never)
      }
    }
    const parsed = parseVocabularyBackup(data)
    if (
      unique(parsed.forms, formKey).length !== parsed.forms.length ||
      unique(parsed.entryCollections, collectionKey).length !== parsed.entryCollections.length ||
      unique(parsed.entryTags, tagKey).length !== parsed.entryTags.length ||
      unique(parsed.contexts, contextKey).length !== parsed.contexts.length
    ) {
      throw new SyncError("invalid")
    }
    const canonical = packVocabulary(parsed)
    if (
      canonical.size !== chunks.size ||
      [...canonical].some(([key, value]) => chunks.get(key) !== value)
    ) {
      throw new SyncError("invalid")
    }
    return parsed
  } catch {
    throw new SyncError("invalid")
  }
}

function deduplicate<T extends { id: string; createdAt: number }>(
  rows: T[],
  baseRows: T[],
  key: (row: T) => string,
  combine: (current: T, duplicate: T) => T,
) {
  const ids = new Map<string, string>()
  const baseline = new Set(baseRows.map(rowsById))
  const byKey = new Map<string, T>()
  for (const row of [...rows].sort(
    (a, b) => Number(baseline.has(b.id)) - Number(baseline.has(a.id)),
  )) {
    const identity = key(row)
    const current = byKey.get(identity)
    if (!current) {
      byKey.set(identity, row)
      continue
    }
    ids.set(row.id, current.id)
    byKey.set(identity, combine(current, row))
  }
  return { rows: [...byKey.values()], ids }
}

function unique<T>(items: T[], key: (row: T) => string) {
  return [...new Map(items.map((row) => [key(row), row])).values()]
}

function mergeEntry(
  base: VocabularyBackup["entries"][number] | undefined,
  local: VocabularyBackup["entries"][number] | undefined,
  remote: VocabularyBackup["entries"][number] | undefined,
) {
  if (!local || !remote) {
    if (!base) return local ?? remote
    const edited = local ?? remote
    if (!edited) return undefined
    // A deletion competes with an actual edit, including a new encounter.
    return mergeValue(base, local, remote) as typeof local
  }
  const ignoreActivity = (row: typeof base) => row && { ...row, updatedAt: 0, encounterCount: 0 }
  const fields = mergeValue(
    ignoreActivity(base),
    ignoreActivity(local),
    ignoreActivity(remote),
  ) as NonNullable<typeof local>
  return {
    ...fields,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    encounterCount: Math.max(local.encounterCount, remote.encounterCount),
  }
}

export function mergeVocabulary(
  baseline: VocabularyBackup | undefined,
  local: VocabularyBackup,
  remote: VocabularyBackup,
) {
  const base = baseline ?? emptyVocabulary
  const mergedEntries = mergeRows(base.entries, local.entries, remote.entries, rowsById, mergeEntry)
  const entries = deduplicate(
    mergedEntries,
    base.entries,
    ({ term }) => vocabularyTermKey(term),
    (a, b) => {
      const [older, newer] = a.updatedAt > b.updatedAt ? [b, a] : [a, b]
      return {
        ...older,
        ...Object.fromEntries(Object.entries(newer).filter(([, value]) => value !== undefined)),
        id: a.id,
        createdAt: Math.min(a.createdAt, b.createdAt),
      }
    },
  )
  function groups(table: "collections" | "tags") {
    const mergeGroup = (
      before: VocabularyBackup[typeof table][number] | undefined,
      a: VocabularyBackup[typeof table][number] | undefined,
      b: VocabularyBackup[typeof table][number] | undefined,
    ) => {
      if (a?.id === "default" && b?.id === "default") return a.createdAt < b.createdAt ? a : b
      return mergeValue(before, a, b) as typeof a
    }
    return deduplicate(
      mergeRows(base[table], local[table], remote[table], rowsById, mergeGroup),
      base[table],
      groupKey,
      (a) => a,
    )
  }
  const collections = groups("collections")
  const tags = groups("tags")
  const entryIds = new Set(entries.rows.map(rowsById))
  const collectionIds = new Set(collections.rows.map(rowsById))
  const tagIds = new Set(tags.rows.map(rowsById))
  const entryRef = <T extends { entryId: string }>(row: T) => ({
    ...row,
    entryId: entries.ids.get(row.entryId) ?? row.entryId,
  })
  const belongsToEntry = ({ entryId }: { entryId: string }) => entryIds.has(entryId)
  const contexts = deduplicate(
    mergeRows(base.contexts, local.contexts, remote.contexts, rowsById)
      .map(entryRef)
      .filter(belongsToEntry),
    base.contexts,
    contextKey,
    (a, b) => ({
      ...a,
      meaning: a.meaning ?? b.meaning,
      translation: a.translation ?? b.translation,
    }),
  )
  const contextIds = new Set(contexts.rows.map(rowsById))
  const counts = new Map<string, number>()
  // Encounter order can differ across devices. The historical IDs carry the identity.
  const clearCount = (row: VocabularyBackup["encounters"][number]) => ({
    ...row,
    encounterCount: 0,
  })
  const encounters = mergeRows(
    base.encounters.map(clearCount),
    local.encounters.map(clearCount),
    remote.encounters.map(clearCount),
    rowsById,
  )
    .map(entryRef)
    .filter(belongsToEntry)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
    .map((row) => {
      const count = (counts.get(row.entryId) ?? 0) + 1
      counts.set(row.entryId, count)
      const contextId = row.contextId && (contexts.ids.get(row.contextId) ?? row.contextId)
      return {
        ...row,
        contextId: contextId && contextIds.has(contextId) ? contextId : undefined,
        encounterCount: count,
      }
    })
  const forms = mergeRows(base.forms, local.forms, remote.forms, formKey)
    .map(entryRef)
    .filter(belongsToEntry)
  const entryCollections = mergeRows(
    base.entryCollections,
    local.entryCollections,
    remote.entryCollections,
    collectionKey,
  )
    .map(entryRef)
    .map((row) => ({
      ...row,
      collectionId: collections.ids.get(row.collectionId) ?? row.collectionId,
    }))
    .filter((row) => belongsToEntry(row) && collectionIds.has(row.collectionId))
  const entryTags = mergeRows(base.entryTags, local.entryTags, remote.entryTags, tagKey)
    .map(entryRef)
    .map((row) => ({ ...row, tagId: tags.ids.get(row.tagId) ?? row.tagId }))
    .filter((row) => belongsToEntry(row) && tagIds.has(row.tagId))
  return parseVocabularyBackup({
    ...emptyVocabulary,
    entries: entries.rows.map((row) => ({
      ...row,
      encounterCount: Math.max(row.encounterCount, counts.get(row.id) ?? 0),
    })),
    contexts: contexts.rows,
    encounters,
    collections: collections.rows,
    tags: tags.rows,
    forms: unique(forms, formKey),
    entryCollections: unique(entryCollections, collectionKey),
    entryTags: unique(entryTags, tagKey),
  })
}
