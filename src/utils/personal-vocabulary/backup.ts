import type { VocabularyConflictStrategy, VocabularyEntry } from "./records"
import type { VocabularyDatabase } from "./repository"
import { dequal } from "dequal"
import { sha256 } from "js-sha256"
import { z } from "zod"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { DEFAULT_COLLECTION_ID } from "./records"
import {
  comparableVocabularyText,
  contextSchema,
  normalizeVocabularyTerm,
  termSchema,
  vocabularyDetailsSchema,
  vocabularyFieldsSchema,
  vocabularyGroupNameSchema,
  vocabularyLookupSchema,
  vocabularyTermKey,
} from "./schema"

const timeSchema = z.number().int().min(0).max(8_640_000_000_000_000)
const idSchema = z.uuid()
const collectionIdSchema = z.union([idSchema, z.literal(DEFAULT_COLLECTION_ID)])
const entrySchema = vocabularyLookupSchema.extend({
  ...vocabularyDetailsSchema.shape,
  ...vocabularyFieldsSchema.shape,
  id: idSchema,
  language: z.literal("en"),
  encounterCount: z.number().int().min(0),
  createdAt: timeSchema,
  updatedAt: timeSchema,
})
const contextRecordSchema = contextSchema.safeExtend({
  id: idSchema,
  entryId: idSchema,
  originalTerm: termSchema,
  createdAt: timeSchema,
})
const groupSchema = z.object({
  id: idSchema,
  name: vocabularyGroupNameSchema,
  createdAt: timeSchema,
})
const vocabularyBackupSchema = z.object({
  format: z.literal("read-frog-personal-vocabulary"),
  version: z.literal(1),
  exportedAt: timeSchema,
  entries: z.array(entrySchema),
  contexts: z.array(contextRecordSchema),
  encounters: z.array(
    z.object({
      id: idSchema,
      entryId: idSchema,
      originalTerm: termSchema,
      encounterCount: z.number().int().min(0),
      created: z.boolean(),
      contextId: idSchema.optional(),
      createdAt: timeSchema,
    }),
  ),
  forms: z.array(z.object({ entryId: idSchema, originalKey: termSchema })),
  collections: z.array(
    z.union([
      groupSchema,
      z.object({
        id: z.literal(DEFAULT_COLLECTION_ID),
        name: z.literal(""),
        createdAt: timeSchema,
      }),
    ]),
  ),
  tags: z.array(groupSchema),
  entryCollections: z.array(z.object({ entryId: idSchema, collectionId: collectionIdSchema })),
  entryTags: z.array(z.object({ entryId: idSchema, tagId: idSchema })),
})

export type VocabularyBackup = z.output<typeof vocabularyBackupSchema>

function uniqueIds(rows: { id: string }[]) {
  const ids = new Set(rows.map(({ id }) => id))
  if (ids.size !== rows.length) throw new Error("Duplicate identifier in vocabulary backup")
  return ids
}

export function parseVocabularyBackup(input: unknown): VocabularyBackup {
  const data = vocabularyBackupSchema.parse(input)
  const entryIds = uniqueIds(data.entries)
  const collections = uniqueIds(data.collections)
  const tags = uniqueIds(data.tags)
  const contexts = new Map(data.contexts.map((context) => [context.id, context.entryId]))
  uniqueIds(data.contexts)
  uniqueIds(data.encounters)

  if (
    [
      ...data.contexts,
      ...data.encounters,
      ...data.forms,
      ...data.entryCollections,
      ...data.entryTags,
    ].some(({ entryId }) => !entryIds.has(entryId)) ||
    data.entryCollections.some(({ collectionId }) => !collections.has(collectionId)) ||
    data.entryTags.some(({ tagId }) => !tags.has(tagId)) ||
    data.encounters.some(
      ({ entryId, contextId }) => contextId && contexts.get(contextId) !== entryId,
    ) ||
    new Set(data.entries.map(({ term }) => vocabularyTermKey(term))).size !== entryIds.size ||
    [data.collections, data.tags].some(
      (groups) =>
        new Set(groups.map(({ name }) => comparableVocabularyText(name).toLowerCase())).size !==
        groups.length,
    )
  )
    throw new Error("Invalid vocabulary backup relationships")
  return data
}

export async function exportVocabularyBackup(db: VocabularyDatabase) {
  return db.transaction("r", db.tables, async () =>
    parseVocabularyBackup({
      format: "read-frog-personal-vocabulary",
      version: 1,
      exportedAt: Date.now(),
      entries: await db.entries.toArray(),
      contexts: await db.contexts.toArray(),
      encounters: await db.encounters.toArray(),
      forms: await db.forms.toArray(),
      collections: await db.collections.toArray(),
      tags: await db.tags.toArray(),
      entryCollections: await db.entryCollections.toArray(),
      entryTags: await db.entryTags.toArray(),
    }),
  )
}

