import type { VocabularySaveInput } from "../schema"
import { Dexie } from "dexie"
import { IDBKeyRange, indexedDB } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PersonalVocabularyRepository } from "../repository"

const databaseName = "personal-vocabulary-test"
let repository: PersonalVocabularyRepository

function encounter(input: Partial<VocabularySaveInput> = {}): VocabularySaveInput {
  return {
    operationId: crypto.randomUUID(),
    term: "blossom",
    originalTerm: "Blossoms",
    lemmaSource: "dictionary",
    ...input,
  }
}

beforeEach(() => {
  Dexie.dependencies.indexedDB = indexedDB
  Dexie.dependencies.IDBKeyRange = IDBKeyRange
  repository = new PersonalVocabularyRepository(databaseName)
})

afterEach(async () => {
  repository.close()
  await Dexie.delete(databaseName)
})

describe("personal vocabulary repository", () => {
  it("saves normalized terms and preserves the original selection, definition and source", async () => {
    const saved = await repository.saveEncounter(
      encounter({
        term: "‘Well‑known’",
        originalTerm: "well‑known",
        definition: { language: "zh-CN", text: "知名的" },
        context: {
          sentence: "The well-known artist visited.",
          source: { url: "https://user:secret@example.com/article?session=private#fragment" },
        },
      }),
    )

    expect(saved).toMatchObject({ created: true, encounterCount: 1 })
    repository.close()
    repository = new PersonalVocabularyRepository(databaseName)
    expect(await repository.getEntryDetail(saved.entryId)).toMatchObject({
      entry: {
        term: "Well-known",
        originalTerm: "well‑known",
        normalizedTerm: "well-known",
        definition: { language: "zh-CN", text: "知名的" },
      },
      contexts: [
        {
          sentence: "The well-known artist visited.",
          source: { url: "https://example.com/article" },
        },
      ],
    })
  })

  it("preserves distinct contexts and counts each save intent once across connections", async () => {
    const secondConnection = new PersonalVocabularyRepository(databaseName)
    try {
      const firstInput = encounter({
        definition: { text: "第一条释义", language: "zh-CN" },
        context: { sentence: "Cherry blossoms fill the garden." },
      })
      const saved = await repository.saveEncounter(firstInput)
      const [retry, again] = await Promise.all([
        secondConnection.saveEncounter(firstInput),
        repository.saveEncounter(
          encounter({
            term: "BLOSSOM",
            definition: { text: "另一条释义", language: "zh-CN" },
            context: { sentence: "The blossoms opened at dawn." },
          }),
        ),
      ])
      expect(retry).toEqual(saved)
      expect(again).toEqual({ entryId: saved.entryId, created: false, encounterCount: 2 })
      await secondConnection.saveEncounter(
        encounter({
          context: { sentence: "The blossoms opened at dawn." },
        }),
      )

      const detail = await repository.getEntryDetail(saved.entryId)
      expect(detail?.entry.encounterCount).toBe(3)
      expect(detail?.entry.definition?.text).toBe("第一条释义")
      expect(detail?.contexts).toHaveLength(2)
      expect((await repository.listEntries()).total).toBe(1)
    } finally {
      secondConnection.close()
    }
  })

  it("serializes concurrent first writes to one entry", async () => {
    const secondConnection = new PersonalVocabularyRepository(databaseName)
    try {
      const results = await Promise.all([
        repository.saveEncounter(encounter()),
        secondConnection.saveEncounter(encounter({ term: "BLOSSOM" })),
      ])
      expect(new Set(results.map(({ entryId }) => entryId)).size).toBe(1)
      expect(results.map(({ encounterCount }) => encounterCount).sort((a, b) => a - b)).toEqual([
        1, 2,
      ])
      expect((await repository.listEntries()).total).toBe(1)
    } finally {
      secondConnection.close()
    }
  })

  it("upgrades a raw-form entry and resolves later offline lookups to a unique known form", async () => {
    const raw = { term: "blossoms", originalTerm: "Blossoms", lemmaSource: "selection" as const }
    const fallback = await repository.saveEncounter(encounter(raw))
    const enriched = await repository.saveEncounter(encounter())
    expect(enriched.entryId).toBe(fallback.entryId)
    expect(await repository.findByTerm(raw)).toEqual({ entryId: enriched.entryId })
    expect(await repository.getEntryDetail(fallback.entryId)).toMatchObject({
      entry: { term: "blossom", originalTerm: "Blossoms", encounterCount: 2 },
    })
  })

  it("keeps distinct lemmas when an original form could refer to either", async () => {
    await repository.saveEncounter(encounter({ term: "see", originalTerm: "saw" }))
    const noun = await repository.saveEncounter(encounter({ term: "saw", originalTerm: "saw" }))
    const nounAgain = await repository.saveEncounter(
      encounter({ term: "saw", originalTerm: "saw" }),
    )
    expect(nounAgain.entryId).toBe(noun.entryId)
    expect((await repository.listEntries()).total).toBe(2)
  })

  it("paginates consistently when update times match", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_750_000_000_000)
    try {
      for (let i = 0; i < 41; i++) {
        await repository.saveEncounter(encounter({ term: `term ${i}`, originalTerm: `term ${i}` }))
      }

      const first = await repository.listEntries()
      expect(first.entries).toHaveLength(40)
      expect(first.nextCursor).toBeDefined()
      const last = await repository.listEntries(first.nextCursor)
      const ids = [...first.entries, ...last.entries].map(({ id }) => id)
      expect(new Set(ids).size).toBe(41)
      expect(last.nextCursor).toBeUndefined()
      expect(last.total).toBe(41)
    } finally {
      now.mockRestore()
    }
  })

  it("rejects invalid source URLs without creating an entry", async () => {
    await expect(
      repository.saveEncounter(
        encounter({
          context: { source: { url: "javascript:alert(1)" } },
        }),
      ),
    ).rejects.toThrow("Invalid source URL")
    expect((await repository.listEntries()).total).toBe(0)
  })
})
