// @vitest-environment jsdom
import type { VocabularyDraft } from "@/utils/personal-vocabulary/schema"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SaveToPersonalVocabulary } from "../save-to-personal-vocabulary"

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn<(type: string, data?: unknown) => Promise<unknown>>(),
}))

vi.mock("@/utils/message", () => ({ sendMessage }))

const entryId = "1ecb31ba-d0bb-4c53-962d-aa71ce563cbc"
const operationId = "f0ef9207-78fe-476a-b612-852e54e2a2ca"
const draft: VocabularyDraft = {
  term: "blossoms",
  originalTerm: "Blossoms",
  lemmaSource: "selection",
  context: {
    sentence: "The cherry blossoms opened early.",
    source: { title: "Reading", url: "https://example.com/article" },
  },
}

beforeEach(() => {
  sendMessage.mockReset()
  sendMessage.mockImplementation(async (type) => {
    if (type === "findPersonalVocabularyEntry") return { ok: true, value: null }
    if (type === "savePersonalVocabularyEncounter") {
      return { ok: true, value: { created: true, encounterCount: 1, entryId } }
    }
    return undefined
  })
})

afterEach(cleanup)

describe("save to personal vocabulary", () => {
  it("saves before a dictionary result arrives and opens the saved entry", async () => {
    render(
      <SaveToPersonalVocabulary
        draft={draft}
        operationId={operationId}
        targetLanguage="zh-CN"
        waitingForDictionary
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.saveSelection" }))
    expect(await screen.findByRole("status")).toHaveTextContent("personalVocabulary.saved")
    expect(sendMessage).toHaveBeenCalledWith("savePersonalVocabularyEncounter", {
      ...draft,
      operationId,
    })

    fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.viewEntry" }))
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith("openOptionsPage", {
        route: `/personal-vocabulary?entry=${entryId}`,
      }),
    )
  })

  it("saves the edited base form and definition, and allows omitting the source", async () => {
    render(
      <SaveToPersonalVocabulary
        draft={draft}
        operationId={operationId}
        targetLanguage="zh-CN"
        waitingForDictionary={false}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.preview" }))
    fireEvent.change(await screen.findByRole("textbox", { name: "personalVocabulary.term" }), {
      target: { value: "blossom" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "personalVocabulary.definition" }), {
      target: { value: "花朵" },
    })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.confirm" }))

    expect(await screen.findByRole("status")).toHaveTextContent("personalVocabulary.saved")
    expect(sendMessage).toHaveBeenCalledWith("savePersonalVocabularyEncounter", {
      ...draft,
      operationId,
      term: "blossom",
      lemmaSource: "user",
      definition: { language: "zh-CN", text: "花朵" },
      context: { sentence: "The cherry blossoms opened early.", source: undefined },
    })
  })
})
