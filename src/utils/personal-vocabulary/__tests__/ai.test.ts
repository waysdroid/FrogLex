import type { LLMProviderConfig } from "@/types/config/provider"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { generateVocabularyField, getVocabularyPrompt, saveVocabularyPrompt } from "../ai"

const mocked = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(),
  removeItem: vi.fn<(key: string) => Promise<void>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
  stream: vi.fn<(...args: unknown[]) => Promise<{ output: Record<string, unknown> }>>(),
}))

vi.mock("#imports", () => ({ storage: mocked }))
vi.mock("wxt/utils/storage", () => ({ storage: mocked }))
vi.mock("@/utils/content-script/background-stream-client", () => ({
  streamBackgroundStructuredObject: mocked.stream,
}))

const provider = {
  id: "personal-provider",
  name: "Personal model",
  enabled: true,
  provider: "openai-compatible",
  apiKey: "test-key",
  baseURL: "https://example.com/v1",
  model: { model: "use-custom-model", isCustomModel: true, customModel: "study-model" },
} satisfies LLMProviderConfig

const request = {
  field: "collocations",
  term: "describe",
  partOfSpeech: "verb",
  provider,
  signal: new AbortController().signal,
} as const

beforeEach(() => {
  vi.resetAllMocks()
  mocked.getItem.mockResolvedValue(null)
})

describe("vocabulary enrichment requests", () => {
  it("uses the custom prompt with a single field schema and sends no other vocabulary or credential data", async () => {
    mocked.getItem.mockResolvedValueOnce("Only include two reusable patterns.")
    mocked.stream.mockResolvedValueOnce({ output: { collocations: "describe in detail" } })
    expect(await generateVocabularyField(request)).toBe("describe in detail")
    expect(mocked.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: provider.id,
        instructions: expect.stringContaining("Only include two reusable patterns."),
        prompt: JSON.stringify({ term: "describe", partOfSpeech: "verb" }),
        outputSchema: [{ name: "collocations", type: "string" }],
      }),
      { signal: request.signal },
    )
    expect(JSON.stringify(mocked.stream.mock.calls[0]?.[0])).not.toContain("test-key")
  })

  it("accepts a missing antonym and rejects oversized suggestions", async () => {
    mocked.stream.mockResolvedValueOnce({ output: { antonyms: null } })
    expect(await generateVocabularyField({ ...request, field: "antonyms" })).toBeNull()
    mocked.stream.mockResolvedValueOnce({ output: { collocations: "x".repeat(3001) } })
    await expect(generateVocabularyField(request)).rejects.toThrow("Invalid vocabulary AI output")
  })

  it("stores prompts under distinct local keys and uses the default when cleared", async () => {
    await saveVocabularyPrompt("examples", "My examples instructions")
    expect(mocked.setItem).toHaveBeenCalledWith(
      "local:personal-vocabulary-prompt-examples",
      "My examples instructions",
    )
    await saveVocabularyPrompt("synonyms", "")
    expect(mocked.removeItem).toHaveBeenCalledWith("local:personal-vocabulary-prompt-synonyms")
    expect(await getVocabularyPrompt("synonyms")).toBe("personalVocabulary.ai.prompts.synonyms")
  })
})
