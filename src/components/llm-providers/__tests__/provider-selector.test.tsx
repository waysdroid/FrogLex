// @vitest-environment jsdom
import type { ProviderConfig } from "@/types/config/provider"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/base-ui/tooltip"
import { getSelectableProvidersForCapability } from "@/utils/providers/provider-registry"
import ProviderSelector from "../provider-selector"

vi.mock("@/utils/content-script/background-asset-url", () => ({
  resolveContentScriptAssetBlob: vi.fn<(url: string) => Promise<Blob | null>>(),
  shouldProxyAssetUrl: () => false,
}))

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "light" }),
}))

vi.mock("@/utils/i18n", () => ({
  i18n: { t: (key: string) => key },
}))

const configuredProviders: ProviderConfig[] = [
  {
    id: "microsoft-translate-default",
    name: "Microsoft Translator",
    enabled: true,
    provider: "microsoft-translate",
  },
  {
    id: "my-openai",
    name: "My OpenAI",
    enabled: true,
    provider: "openai",
    model: { model: "gpt-5-mini", isCustomModel: false, customModel: null },
  },
]

function renderSelector(
  value: string,
  capability: "pageTranslation" | "customAction" = "pageTranslation",
) {
  const onChange = vi.fn<(id: string) => void>()
  render(
    <TooltipProvider>
      <ProviderSelector
        providers={getSelectableProvidersForCapability(capability, configuredProviders)}
        value={value}
        onChange={onChange}
        placeholder="Pick a provider"
      />
    </TooltipProvider>,
  )
  return onChange
}

async function openMenu() {
  const trigger = screen.getByRole("combobox")
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "click"]) {
      trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }))
    }
  })
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  return screen.findAllByRole("option")
}

describe("personal edition provider selector", () => {
  it("offers configured AI and machine translation without adding official models", async () => {
    renderSelector("microsoft-translate-default")
    expect((await openMenu()).map((option) => option.textContent)).toEqual([
      "Microsoft Translator",
      "My OpenAI",
    ])
  })

  it("lets an unassigned AI action choose a configured provider", async () => {
    const onChange = renderSelector("unconfigured-local-ai", "customAction")
    const [openai] = await openMenu()
    expect(openai).toHaveTextContent("My OpenAI")
    expect(screen.getAllByRole("option")).toHaveLength(1)

    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        openai!.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }))
      }
    })
    expect(onChange).toHaveBeenCalledWith("my-openai")
  })

  it("shows the placeholder for a retired model selection", () => {
    renderSelector("read-frog-ai:old-model")
    expect(screen.getByRole("combobox")).toHaveTextContent("Pick a provider")
  })
})
