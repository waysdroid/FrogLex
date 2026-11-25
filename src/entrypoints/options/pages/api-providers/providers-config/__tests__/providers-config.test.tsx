// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { cloneElement } from "react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProvidersConfig } from "@/entrypoints/options/pages/api-providers/providers-config"
import { LUNA_PROVIDER_ID, testHostedAiModels } from "@/utils/hosted-ai/__tests__/test-models"
import { sanitizeHostedAiModels } from "@/utils/hosted-ai/models"
import { DEFAULT_BUILT_IN_AI_PROVIDER_ID } from "@/utils/providers/provider-registry"

const {
  anchoredToastAddMock,
  configAtom,
  highlightedProviderFieldAtom,
  providerWriteAtom,
  providersAtom,
  selectedProviderIdAtom,
  setProviderConfigMock,
  testState,
  writeConfigMock,
  writeConfigAtom,
} = vi.hoisted(() => ({
  anchoredToastAddMock: vi.fn<(options: unknown) => void>(),
  configAtom: {},
  highlightedProviderFieldAtom: {},
  providerWriteAtom: {},
  providersAtom: {},
  selectedProviderIdAtom: {},
  setProviderConfigMock: vi.fn<(value: unknown) => void>(),
  testState: { selectedProviderId: "provider-1" },
  writeConfigMock: vi.fn<(value: unknown) => void>(),
  writeConfigAtom: {},
}))

const providerConfig = {
  enabled: true,
  id: "provider-1",
  name: "Long Provider Name",
  provider: "openai",
}

const config = {
  builtInAi: { models: {} as Record<string, { reasoning?: string }> },
  languageDetection: { mode: "basic", providerId: undefined as string | undefined },
  providersConfig: [providerConfig],
  selectionToolbar: { customActions: [] },
}

vi.mock("jotai", () => ({
  useAtom: (atom: object) => {
    if (atom === providersAtom) return [[providerConfig], vi.fn<(value: unknown) => void>()]
    if (atom === selectedProviderIdAtom)
      return [
        testState.selectedProviderId,
        (value: string) => {
          testState.selectedProviderId = value
        },
      ]
    return [undefined, vi.fn<(value: unknown) => void>()]
  },
  useAtomValue: (atom: object) => {
    if (atom === selectedProviderIdAtom) return testState.selectedProviderId
    if (atom === configAtom) return config
    if (atom === providersAtom) return [providerConfig]
    return undefined
  },
  useSetAtom: (atom: object) => {
    if (atom === providerWriteAtom) return setProviderConfigMock
    if (atom === writeConfigAtom) return writeConfigMock
    if (atom === selectedProviderIdAtom)
      return (value: string) => {
        testState.selectedProviderId = value
      }
    return vi.fn<(value: unknown) => void>()
  },
}))

vi.mock("@/components/provider-icon", () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
  normalizeLogoUrl: (logo: string) => logo,
}))

vi.mock("@/components/providers/theme-provider", () => ({
  useTheme: () => ({ theme: "light" }),
}))

vi.mock("@/components/sortable-list", () => ({
  SortableList: ({
    list,
    renderItem,
  }: {
    list: (typeof providerConfig)[]
    renderItem: (item: typeof providerConfig) => ReactNode
  }) => <>{list.map(renderItem)}</>,
}))

vi.mock("@/components/ui/base-ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}))

vi.mock("@/components/ui/base-ui/toast", () => ({
  anchoredToastManager: { add: anchoredToastAddMock },
}))

vi.mock("@/components/ui/base-ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  // Keep hover-only content out of the tree so editor-panel assertions do not
  // collide with the assignment names repeated inside card badges.
  TooltipContent: () => null,
  // Renders the element a trigger names, so a trigger's own role and name stay
  // queryable, as with base-ui.
  TooltipTrigger: ({
    children,
    render: element,
  }: {
    children?: ReactNode
    render?: ReactElement
  }) =>
    element
      ? children === undefined
        ? element
        : cloneElement(element, undefined, children)
      : children,
}))

vi.mock("@/utils/atoms/config", () => ({
  configAtom,
  configFieldsAtomMap: { providersConfig: providersAtom },
  writeConfigAtom,
}))

vi.mock("@/utils/atoms/entity-config", () => ({
  patchProviderConfigAtom: providerWriteAtom,
}))

vi.mock("@/utils/config/helpers", () => ({
  getAPIProvidersConfig: (providers: unknown[]) => providers,
  getProviderConfigById: (providers: (typeof providerConfig)[], id: string) =>
    providers.find((provider) => provider.id === id),
}))

vi.mock("@/utils/constants/feature-providers", () => ({
  FEATURE_KEYS: [
    "pageTranslation",
    "videoSubtitles",
    "selectionTranslation",
    "inputTranslation",
    "noteSuggestion",
  ],
  FEATURE_PROVIDER_DEFS: {
    pageTranslation: { getProviderId: () => providerConfig.id },
    selectionTranslation: { getProviderId: () => "unassigned-provider" },
    // Mirrors the shipped default: note suggestion runs on the OpenAI default
    // provider, so no built-in card starts with a feature assignment.
    noteSuggestion: { getProviderId: () => "openai-default" },
    // Both default to Microsoft, so neither starts assigned to a built-in.
    videoSubtitles: { getProviderId: () => "microsoft-translate-default" },
    inputTranslation: { getProviderId: () => "microsoft-translate-default" },
  },
  buildFeatureProviderPatch: () => ({}),
  getFeatureLabelI18nKey: (key: string) => `feature.${key}`,
}))

