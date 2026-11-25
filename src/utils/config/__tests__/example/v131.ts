import type { TestSeriesObject } from "./types"
import { testSeries as previous } from "./v130"

// The earlier fixtures are frozen. Their account-only fields are absent in v131.
export const testSeries: TestSeriesObject = Object.fromEntries(
  Object.entries(previous).map(([id, example]) => {
    const config = structuredClone(example.config)
    delete config.builtInAi
    delete config.selectionToolbar.noteSuggestion
    for (const action of [
      ...Object.values<Record<string, unknown>>(config.selectionToolbar.builtInActions),
      ...config.selectionToolbar.customActions,
    ]) {
      delete action.notebaseConnection
      if (action.providerId === "read-frog-ai:gpt-6-luna") {
        action.providerId = "unconfigured-local-ai"
      }
    }
    return [id, { ...example, config }]
  }),
)