/** Apply a validated WebDAV snapshot inside one transaction. The guarded read
 * also sees changes from other extension contexts, including the dictionary. */
export async function applyVocabularySnapshot(
  db: VocabularyDatabase,
  expected: VocabularyBackup,
  next: VocabularyBackup,
) {
  return db.transaction("rw", db.tables, async () => {
    const current = await exportVocabularyBackup(db)
    if (
      JSON.stringify({ ...current, exportedAt: 0 }) !==
      JSON.stringify({ ...expected, exportedAt: 0 })
    ) {
      return false
    }
    async function patch<T, K>(
      table: {
        bulkDelete: (keys: K[]) => Promise<void>
        bulkPut: (rows: NoInfer<T>[]) => Promise<unknown>
      },
      previous: T[],
      following: T[],
      getKey: (row: T) => NoInfer<K>,
    ) {
      const key = (row: T) => JSON.stringify(getKey(row))
      const old = new Map(previous.map((row) => [key(row), row]))
      const previousKeys = new Set(old.keys())
      const changed = following.filter((row) => {
        const prior = old.get(key(row))
        old.delete(key(row))
        return !dequal(prior, row)
      })
      const changedExisting = changed.filter((row) => previousKeys.has(key(row)))
      if (old.size || changedExisting.length) {
        await table.bulkDelete([...old.values(), ...changedExisting].map(getKey))
      }
      if (changed.length) await table.bulkPut(changed)
    }
    const entries = (rows: VocabularyBackup["entries"]) =>
      rows.map((row) => ({ ...row, normalizedTerm: vocabularyTermKey(row.term) }))
    const groups = (rows: VocabularyBackup["collections"]) =>
      rows.map((row) => ({ ...row, nameKey: comparableVocabularyText(row.name).toLowerCase() }))
    const contexts = (rows: VocabularyBackup["contexts"]) =>
      rows.map((row) => ({
        ...row,
        fingerprint: sha256(
          JSON.stringify([row.source?.url ?? "", comparableVocabularyText(row.sentence ?? "")]),
        ),
      }))
    await patch(db.entries, entries(current.entries), entries(next.entries), ({ id }) => id)
    await patch(db.contexts, contexts(current.contexts), contexts(next.contexts), ({ id }) => id)
    await patch(db.encounters, current.encounters, next.encounters, ({ id }) => id)
    await patch(
      db.collections,
      groups(current.collections),
      groups(next.collections),
      ({ id }) => id,
    )
    await patch(db.tags, groups(current.tags), groups(next.tags), ({ id }) => id)
    await patch(db.forms, current.forms, next.forms, (row): [string, string] => [
      row.originalKey,
      row.entryId,
    ])
    await patch(
      db.entryCollections,
      current.entryCollections,
      next.entryCollections,
      (row): [string, string] => [row.entryId, row.collectionId],
    )
    await patch(db.entryTags, current.entryTags, next.entryTags, (row): [string, string] => [
      row.entryId,
      row.tagId,
    ])
    return true
  })
}

function availableId(id: string, used: Set<string>) {
  return used.has(id) ? getRandomUUID() : id
}

