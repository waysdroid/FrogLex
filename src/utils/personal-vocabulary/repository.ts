import type { EntityTable } from "dexie"
import type {
  VocabularyCollectionLink,
  VocabularyConflictStrategy,
  VocabularyContext,
  VocabularyEncounter,
  VocabularyEntry,
  VocabularyFilters,
  VocabularyForm,
  VocabularyGroup,
  VocabularyGroupKind,
  VocabularyReceipt,
  VocabularyTagLink,
} from "./records"
import type {
  VocabularyDraft,
  VocabularyEdit,
  VocabularyImportItem,
  VocabularyLookup,
  VocabularySaveInput,
} from "./schema"
import { Dexie } from "dexie"
import { sha256 } from "js-sha256"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { exportVocabularyBackup, restoreVocabularyBackup } from "./backup"
import { DEFAULT_COLLECTION_ID } from "./records"
import {
  comparableVocabularyText,
  contextSchema,
  vocabularyEditSchema,
  vocabularyGroupNameSchema,
  vocabularyImportSchema,
  normalizeVocabularyTerm,
  vocabularySaveSchema,
  vocabularyTermKey,
} from "./schema"

const DATABASE_NAME = "ReadFrogPersonalVocabularyDB"
const PAGE_SIZE = 40

export type { VocabularyEntry, VocabularyReceipt } from "./records"

function defaultCollection(): VocabularyGroup {
  return { id: DEFAULT_COLLECTION_ID, name: "", nameKey: "", createdAt: Date.now() }
}

const entrySortIndexes = {
  updated: "[updatedAt+id]",
  added: "[createdAt+id]",
  alphabetical: "[normalizedTerm+id]",
  encounters: "[encounterCount+id]",
} as const

function groupNameKey(name: string) {
  return comparableVocabularyText(name).toLowerCase()
}

function conflict(): never {
  const error = new Error("A vocabulary record already has that name")
  error.name = "VocabularyConflict"
  throw error
}

export type VocabularyCursor = [updatedAt: number, id: string]

export class VocabularyDatabase extends Dexie {
  entries!: EntityTable<VocabularyEntry, "id">
  contexts!: EntityTable<VocabularyContext, "id">
  encounters!: EntityTable<VocabularyEncounter, "id">
  forms!: Dexie.Table<VocabularyForm, [string, string]>
  collections!: EntityTable<VocabularyGroup, "id">
  entryCollections!: Dexie.Table<VocabularyCollectionLink, [string, string]>
  tags!: EntityTable<VocabularyGroup, "id">
  entryTags!: Dexie.Table<VocabularyTagLink, [string, string]>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      entries: "id, &[language+normalizedTerm], [updatedAt+id]",
      contexts: "id, &[entryId+fingerprint], [entryId+createdAt]",
      encounters: "id, [entryId+createdAt]",
      forms: "[originalKey+entryId], originalKey, entryId",
      collections: "id",
      entryCollections: "[entryId+collectionId], [collectionId+entryId]",
    })
    this.version(2)
      .stores({
        entries:
          "id, &[language+normalizedTerm], [updatedAt+id], [createdAt+id], [normalizedTerm+id], [encounterCount+id]",
        collections: "id, &nameKey",
        entryCollections: "[entryId+collectionId], entryId, collectionId",
        tags: "id, &nameKey",
        entryTags: "[entryId+tagId], entryId, tagId",
      })
      .upgrade((transaction) =>
        transaction.table("collections").update(DEFAULT_COLLECTION_ID, { name: "", nameKey: "" }),
      )
  }
}

export class PersonalVocabularyRepository {
  private readonly db: VocabularyDatabase

  constructor(databaseName = DATABASE_NAME) {
    this.db = new VocabularyDatabase(databaseName)
  }

  private async matchingEntry(input: VocabularyLookup) {
    const termKey = vocabularyTermKey(input.term)
    const originalKey = vocabularyTermKey(input.originalTerm)
    const exact = await this.db.entries.get({ "[language+normalizedTerm]": ["en", termKey] })
    if (exact) return exact

    if (termKey !== originalKey) {
      const pending = await this.db.entries.get({
        "[language+normalizedTerm]": ["en", originalKey],
      })
      return pending?.lemmaSource === "selection" ? pending : undefined
    }

    // Avoid resolving a raw form to a lemma if it was seen with multiple
    // meanings, or if the user or dictionary supplied their own base form.
    if (input.lemmaSource !== "selection") return undefined
    const matches = await this.db.forms.where("originalKey").equals(originalKey).limit(2).toArray()
    return matches.length === 1 ? this.db.entries.get(matches[0]!.entryId) : undefined
  }

