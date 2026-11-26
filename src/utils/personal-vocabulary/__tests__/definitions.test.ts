import type { VocabularyEntry } from "../records"
import { describe, expect, it } from "vitest"
import { editVocabularyDefinitions, getVocabularyDefinitions } from "../definitions"

const baseEntry: VocabularyEntry = {
  id: "entry",
  language: "en",
  normalizedTerm: "describe",
  term: "describe",
  originalTerm: "describes",
  lemmaSource: "dictionary",
  encounterCount: 1,
  createdAt: 1,
  updatedAt: 1,
}

describe("vocabulary definitions", () => {
  it("displays matching Chinese definitions once and keeps both stored fields on an unrelated edit", () => {
    const entry = {
      ...baseEntry,
      definition: { text: "描述  细节", language: "zh-CN" },
      meaningsZh: "描述 细节",
    }
    const visible = getVocabularyDefinitions(entry)
    expect(visible).toEqual({
      definition: undefined,
      meaningsZh: "描述 细节",
      meaningsEn: undefined,
    })
    expect(editVocabularyDefinitions(entry, visible)).toMatchObject({
      definition: entry.definition,
      meaningsZh: entry.meaningsZh,
    })
  })

  it("preserves different text in the same language and saves edits as a single definition", () => {
    const entry = {
      ...baseEntry,
      definition: { text: "Give an account of.", language: "en-GB" },
      meaningsEn: "Say what something is like.",
    }
    const visible = getVocabularyDefinitions(entry)
    expect(visible.meaningsEn).toBe("Say what something is like.\n\nGive an account of.")
    const edited = editVocabularyDefinitions(entry, {
      ...visible,
      meaningsEn: "Give details about something.",
    })
    expect(getVocabularyDefinitions({ ...entry, ...edited })).toEqual({
      definition: undefined,
      meaningsEn: "Give details about something.",
      meaningsZh: undefined,
    })
  })

  it("keeps an independently stored definition in another language", () => {
    const entry = {
      ...baseEntry,
      definition: { text: "説明する", language: "ja" },
      meaningsZh: "描述",
    }
    expect(editVocabularyDefinitions(entry, getVocabularyDefinitions(entry))).toEqual({
      definition: entry.definition,
      meaningsZh: entry.meaningsZh,
      meaningsEn: undefined,
    })
  })
})
