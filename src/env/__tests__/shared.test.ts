import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  createExtensionClientEnvSchema,
  isLocalPackagesEnabled,
  LOCAL_EXTENSION_ENV_DEFAULTS,
  PRODUCTION_EXTENSION_ENV_DEFAULTS,
  resolveExtensionEnv,
} from "../shared"

const schema = z.object(createExtensionClientEnvSchema(true))

describe("personal edition extension environment", () => {
  it("accepts production defaults without official API or login configuration", () => {
    const env = schema.parse(resolveExtensionEnv({}))
    expect(env.WXT_WEBSITE_URL).toBe(PRODUCTION_EXTENSION_ENV_DEFAULTS.WXT_WEBSITE_URL)
    expect(env).not.toHaveProperty("WXT_API_URL")
    expect(env).not.toHaveProperty("WXT_GOOGLE_CLIENT_ID")
  })

  it("validates public website and origin overrides", () => {
    expect(
      schema.safeParse(resolveExtensionEnv({ WXT_WEBSITE_URL: "https://example.org/" })).success,
    ).toBe(false)
    expect(
      schema.safeParse(
        resolveExtensionEnv({ WXT_OFFICIAL_SITE_ORIGINS: "https://example.org/path" }),
      ).success,
    ).toBe(false)
  })

  it("uses local development defaults when requested", () => {
    expect(isLocalPackagesEnabled({ WXT_USE_LOCAL_PACKAGES: "true" })).toBe(true)
    expect(isLocalPackagesEnabled({ WXT_USE_LOCAL_PACKAGES: "false" })).toBe(false)
    expect(resolveExtensionEnv({ WXT_USE_LOCAL_PACKAGES: "true" }).WXT_WEBSITE_URL).toBe(
      LOCAL_EXTENSION_ENV_DEFAULTS.WXT_WEBSITE_URL,
    )
  })
})
