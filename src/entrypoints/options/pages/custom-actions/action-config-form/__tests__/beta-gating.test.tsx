// @vitest-environment jsdom
import type { ReactNode } from "react"
import type { Config as SeedConfig } from "@/types/config/config"
import type { Config } from "@/types/config/config"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import { configAtom } from "@/utils/atoms/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { i18n } from "@/utils/i18n"
import { CustomActionConfigForm } from ".."
import { selectedCustomActionIdAtom } from "../../atoms"

vi.mock("@/components/form/quick-insertable-textarea-field-auto-save", () => ({
  QuickInsertableTextareaFieldAutoSave: ({
    label,
    readOnly,
  }: {
    label: string
    readOnly?: boolean
  }) => <div>{`${label}:${readOnly ? "readOnly" : "editable"}`}</div>,
}))

vi.mock("../name-field", () => ({
  NameField: ({ readOnly, labelExtra }: { readOnly: boolean; labelExtra?: ReactNode }) => (
    <div>
      {`NameField:${readOnly ? "readOnly" : "editable"}`}
      {labelExtra}
    </div>
  ),
}))

vi.mock("../icon-field", () => ({
  IconField: ({ readOnly }: { readOnly: boolean }) => (
    <div>{`IconField:${readOnly ? "readOnly" : "editable"}`}</div>
  ),
}))

vi.mock("../provider-field", () => ({
  ProviderField: () => <div>ProviderField</div>,
}))

vi.mock("../output-schema-field", () => ({
  OutputSchemaField: () => <div>OutputSchemaField</div>,
  ReadOnlyOutputSchemaField: () => <div>ReadOnlyOutputSchemaField</div>,
}))

// The layout editor and preview (CodeMirror, shadow DOM) are verified in a browser.
vi.mock("../layout-field", () => ({
  LayoutField: () => <div>LayoutField</div>,
  ReadOnlyLayoutField: () => <div>ReadOnlyLayoutField</div>,
}))

const AI_CONFIG_HELPER_TRIGGER = i18n.t(
  "options.selectionToolbar.customActions.form.aiConfigHelper.trigger",
)

function seedConfig(store: ReturnType<typeof createStore>, config: SeedConfig) {
  void fakeBrowser.storage.local.set({ config })
  store.set(configAtom, config)
}

function cloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config
}

describe("custom action configuration", () => {
  it("explains that customizing creates an editable built-in action copy", async () => {
    const store = createStore()
    seedConfig(store, cloneConfig(DEFAULT_CONFIG))

    render(
      <Provider store={store}>
        <TooltipProvider>
          <CustomActionConfigForm />
        </TooltipProvider>
      </Provider>,
    )

    const customizeButton = screen.getByRole("button", {
      name: i18n.t("options.selectionToolbar.customActions.form.customize"),
    })
    fireEvent.mouseEnter(customizeButton)
    fireEvent.focus(customizeButton)

    await waitFor(() =>
      expect(document.querySelector("[data-slot='tooltip-content']")).toHaveTextContent(
        i18n.t("options.selectionToolbar.customActions.form.customizeTooltip"),
      ),
    )
  })

  it("copies a prompt carrying the custom action's current settings", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })

    const store = createStore()
    const config = cloneConfig(DEFAULT_CONFIG)
    const action = {
      id: "action-1",
      name: "Summarize",
      icon: "tabler:sparkles",
      enabled: true,
      providerId: config.selectionToolbar.builtInActions.dictionary.providerId,
      systemPrompt: "You are helpful.",
      prompt: "Summarize {{selection}}.",
      outputSchema: [
        { id: "summary-field", name: "summary", type: "string" as const, description: "" },
      ],
    }
    config.selectionToolbar.customActions = [action, { ...action, id: "action-2", name: "Explain" }]
    seedConfig(store, config)
    void store.set(selectedCustomActionIdAtom, action.id)

    render(
      <Provider store={store}>
        <CustomActionConfigForm />
      </Provider>,
    )

    fireEvent.click(screen.getByRole("button", { name: AI_CONFIG_HELPER_TRIGGER }))
    fireEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("options.selectionToolbar.customActions.form.aiConfigHelper.copy"),
      }),
    )

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const prompt = writeText.mock.calls[0]![0]
    expect(prompt).toContain("**Name:** `Summarize`")
    expect(prompt).toContain("```text\nSummarize {{selection}}.\n```")
    expect(prompt).toContain("named `Explain`")
    expect(await screen.findByRole("button", { name: i18n.t("action.copied") })).toBeInTheDocument()
  })
})
