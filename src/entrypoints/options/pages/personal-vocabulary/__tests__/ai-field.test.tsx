// @vitest-environment jsdom
import type { ComponentProps } from "react"
import type { LLMProviderConfig } from "@/types/config/provider"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { VocabularyAiField } from "../ai-field"

const mocked = vi.hoisted(() => ({
  generate: vi.fn<(...args: unknown[]) => Promise<string | null>>(),
  loadPrompt: vi.fn<(...args: unknown[]) => Promise<string>>(),
  savePrompt: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock("@/utils/personal-vocabulary/ai", () => ({
  generateVocabularyField: mocked.generate,
  getVocabularyPrompt: mocked.loadPrompt,
  saveVocabularyPrompt: mocked.savePrompt,
  defaultVocabularyPrompt: () => "Built-in prompt",
  MAX_VOCABULARY_PROMPT_LENGTH: 4000,
}))

const provider = {
  id: "test-provider",
  name: "Test model",
  provider: "openai-compatible",
  enabled: true,
  baseURL: "https://example.com/v1",
  model: { model: "use-custom-model", isCustomModel: true, customModel: "study-model" },
} satisfies LLMProviderConfig

type Field = ComponentProps<typeof VocabularyAiField>
function Fixture({
  getInput,
  undo: initialUndo,
}: {
  getInput: Field["getInput"]
  undo?: Field["undo"]
}) {
  const [undo, setUndo] = useState(initialUndo)
  return (
    <VocabularyAiField
      field="examples"
      provider={provider}
      initialValue={initialUndo?.after ?? "Manual example"}
      maxLength={3000}
      getInput={getInput}
      undo={undo}
      onUndoChange={setUndo}
    />
  )
}

const getInput = () => ({ term: "describe", partOfSpeech: "verb" })
const generate = () =>
  fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.ai.generateField" }))

describe("vocabulary AI fields", () => {
  it("keeps manual text during review, appends only after confirmation and can undo", async () => {
    mocked.generate.mockResolvedValueOnce("They describe the scene.")
    render(<Fixture getInput={getInput} />)
    const field = screen.getByRole("textbox", { name: "personalVocabulary.fields.examples" })
    generate()
    expect(await screen.findByText("They describe the scene.")).toBeInTheDocument()
    expect(field).toHaveValue("Manual example")
    fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.ai.apply" }))
    expect(field).toHaveValue("Manual example\n\nThey describe the scene.")
    fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.ai.undo" }))
    expect(field).toHaveValue("Manual example")
  })

  it("can undo a saved addition but protects subsequent manual edits", () => {
    const undo = { before: "Manual example", after: "Manual example\n\nAI example" }
    render(<Fixture getInput={getInput} undo={undo} />)
    const field = screen.getByRole("textbox", { name: "personalVocabulary.fields.examples" })
    const undoButton = screen.getByRole("button", { name: "personalVocabulary.ai.undo" })
    expect(undoButton).toBeEnabled()
    fireEvent.change(field, { target: { value: "My newer example\n\nAI example" } })
    expect(undoButton).toBeEnabled()
    fireEvent.change(field, { target: { value: "My newer example" } })
    expect(undoButton).toBeDisabled()
    expect(field).toHaveValue("My newer example")
  })

  it("saves a prompt for the specific field", async () => {
    mocked.loadPrompt.mockResolvedValueOnce("Current prompt")
    mocked.savePrompt.mockResolvedValueOnce(undefined)
    render(<Fixture getInput={getInput} />)
    fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.ai.promptTitle" }))
    const prompt = await screen.findByRole("textbox", { name: "personalVocabulary.ai.prompt" })
    await waitFor(() => expect(prompt).toHaveValue("Current prompt"))
    fireEvent.change(prompt, { target: { value: "My example prompt" } })
    fireEvent.click(screen.getByRole("button", { name: "personalVocabulary.ai.savePrompt" }))
    await waitFor(() =>
      expect(mocked.savePrompt).toHaveBeenCalledWith("examples", "My example prompt"),
    )
  })
})