  async findByTerm(input: VocabularyLookup) {
    return this.db.transaction("r", [this.db.entries, this.db.forms], async () => {
      const entry = await this.matchingEntry(input)
      return entry ? { entryId: entry.id } : null
    })
  }

  async saveEncounter(input: VocabularySaveInput): Promise<VocabularyReceipt> {
    const draft = vocabularySaveSchema.parse(input)
    const { db } = this
    return db.transaction(
      "rw",
      [db.entries, db.contexts, db.encounters, db.forms, db.collections, db.entryCollections],
      async () => {
        const previous = await db.encounters.get(draft.operationId)
        if (previous) {
          const { entryId, encounterCount, created } = previous
          return { entryId, encounterCount, created }
        }

        const now = Date.now()
        const existing = await this.matchingEntry(draft)
        const useDraftLemma =
          !existing || (existing.lemmaSource === "selection" && draft.lemmaSource !== "selection")
        const term = useDraftLemma ? normalizeVocabularyTerm(draft.term) : existing.term
        const entry: VocabularyEntry = {
          ...existing,
          id: existing?.id ?? getRandomUUID(),
          language: "en",
          normalizedTerm: vocabularyTermKey(term),
          term,
          originalTerm: existing?.originalTerm ?? draft.originalTerm,
          lemmaSource: useDraftLemma ? draft.lemmaSource : existing.lemmaSource,
          createdAt: existing?.createdAt ?? now,
          updatedAt: Math.max(existing?.updatedAt ?? now, now),
          encounterCount: (existing?.encounterCount ?? 0) + 1,
          definition: existing?.definition ?? draft.definition,
          phonetic: existing?.phonetic ?? draft.phonetic,
          partOfSpeech: existing?.partOfSpeech ?? draft.partOfSpeech,
          difficulty: existing?.difficulty ?? draft.difficulty,
        }

        await db.entries.put(entry)
        if (!existing) {
          if (!(await db.collections.get(DEFAULT_COLLECTION_ID))) {
            await db.collections.add(defaultCollection())
          }
          await db.entryCollections.add({ entryId: entry.id, collectionId: DEFAULT_COLLECTION_ID })
        }
        await db.forms.put({
          originalKey: vocabularyTermKey(draft.originalTerm),
          entryId: entry.id,
        })
        const contextId = await this.saveContext(
          entry.id,
          draft.originalTerm,
          draft.context && { ...draft.context, meaning: draft.definition },
          now,
        )
        const receipt = {
          entryId: entry.id,
          encounterCount: entry.encounterCount,
          created: !existing,
        }
        await db.encounters.add({
          ...receipt,
          id: draft.operationId,
          contextId,
          originalTerm: draft.originalTerm,
          createdAt: now,
        })
        return receipt
      },
    )
  }

  private async saveContext(
    entryId: string,
    originalTerm: string,
    context: VocabularyDraft["context"],
    now: number,
  ) {
    if (!context?.sentence && !context?.source) return undefined

    const fingerprint = sha256(
      JSON.stringify([context.source?.url ?? "", comparableVocabularyText(context.sentence ?? "")]),
    )
    const existing = await this.db.contexts.get({ "[entryId+fingerprint]": [entryId, fingerprint] })
    if (existing) {
      const translation = existing.translation ?? context.translation
      const meaning = existing.meaning ?? context.meaning
      if (translation !== existing.translation || meaning !== existing.meaning) {
        await this.db.contexts.update(existing.id, { translation, meaning })
      }
      return existing.id
    }

    return this.db.contexts.add({
      ...context,
      entryId,
      originalTerm,
      fingerprint,
      id: getRandomUUID(),
      createdAt: now,
    })
  }

