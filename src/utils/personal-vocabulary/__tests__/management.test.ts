import { Dexie } from "dexie"
import { IDBKeyRange, indexedDB } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseVocabularyBackup } from "../backup"
import { DEFAULT_COLLECTION_ID, DEFAULT_VOCABULARY_FILTERS } from "../records"
import { PersonalVocabularyRepository } from "../repository"
import {
  exportVocabularyEntries,
  inspectVocabularySource,
  processVocabularyImport,
} from "../transfer"

const database = "personal-vocabulary-v2-test"
const restoredDatabase = "personal-vocabulary-restore-test"
let repository: PersonalVocabularyRepository

beforeEach(() => {
  Dexie.dependencies.indexedDB = indexedDB
  Dexie.dependencies.IDBKeyRange = IDBKeyRange
  repository = new PersonalVocabularyRepository(database)
})

afterEach(async () => {
  repository.close()
  await Dexie.delete(database)
  await Dexie.delete(restoredDatabase)
})

describe("vocabulary management", () => {
  it("upgrades V0.1 records in place and preserves their collection links and context", async () => {
    const old = new Dexie(database)
    old.version(1).stores({
      entries: "id, &[language+normalizedTerm], [updatedAt+id]",
      contexts: "id, &[entryId+fingerprint], [entryId+createdAt]",
      encounters: "id, [entryId+createdAt]",
      forms: "[originalKey+entryId], originalKey, entryId",
      collections: "id",
      entryCollections: "[entryId+collectionId], [collectionId+entryId]",
    })
    const id = crypto.randomUUID()
    await old.table("entries").add({
      id,
      language: "en",
      term: "blossom",
      normalizedTerm: "blossom",
      originalTerm: "blossoms",
      lemmaSource: "dictionary",
      encounterCount: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    await old.table("contexts").add({
      id: crypto.randomUUID(),
      entryId: id,
      sentence: "The cherry blossoms opened early.",
      fingerprint: "saved-context",
      originalTerm: "blossoms",
      createdAt: 1,
    })
    await old.table("collections").add({ id: DEFAULT_COLLECTION_ID, createdAt: 1 })
    await old.table("entryCollections").add({ entryId: id, collectionId: DEFAULT_COLLECTION_ID })
    old.close()

    expect(await repository.getOrganization()).toMatchObject({
      collections: [{ id: DEFAULT_COLLECTION_ID, name: "", createdAt: 1 }],
    })
    expect(await repository.getMembership(id)).toEqual({
      collectionIds: [DEFAULT_COLLECTION_ID],
      tagIds: [],
    })
    expect(await repository.getEntryDetail(id)).toMatchObject({
      entry: { term: "blossom", encounterCount: 1 },
      contexts: [{ sentence: "The cherry blossoms opened early." }],
    })
  })

  it("finds notes and tags and preserves entries when a collection is deleted", async () => {
    const collectionId = await repository.saveGroup("collection", "Reading")
    const tagId = await repository.saveGroup("tag", "Botany")
    const id = await repository.saveEntry({
      term: "blossom",
      originalTerm: "blossom",
      lemmaSource: "user",
      collectionIds: [collectionId],
      tagIds: [tagId],
      note: "Seen in the garden",
      memoryTips: "搭配：cherry blossom",
      favorite: true,
      meaningsZh: "花",
      difficulty: "B2",
    })
    for (const search of ["botany", "garden", "花", "cherry blossom"]) {
      expect(
        await repository.getPage(
          {
            ...DEFAULT_VOCABULARY_FILTERS,
            search,
            collectionId,
            difficulty: "B2",
            marker: "favorite",
            completeness: "complete",
          },
          0,
        ),
      ).toMatchObject({ total: 1, entries: [{ id }] })
    }
    await repository.deleteGroup("collection", collectionId)
    expect(await repository.getMembership(id)).toEqual({
      collectionIds: [DEFAULT_COLLECTION_ID],
      tagIds: [tagId],
    })
    await repository.deleteEntries([id])
    expect(await repository.getEntryDetail(id)).toBeNull()
    expect(await repository.getMembership(id)).toEqual({ collectionIds: [], tagIds: [] })
  })

  it("validates backups before writes and restores history, notes and relationships without duplicating them", async () => {
    const collection = await repository.saveGroup("collection", "Books")
    const tag = await repository.saveGroup("tag", "Garden")
    const { entryId } = await repository.saveEncounter({
      operationId: crypto.randomUUID(),
      term: "blossom",
      originalTerm: "blossoms",
      lemmaSource: "dictionary",
      context: {
        sentence: "The blossoms opened early.",
        source: { url: "https://example.com/a?key=token" },
      },
    })
    await repository.saveEntry(
      {
        term: "blossom",
        originalTerm: "blossoms",
        lemmaSource: "user",
        note: "Personal note",
        memoryTips: "词源：Old English blōstm。\n搭配：cherry blossom",
        examples: "A manual example.\n\nAn AI example.",
        aiUndo: {
          examples: { before: "A manual example.", after: "A manual example.\n\nAn AI example." },
        },
        collectionIds: [collection],
        tagIds: [tag],
      },
      entryId,
    )
    const backup = await repository.createBackup()
    repository.close()
    repository = new PersonalVocabularyRepository(database)
    expect(await repository.createBackup()).toEqual({
      ...backup,
      exportedAt: expect.any(Number),
    })
    expect(parseVocabularyBackup({ ...backup, apiKey: "private" })).not.toHaveProperty("apiKey")
    const destination = new PersonalVocabularyRepository(restoredDatabase)
    try {
      await expect(destination.restoreBackup({ ...backup, version: 999 }, "merge")).rejects.toThrow(
        "version",
      )
      expect((await destination.getPage(DEFAULT_VOCABULARY_FILTERS, 0)).total).toBe(0)
      await expect(destination.restoreBackup({ ...backup, entries: [] }, "merge")).rejects.toThrow(
        "relationships",
      )

      expect(await destination.restoreBackup(backup, "merge")).toEqual({
        written: 1,
        duplicates: 0,
      })
      expect(await destination.restoreBackup(backup, "merge")).toEqual({
        written: 1,
        duplicates: 1,
      })
      expect(await destination.getEntryDetail(entryId)).toMatchObject({
        entry: {
          term: "blossom",
          encounterCount: 1,
          note: "Personal note",
          memoryTips: "词源：Old English blōstm。\n搭配：cherry blossom",
          examples: "A manual example.\n\nAn AI example.",
          aiUndo: {
            examples: { before: "A manual example.", after: "A manual example.\n\nAn AI example." },
          },
        },
        contexts: [
          { sentence: "The blossoms opened early.", source: { url: "https://example.com/a" } },
        ],
      })
      expect(await destination.getMembership(entryId)).toEqual({
        collectionIds: [collection],
        tagIds: [tag],
      })
    } finally {
      destination.close()
    }
  })

  it("previews mapped CSV, skips invalid rows, handles duplicates and neutralizes exported cells", async () => {
    const file = new Blob([
      '\uFEFFword,meaning,note,记忆技巧\r\n"blossom","花, 花朵","line 1\nline 2","词源：Old English blōstm。\n搭配：cherry blossom"\r\nBLOSSOM,次条,,\r\n中文,,,\r\ncare,照顾,=1+1,',
    ])
    const source = { file, format: "csv", encoding: "auto", header: true } as const
    const preview = await inspectVocabularySource(source)
    expect(preview.mapping).toEqual({ term: "0", definition: "1", note: "2", memoryTips: "3" })
    const input = {
      source,
      mapping: preview.mapping,
      language: "zh-CN",
      repository,
      signal: new AbortController().signal,
      onProgress: () => {},
    }
    expect(await processVocabularyImport(input)).toEqual({
      written: 0,
      valid: 3,
      invalid: 1,
      duplicates: 1,
      failed: 0,
    })
    expect(
      await processVocabularyImport({
        ...input,
        destination: { strategy: "skip", collectionId: DEFAULT_COLLECTION_ID },
      }),
    ).toEqual({ written: 2, valid: 3, invalid: 1, duplicates: 1, failed: 0 })
    const csv = await exportVocabularyEntries(repository, "csv")
    const text = await csv.text()
    expect(text).toContain('"line 1\nline 2"')
    expect(text).toContain('"词源：Old English blōstm。\n搭配：cherry blossom"')
    expect(text).toContain('"\'=1+1"')
    expect(await (await exportVocabularyEntries(repository, "txt")).text()).toContain("blossom")
    const json = await exportVocabularyEntries(repository, "json")
    expect(JSON.parse(await json.text())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          term: "blossom",
          memoryTips: "词源：Old English blōstm。\n搭配：cherry blossom",
        }),
      ]),
    )
    const jsonSource = { file: json, format: "json", encoding: "auto", header: false } as const
    const jsonPreview = await inspectVocabularySource(jsonSource)
    expect(
      await processVocabularyImport({
        ...input,
        source: jsonSource,
        mapping: jsonPreview.mapping,
      }),
    ).toMatchObject({ valid: 2, duplicates: 2, invalid: 0 })
  })
})