// The built-in panel gates Ultra assignment rows on the live plan; tests set
// hostedAiState.value per case (default: settled error, i.e. status unknown).
const { hostedAiState } = vi.hoisted(() => {
  const state: { value: { status: unknown; isPending: boolean; isError: boolean } } = {
    value: { status: undefined, isPending: false, isError: true },
  }
  return { hostedAiState: state }
})

vi.mock("@/components/llm-providers/use-hosted-ai-status", () => ({
  useHostedAiStatus: () => hostedAiState.value,
}))

// The model list the cards come from: the last one the extension saw, which
// tests set per case (default: the full catalog).
const { builtInAiModelsState } = vi.hoisted(() => {
  const state: { models: unknown } = { models: null }
  return { builtInAiModelsState: state }
})

vi.mock("@/components/llm-providers/use-built-in-ai-models", () => ({
  useBuiltInAiModels: () => ({ models: builtInAiModelsState.models, isLive: true }),
}))

/** Must mirror the built-in hosted assignment rows, except dynamic custom actions. */

vi.mock("@/utils/i18n", () => ({
  i18n: {
    t: (key: string, values?: Array<string | number>) =>
      values ? `${key}:${values.join("|")}` : key,
  },
  formatUiAlternatives: (items: readonly string[]) => items.join(" or "),
}))

vi.mock("@/entrypoints/options/components/config-item", () => ({
  ConfigItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/entrypoints/options/components/entity-editor-layout", () => ({
  EntityEditorLayout: ({ list, editor }: { list: ReactNode; editor: ReactNode }) => (
    <>
      {list}
      {editor}
    </>
  ),
}))

vi.mock("@/entrypoints/options/components/entity-list-rail", () => ({
  EntityListRail: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/entrypoints/options/pages/api-providers/providers-config/add-provider-dialog", () => ({
  default: () => null,
}))

vi.mock("@/entrypoints/options/pages/api-providers/providers-config/atoms", () => ({
  highlightedProviderFieldAtom,
  PROVIDER_FIELD_HIGHLIGHT_DURATION_MS: 2700,
  selectedProviderIdAtom,
}))

vi.mock("@/entrypoints/options/pages/api-providers/providers-config/provider-config-form", () => ({
  ProviderConfigForm: () => null,
}))

// `ProvidersConfig` reads the location to honour a `?provider=` deep link.
function renderProvidersConfig(initialEntry = "/api-providers") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ProvidersConfig />
    </MemoryRouter>,
  )
}

/** Opens the reasoning select, picks `optionText`, and returns every option's text as listed. */

describe("ProvidersConfig", () => {
  beforeEach(() => {
    anchoredToastAddMock.mockReset()
    setProviderConfigMock.mockReset()
    writeConfigMock.mockReset()
    testState.selectedProviderId = providerConfig.id
    config.languageDetection = { mode: "basic", providerId: undefined }
    config.builtInAi = { models: {} }
    hostedAiState.value = { status: undefined, isPending: false, isError: true }
    builtInAiModelsState.models = sanitizeHostedAiModels(testHostedAiModels())
  })

  it("anchors an in-use disable error to the corresponding provider switch", () => {
    renderProvidersConfig()

    const providerSwitch = screen.getByRole("switch", { name: providerConfig.name })
    fireEvent.click(providerSwitch)

    expect(setProviderConfigMock).not.toHaveBeenCalled()
    expect(anchoredToastAddMock).toHaveBeenCalledWith({
      id: "provider-disable-provider-1",
      positionerProps: { anchor: providerSwitch, sideOffset: 6 },
      title: "options.apiProviders.form.providerInUseCannotDisable:Long Provider Name|1",
      type: "error",
    })
  })

  it("opens the provider a ?provider= deep link names", () => {
    testState.selectedProviderId = DEFAULT_BUILT_IN_AI_PROVIDER_ID

    renderProvidersConfig(`/api-providers?provider=${providerConfig.id}`)

    expect(testState.selectedProviderId).toBe(providerConfig.id)
  })

  it("keeps the current selection when the deep link names an unknown provider", () => {
    testState.selectedProviderId = DEFAULT_BUILT_IN_AI_PROVIDER_ID

    renderProvidersConfig("/api-providers?provider=deleted-provider")

    expect(testState.selectedProviderId).toBe(DEFAULT_BUILT_IN_AI_PROVIDER_ID)
  })

  it("does not call a model unavailable before any list has been seen", () => {
    builtInAiModelsState.models = null
    config.languageDetection = { mode: "llm", providerId: "read-frog-ai:gpt-5-mini" }

    renderProvidersConfig()

    expect(screen.queryByRole("img", { name: /hostedAi\.unavailable/ })).not.toBeInTheDocument()
  })

  it("shows no unavailable alert for a model that can run", () => {
    testState.selectedProviderId = LUNA_PROVIDER_ID

    renderProvidersConfig()

    expect(
      screen.queryByText(/options\.apiProviders\.builtInModel\.unavailableTitle/),
    ).not.toBeInTheDocument()
  })
})
