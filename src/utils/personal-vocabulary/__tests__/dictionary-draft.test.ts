import { describe, expect, it } from "vitest"
import { createDefaultDictionaryAction } from "@/utils/constants/config"
import { createVocabularyDraft } from "../dictionary-draft"
import { vocabularySaveSchema } from "../schema"

const action = createDefaultDictionaryAction()

function draft(
  originalTerm: string,
  passage: string,
  result: Record<string, unknown> | null = null,
) {
  return createVocabularyDraft({
    action,
    originalTerm,
    passage,
    result,
    targetLanguage: "zh-CN",
    source: { url: "https://example.com/article", title: "Reading" },
  })
}

function fieldName(id: string) {
  return action.outputSchema.find((field) => field.id === `default-dictionary-${id}`)!.name
}

describe("personal vocabulary dictionary adapter", () => {
  it("saves the exact original sentence with only a matching translation", () => {
    const original = "The cherry blossoms opened early."
    const result = {
      [fieldName("term")]: "blossom",
      [fieldName("definition")]: "花",
      [fieldName("memory-tips")]: "词根词缀：blossom 表示开花。\n搭配：cherry blossom",
      [fieldName("context")]: original,
      [fieldName("context-translation")]: "樱花开早了。",
      [fieldName("difficulty")]: "B2",
    }

    expect(
      draft("blossoms", `It was still March. ${original} We took a walk.`, result),
    ).toMatchObject({
      term: "blossom",
      originalTerm: "blossoms",
      lemmaSource: "dictionary",
      definition: { text: "花", language: "zh-CN" },
      memoryTips: "词根词缀：blossom 表示开花。\n搭配：cherry blossom",
      difficulty: "B2",
      context: { sentence: original, translation: { text: "樱花开早了。", language: "zh-CN" } },
    })
    const mismatched = draft("blossoms", original, {
      ...result,
      [fieldName("context")]: "The blossoms bloomed.",
    })
    expect(mismatched?.context?.sentence).toBe(original)
    expect(mismatched?.context?.translation).toBeUndefined()
  })

  it("omits absent, empty or malformed memory tips", () => {
    for (const value of [undefined, "   ", ["tip"], "x".repeat(3001)]) {
      expect(
        draft("blossom", "The blossoms opened.", {
          [fieldName("memory-tips")]: value,
        })?.memoryTips,
      ).toBeUndefined()
    }
  })

  it("keeps the selected phrase and readable context when the model provides no result", () => {
    const fallback = draft("“Take care”", "Take care on the way home.")

    expect(fallback).toMatchObject({
      term: "Take care",
      originalTerm: "“Take care”",
      lemmaSource: "selection",
      context: { sentence: "Take care on the way home." },
    })
    expect(
      vocabularySaveSchema.safeParse({ ...fallback, operationId: crypto.randomUUID() }).success,
    ).toBe(true)
  })

  it("leaves out ambiguous passages, partial-word matches and selected-text-only context", () => {
    expect(draft("set", "I set up the room. She set the table.")?.context?.sentence).toBeUndefined()
    expect(draft("set", "The sunset was beautiful.")?.context?.sentence).toBeUndefined()
    expect(draft("set", "set")?.context?.sentence).toBeUndefined()
  })

  it("rejects selections in another script", () => {
    expect(draft("中文", "中文段落。")).toBeNull()
  })
})
