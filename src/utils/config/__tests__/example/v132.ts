import type { TestSeriesObject } from "./types"
import { testSeries as previous } from "./v131"

export const testSeries: TestSeriesObject = Object.fromEntries(
  Object.entries(previous).map(([id, example]) => {
    const config = structuredClone(example.config)
    config.providersConfig = config.providersConfig.filter(
      (provider: { provider: string }) =>
        !["jalapenocloud", "ifapi", "atlascloud"].includes(provider.provider),
    )
    return [id, { ...example, config }]
  }),
)

export const configExample = testSeries["complex-config-from-v020"]!.config