  async listEntries(cursor?: VocabularyCursor) {
    const { entries } = this.db
    return this.db.transaction("r", entries, async () => {
      const sorted = cursor
        ? entries.where("[updatedAt+id]").below(cursor)
        : entries.orderBy("[updatedAt+id]")
      const rows = await sorted
        .reverse()
        .limit(PAGE_SIZE + 1)
        .toArray()
      const last = rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1] : undefined
      return {
        entries: rows.slice(0, PAGE_SIZE),
        total: await entries.count(),
        nextCursor: last ? ([last.updatedAt, last.id] as VocabularyCursor) : undefined,
      }
    })
  }

  async getEntryDetail(id: string) {
    const { entries, contexts } = this.db
    return this.db.transaction("r", [entries, contexts], async () => {
      const entry = await entries.get(id)
      if (!entry) return null
      const records = await contexts
        .where("[entryId+createdAt]")
        .between([id, Dexie.minKey], [id, Dexie.maxKey], true, true)
        .reverse()
        .toArray()
      return { entry, contexts: records }
    })
  }

  async getPage(filters: VocabularyFilters, page: number) {
    const { db } = this
    return db.transaction(
      "r",
      [db.entries, db.tags, db.entryTags, db.entryCollections],
      async () => {
        const collection = filters.collectionId
          ? new Set(
              (
                await db.entryCollections
                  .where("collectionId")
                  .equals(filters.collectionId)
                  .toArray()
              ).map(({ entryId }) => entryId),
            )
          : undefined
        const tag = filters.tagId
          ? new Set(
              (await db.entryTags.where("tagId").equals(filters.tagId).toArray()).map(
                ({ entryId }) => entryId,
              ),
            )
          : undefined
        const search = comparableVocabularyText(filters.search).toLowerCase()
        const matchingTagEntries = new Set<string>()
        if (search) {
          const matchingTagIds = await db.tags
            .filter(({ nameKey }) => nameKey.includes(search))
            .primaryKeys()
          await db.entryTags
            .where("tagId")
            .anyOf(matchingTagIds)
            .each(({ entryId }) => {
              matchingTagEntries.add(entryId)
            })
        }
        const sorted = db.entries.orderBy(entrySortIndexes[filters.sort])
        if (filters.sort !== "alphabetical") sorted.reverse()
        function matches(entry: VocabularyEntry) {
          const hasDefinition = !!(entry.definition || entry.meaningsZh || entry.meaningsEn)
          if (collection && !collection.has(entry.id)) return false
          if (tag && !tag.has(entry.id)) return false
          if (filters.difficulty && entry.difficulty !== filters.difficulty) return false
          if (filters.marker && !entry[filters.marker]) return false
          if (filters.completeness && hasDefinition !== (filters.completeness === "complete"))
            return false
          return (
            !search ||
            matchingTagEntries.has(entry.id) ||
            [
              entry.term,
              entry.originalTerm,
              entry.definition?.text,
              entry.meaningsZh,
              entry.meaningsEn,
              entry.note,
            ].some(
              (value) => value && comparableVocabularyText(value).toLowerCase().includes(search),
            )
          )
        }
        const filtered =
          search ||
          collection ||
          tag ||
          filters.difficulty ||
          filters.marker ||
          filters.completeness
            ? sorted.filter(matches)
            : sorted
        const total = await filtered.count()
        const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
        const currentPage = Math.max(0, Math.min(page, lastPage))
        const entries = await filtered
          .offset(currentPage * PAGE_SIZE)
          .limit(PAGE_SIZE)
          .toArray()
        return { entries, total, page: currentPage, lastPage }
      },
    )
  }

  async getOrganization() {
    const { db } = this
    return db.transaction("r", [db.collections, db.tags], async () => {
      const collections = await db.collections.orderBy("nameKey").toArray()
      if (!collections.some(({ id }) => id === DEFAULT_COLLECTION_ID))
        collections.unshift(defaultCollection())
      return { collections, tags: await db.tags.orderBy("nameKey").toArray() }
    })
  }

  async getMembership(entryId: string) {
    const { db } = this
    return db.transaction("r", [db.entryCollections, db.entryTags], async () => ({
      collectionIds: (await db.entryCollections.where({ entryId }).toArray()).map(
        ({ collectionId }) => collectionId,
      ),
      tagIds: (await db.entryTags.where({ entryId }).toArray()).map(({ tagId }) => tagId),
    }))
  }

  async saveGroup(kind: VocabularyGroupKind, name: string, id?: string) {
    const sanitized = vocabularyGroupNameSchema.parse(name)
    const table = kind === "collection" ? this.db.collections : this.db.tags
    return this.db.transaction("rw", table, async () => {
      const prior = id ? await table.get(id) : undefined
      if (id && (!prior || id === DEFAULT_COLLECTION_ID)) throw new Error("Invalid group")
      const nameKey = groupNameKey(sanitized)
      const duplicate = await table.get({ nameKey })
      if (duplicate && duplicate.id !== id) conflict()
      return await table.put({
        id: prior?.id ?? getRandomUUID(),
        name: sanitized,
        nameKey,
        createdAt: prior?.createdAt ?? Date.now(),
      })
    })
  }

  async deleteGroup(kind: VocabularyGroupKind, id: string) {
    const { db } = this
    if (id === DEFAULT_COLLECTION_ID) throw new Error("The default collection cannot be deleted")
    if (kind === "tag") {
      await db.transaction("rw", [db.tags, db.entryTags], async () => {
        await db.entryTags.where({ tagId: id }).delete()
        await db.tags.delete(id)
      })
      return
    }
    await db.transaction("rw", [db.collections, db.entryCollections], async () => {
      const affected = await db.entryCollections.where({ collectionId: id }).toArray()
      await db.entryCollections.where({ collectionId: id }).delete()
      await db.collections.delete(id)
      if (affected.length && !(await db.collections.get(DEFAULT_COLLECTION_ID))) {
        await db.collections.put(defaultCollection())
      }
      for (const { entryId } of affected) {
        if (!(await db.entryCollections.where({ entryId }).count())) {
          await db.entryCollections.put({ entryId, collectionId: DEFAULT_COLLECTION_ID })
        }
      }
    })
  }

  async saveEntry(input: VocabularyEdit, id?: string) {
    const { collectionIds, tagIds, ...fields } = vocabularyEditSchema.parse(input)
    const { db } = this
    return db.transaction(
      "rw",
      [db.entries, db.forms, db.collections, db.tags, db.entryCollections, db.entryTags],
      async () => {
        const existing = id ? await db.entries.get(id) : undefined
        if (id && !existing) throw new Error("Vocabulary entry no longer exists")
        const normalizedTerm = vocabularyTermKey(fields.term)
        const duplicate = await db.entries.get({
          "[language+normalizedTerm]": ["en", normalizedTerm],
        })
        if (duplicate && duplicate.id !== id) conflict()
        const now = Date.now()
        const entryId = existing?.id ?? getRandomUUID()
        await db.entries.put({
          ...fields,
          term: normalizeVocabularyTerm(fields.term),
          normalizedTerm,
          language: "en",
          id: entryId,
          encounterCount: existing?.encounterCount ?? 0,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
        await db.forms.put({ originalKey: vocabularyTermKey(fields.originalTerm), entryId })
        await this.replaceMembership(entryId, collectionIds, tagIds)
        return entryId
      },
    )
  }

  private async replaceMembership(entryId: string, collectionIds: string[], tagIds: string[]) {
    const { db } = this
    if (!(await db.collections.get(DEFAULT_COLLECTION_ID)))
      await db.collections.put(defaultCollection())
    const validCollections = (await db.collections.bulkGet([...new Set(collectionIds)])).filter(
      (row) => row !== undefined,
    )
    const validTags = (await db.tags.bulkGet([...new Set(tagIds)])).filter(
      (row) => row !== undefined,
    )
    await db.entryCollections.where({ entryId }).delete()
    await db.entryTags.where({ entryId }).delete()
    await db.entryCollections.bulkPut(
      validCollections.length
        ? validCollections.map(({ id }) => ({ entryId, collectionId: id }))
        : [{ entryId, collectionId: DEFAULT_COLLECTION_ID }],
    )
    await db.entryTags.bulkPut(validTags.map(({ id }) => ({ entryId, tagId: id })))
  }

  async moveEntries(ids: string[], collectionId: string) {
    const { db } = this
    await db.transaction("rw", [db.entries, db.collections, db.entryCollections], async () => {
      if (collectionId === DEFAULT_COLLECTION_ID && !(await db.collections.get(collectionId))) {
        await db.collections.put(defaultCollection())
      }
      if (!(await db.collections.get(collectionId)))
        throw new Error("Vocabulary collection no longer exists")
      const entries = (await db.entries.bulkGet([...new Set(ids)])).filter(
        (row) => row !== undefined,
      )
      const entryIds = entries.map(({ id }) => id)
      await db.entryCollections.where("entryId").anyOf(entryIds).delete()
      await db.entryCollections.bulkPut(entryIds.map((entryId) => ({ entryId, collectionId })))
    })
  }

  async deleteEntries(ids: string[]) {
    const { db } = this
    await db.transaction(
      "rw",
      [db.entries, db.contexts, db.encounters, db.forms, db.entryCollections, db.entryTags],
      async () => {
        for (const id of ids) {
          for (const table of [db.contexts, db.encounters]) {
            await table
              .where("[entryId+createdAt]")
              .between([id, Dexie.minKey], [id, Dexie.maxKey], true, true)
              .delete()
          }
        }
        await db.forms.where("entryId").anyOf(ids).delete()
        await db.entryCollections.where("entryId").anyOf(ids).delete()
        await db.entryTags.where("entryId").anyOf(ids).delete()
        await db.entries.bulkDelete(ids)
      },
    )
  }

  async addContext(entryId: string, input: NonNullable<VocabularyDraft["context"]>) {
    const context = contextSchema.parse(input)
    const { db } = this
    return db.transaction("rw", [db.entries, db.contexts], async () => {
      const entry = await db.entries.get(entryId)
      if (!entry) throw new Error("Vocabulary entry no longer exists")
      const now = Date.now()
      const contextId = await this.saveContext(entryId, entry.originalTerm, context, now)
      if (contextId) await db.entries.update(entryId, { updatedAt: now })
      return contextId
    })
  }

  async existingTermKeys(keys: string[]) {
    return new Set(
      (
        await this.db.entries
          .where("[language+normalizedTerm]")
          .anyOf(keys.map((key) => ["en", key]))
          .toArray()
      ).map(({ normalizedTerm }) => normalizedTerm),
    )
  }

  async importEntries(
    inputs: VocabularyImportItem[],
    strategy: VocabularyConflictStrategy,
    collectionId: string,
  ) {
    const { db } = this
    return db.transaction(
      "rw",
      [db.entries, db.forms, db.collections, db.entryCollections, db.contexts],
      async () => {
        if (collectionId === DEFAULT_COLLECTION_ID && !(await db.collections.get(collectionId))) {
          await db.collections.put(defaultCollection())
        }
        if (!(await db.collections.get(collectionId)))
          throw new Error("Vocabulary collection no longer exists")
        const counts = { written: 0, duplicates: 0, invalid: 0 }
        for (const input of inputs) {
          const item = vocabularyImportSchema.safeParse(input)
          if (!item.success) {
            counts.invalid++
            continue
          }
          const { term, originalTerm = term, context, ...optional } = item.data
          const key = vocabularyTermKey(term)
          const existing = await db.entries.get({ "[language+normalizedTerm]": ["en", key] })
          if (existing) {
            counts.duplicates++
            if (strategy === "skip") continue
          }
          const now = Date.now()
          const entry: VocabularyEntry = existing ?? {
            id: getRandomUUID(),
            language: "en",
            normalizedTerm: key,
            term: normalizeVocabularyTerm(term),
            originalTerm,
            lemmaSource: "user",
            encounterCount: 0,
            createdAt: now,
            updatedAt: now,
          }
          const fields = Object.fromEntries(
            Object.entries(optional).filter(
              ([field, value]) =>
                value !== undefined &&
                (strategy === "overwrite" || entry[field as keyof typeof optional] === undefined),
            ),
          )
          await db.entries.put({ ...entry, ...fields, updatedAt: now })
          await db.forms.put({ entryId: entry.id, originalKey: vocabularyTermKey(originalTerm) })
          await db.entryCollections.put({ entryId: entry.id, collectionId })
          await this.saveContext(entry.id, originalTerm, context, now)
          counts.written++
        }
        return counts
      },
    )
  }

  async *exportEntries() {
    const table = this.db.entries
    let after: string | undefined
    do {
      const ordered = after ? table.where("id").above(after) : table.orderBy("id")
      const batch: VocabularyEntry[] = await ordered.limit(200).toArray()
      yield* batch
      after = batch.length === 200 ? batch.at(-1)?.id : undefined
    } while (after)
  }

  createBackup() {
    return exportVocabularyBackup(this.db)
  }

  restoreBackup(input: unknown, strategy: VocabularyConflictStrategy) {
    return restoreVocabularyBackup(this.db, input, strategy)
  }

  close() {
    this.db.close()
  }
}

export const personalVocabularyRepository = new PersonalVocabularyRepository()
