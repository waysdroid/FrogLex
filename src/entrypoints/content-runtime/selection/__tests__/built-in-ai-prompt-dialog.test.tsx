// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  closeBuiltInAiPrompt,
  openBuiltInAiPrompt,
} from "@/utils/content-runtime/built-in-ai-prompt"
import { BuiltInAiPromptDialog } from "../built-in-ai-prompt-dialog"

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/message", () => ({ sendMessage: mockSendMessage }))

function openUpgradePrompt() {
  act(() => {
    openBuiltInAiPrompt({
      kind: "upgrade",
      plan: "free",
      feature: "pageTranslation",
      analyticsFeature: "page_translation",
      trigger: "auto",
    })
  })
}

describe("BuiltInAiPromptDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage.mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => closeBuiltInAiPrompt())
  })

  it("opens pricing without feature attribution", () => {
    render(<BuiltInAiPromptDialog />)
    openUpgradePrompt()

    fireEvent.click(screen.getByRole("button", { name: "action.upgrade" }))

    const [, { url }] = mockSendMessage.mock.calls.find(([type]) => type === "openPage")!
    expect(new URL(url).searchParams.get("feature")).toBe(null)
  })

  it("closes the dialog on Escape", () => {
    render(<BuiltInAiPromptDialog />)
    openUpgradePrompt()

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
