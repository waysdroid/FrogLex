// @vitest-environment jsdom
import type { VocabularyEntry } from "@/utils/personal-vocabulary/records"
import type { PersonalVocabularyRepository } from "@/utils/personal-vocabulary/repository"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { PersonalVocabularyPage } from "../index"

const repository = vi.hoisted(() => ({
  getEntryDetail: vi.fn<PersonalVocabularyRepository["getEntryDetail"]>(),
  getOrganization: async () => ({ collections: [], tags: [] }),
  getMembership: async () => ({ collectionIds: [], tagIds: [] }),
}))

vi.mock("@/utils/personal-vocabulary/repository", () => ({
  personalVocabularyRepository: repository,
}))

const entry = {
  id: "entry",
  language: "en",
  normalizedTerm: "describe",
  term: "describe",
  originalTerm: "describe",
  lemmaSource: "dictionary",
  encounterCount: 1,
  createdAt: 1,
  updatedAt: 1,
  definition: { language: "zh-CN", text: "描述" },
  meaningsZh: "描述",
  meaningsEn: "Say what something is like, often by giving details.",
  memoryTips: "Think of describing a scene in a story.",
  synonyms: "depict",
  antonyms: "omit",
  derivatives: "description, descriptive",
  collocations: "describe in detail",
  examples: "Describe what happened next.",
} satisfies VocabularyEntry

function renderDetail() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/personal-vocabulary?entry=entry"]}>
        <PersonalVocabularyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("vocabulary detail layout", () => {
  it("keeps definitions and word relations in order and groups usage even without saved contexts", async () => {
    repository.getEntryDetail.mockResolvedValueOnce({ entry, contexts: [] })
    renderDetail()

    const term = await screen.findByRole("heading", { name: "describe" })
    const main = term.closest("section")!
    expect([...main.querySelectorAll("dt")].map((label) => label.textContent)).toEqual([
      "personalVocabulary.fields.meaningsZh",
      "personalVocabulary.fields.meaningsEn",
      "personalVocabulary.fields.memoryTips",
      "personalVocabulary.fields.synonyms",
      "personalVocabulary.fields.antonyms",
      "personalVocabulary.fields.derivatives",
    ])
    expect(within(main).getAllByText("描述")).toHaveLength(1)
    const reading = screen
      .getByRole("heading", { name: "personalVocabulary.contexts" })
      .closest("section")!
    expect([...reading.querySelectorAll("dt")].map((label) => label.textContent)).toEqual([
      "personalVocabulary.fields.collocations",
      "personalVocabulary.fields.examples",
    ])
    expect(within(reading).getByText("personalVocabulary.addContext")).toBeInTheDocument()
  })

  it("shows the original sentence, labeled meaning and translation, and source with usage", async () => {
    repository.getEntryDetail.mockResolvedValueOnce({
      entry,
      contexts: [
        {
          id: "context",
          entryId: entry.id,
          fingerprint: "reading-context",
          createdAt: 1,
          originalTerm: "describe",
          sentence: "Describe the view from the window.",
          meaning: { language: "zh-CN", text: "描绘" },
          translation: { language: "zh-CN", text: "描述一下窗外的景色。" },
          source: { title: "Reading", url: "https://example.com/reading" },
        },
      ],
    })
    renderDetail()

    const heading = await screen.findByRole("heading", { name: "personalVocabulary.contexts" })
    const reading = within(heading.closest("section")!)
    expect(reading.getByText("describe in detail")).toBeInTheDocument()
    expect(reading.getByText("Describe what happened next.")).toBeInTheDocument()
    const sentence = reading.getByText("Describe the view from the window.")
    expect(sentence.tagName).toBe("BLOCKQUOTE")
    const saved = within(sentence.closest("li")!)
    expect(saved.getByText("personalVocabulary.fields.contextMeaning")).toBeInTheDocument()
    expect(saved.getByText("personalVocabulary.fields.sentenceTranslation")).toBeInTheDocument()
    expect(saved.getByRole("link", { name: "Reading" })).toHaveAttribute(
      "href",
      "https://example.com/reading",
    )
  })
})