export async function restoreVocabularyBackup(
  db: VocabularyDatabase,
  input: unknown,
  strategy: VocabularyConflictStrategy,
) {
  const backup = parseVocabularyBackup(input)
  return db.transaction("rw", db.tables, async () => {
    const counts = { written: 0, duplicates: 0 }

    async function restoreGroups(
      table: VocabularyDatabase["collections"],
      groups: VocabularyBackup["collections"],
    ) {
      const current = await table.toArray()
      const used = new Set(current.map(({ id }) => id))
      const existing = new Map(current.map((group) => [group.nameKey, group.id]))
      const ids = new Map<string, string>()
      const additions = []
      for (const group of groups) {
        const nameKey = comparableVocabularyText(group.name).toLowerCase()
        const present = existing.get(nameKey)
        const id = present ?? availableId(group.id, used)
        ids.set(group.id, id)
        used.add(id)
        if (!present) additions.push({ ...group, id, nameKey })
      }
      await table.bulkPut(additions)
      return ids
    }

    const collectionIds = await restoreGroups(db.collections, backup.collections)
    const tagIds = await restoreGroups(db.tags, backup.tags)
    const existing = await db.entries.toArray()
    const known = new Map(existing.map((entry) => [entry.normalizedTerm, entry]))
    const used = new Set(existing.map(({ id }) => id))
    const entryIds = new Map<string, string>()
    const updates = new Map<string, VocabularyEntry>()
    for (const incoming of backup.entries) {
      const normalizedTerm = vocabularyTermKey(incoming.term)
      const current = known.get(normalizedTerm)
      if (current) {
        counts.duplicates++
        if (strategy === "skip") continue
      }
      const id = current?.id ?? availableId(incoming.id, used)
      used.add(id)
      entryIds.set(incoming.id, id)
      const incomingFields = Object.fromEntries(
        Object.entries(incoming).filter(([, value]) => value !== undefined),
      )
      const currentFields =
        current &&
        Object.fromEntries(Object.entries(current).filter(([, value]) => value !== undefined))
      const base = {
        ...incoming,
        ...(strategy === "merge" ? currentFields : { ...current, ...incomingFields }),
      }
      updates.set(id, {
        ...base,
        id,
        normalizedTerm,
        term: normalizeVocabularyTerm(base.term),
        createdAt: Math.min(current?.createdAt ?? incoming.createdAt, incoming.createdAt),
        updatedAt: Math.max(current?.updatedAt ?? incoming.updatedAt, incoming.updatedAt),
        encounterCount: current?.encounterCount ?? 0,
      })
      counts.written++
    }
    await db.entries.bulkPut([...updates.values()])

    const currentContexts = await db.contexts.toArray()
    const contextByKey = new Map(
      currentContexts.map((context) => [
        JSON.stringify([context.entryId, context.fingerprint]),
        context,
      ]),
    )
    const usedContextIds = new Set(currentContexts.map(({ id }) => id))
    const contextIds = new Map<string, string>()
    const contexts = []
    for (const incoming of backup.contexts) {
      const entryId = entryIds.get(incoming.entryId)
      if (!entryId) continue
      const fingerprint = sha256(
        JSON.stringify([
          incoming.source?.url ?? "",
          comparableVocabularyText(incoming.sentence ?? ""),
        ]),
      )
      const key = JSON.stringify([entryId, fingerprint])
      const current = contextByKey.get(key)
      const id = current?.id ?? availableId(incoming.id, usedContextIds)
      contextIds.set(incoming.id, id)
      usedContextIds.add(id)
      const context = {
        ...incoming,
        ...current,
        id,
        entryId,
        fingerprint,
        meaning: current?.meaning ?? incoming.meaning,
        translation: current?.translation ?? incoming.translation,
      }
      contextByKey.set(key, context)
      contexts.push(context)
    }
    await db.contexts.bulkPut(contexts)

    const oldEncounters = new Map(
      (await db.encounters.toArray()).map((row) => [row.id, row.entryId]),
    )
    const encounters = []
    for (const incoming of backup.encounters) {
      const entryId = entryIds.get(incoming.entryId)
      if (!entryId || oldEncounters.get(incoming.id) === entryId) continue
      // A reused operation ID on a different word is a separate history item.
      const id = oldEncounters.has(incoming.id)
        ? deterministicEncounterId(incoming.id, entryId)
        : incoming.id
      if (oldEncounters.has(id)) continue
      const entry = updates.get(entryId)!
      entry.encounterCount++
      oldEncounters.set(id, entryId)
      encounters.push({
        ...incoming,
        id,
        entryId,
        contextId: incoming.contextId ? contextIds.get(incoming.contextId) : undefined,
        encounterCount: entry.encounterCount,
      })
    }
    await db.encounters.bulkPut(encounters)
    await db.entries.bulkPut([...updates.values()])
    await db.forms.bulkPut(
      backup.forms.flatMap(({ originalKey, entryId }) => {
        const target = entryIds.get(entryId)
        return target ? [{ originalKey: vocabularyTermKey(originalKey), entryId: target }] : []
      }),
    )
    await db.entryCollections.bulkPut(
      backup.entryCollections.flatMap(({ entryId, collectionId }) => {
        const entry = entryIds.get(entryId)
        const collection = collectionIds.get(collectionId)
        return entry && collection ? [{ entryId: entry, collectionId: collection }] : []
      }),
    )
    await db.entryTags.bulkPut(
      backup.entryTags.flatMap(({ entryId, tagId }) => {
        const entry = entryIds.get(entryId)
        const tag = tagIds.get(tagId)
        return entry && tag ? [{ entryId: entry, tagId: tag }] : []
      }),
    )
    return counts
  })
}

function deterministicEncounterId(operationId: string, entryId: string) {
  const hash = sha256(`${operationId}:${entryId}`)
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
