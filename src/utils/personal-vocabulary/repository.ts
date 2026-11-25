import type { EntityTable } from "dexie"
import type { VocabularyDraft, VocabularyLookup, VocabularySaveInput } from "./schema"
import { Dexie } from "dexie"
import { sha256 } from "js-sha256"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import {
  comparableVocabularyText,
  normalizeVocabularyTerm,
  vocabularySaveSchema,
  vocabularyTermKey,
} from "./schema"

const DATABASE_NAME = "ReadFrogPersonalVocabularyDB"
const DEFAULT_COLLECTION_ID = "default"
const PAGE_SIZE = 40

type VocabularyFields = Pick<
  VocabularyDraft,
  "definition" | "phonetic" | "partOfSpeech" | "difficulty"
>

export interface VocabularyEntry extends VocabularyFields {
  id: string
  language: "en"
  normalizedTerm: string
  term: string
  originalTerm: string
  lemmaSource: VocabularyLookup["lemmaSource"]
  encounterCount: number
  createdAt: number
  updatedAt: number
}

export type VocabularyContext = NonNullable<VocabularyDraft["context"]> & {
  id: string
  entryId: string
  originalTerm: string
  fingerprint: string
  createdAt: number
}

export interface VocabularyReceipt {
  entryId: string
  encounterCount: number
  created: boolean
}

interface VocabularyEncounter extends VocabularyReceipt {
  id: string
  originalTerm: string
  contextId?: string
  createdAt: number
}

export type VocabularyCursor = [updatedAt: number, id: string]

class VocabularyDatabase extends Dexie {
  entries!: EntityTable<VocabularyEntry, "id">
  contexts!: EntityTable<VocabularyContext, "id">
  encounters!: EntityTable<VocabularyEncounter, "id">
  forms!: Dexie.Table<{ originalKey: string; entryId: string }, [string, string]>
  collections!: EntityTable<{ id: string; createdAt: number }, "id">
  entryCollections!: Dexie.Table<{ entryId: string; collectionId: string }, [string, string]>

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
            await db.collections.add({ id: DEFAULT_COLLECTION_ID, createdAt: now })
          }
          await db.entryCollections.add({ entryId: entry.id, collectionId: DEFAULT_COLLECTION_ID })
        }
        await db.forms.put({
          originalKey: vocabularyTermKey(draft.originalTerm),
          entryId: entry.id,
        })
        const contextId = await this.saveContext(entry.id, draft.originalTerm, draft.context, now)
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
      if (!existing.translation && context.translation) {
        await this.db.contexts.update(existing.id, { translation: context.translation })
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

  close() {
    this.db.close()
  }
}

export const personalVocabularyRepository = new PersonalVocabularyRepository()
