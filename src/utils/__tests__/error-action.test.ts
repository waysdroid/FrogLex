import { describe, expect, it } from "vitest"
import { ANALYTICS_FEATURE } from "@/types/analytics"
import { pricingUrl, upgradeAction } from "@/utils/error-action"

describe("pricing links", () => {
  it("uses the pricing page without sending the origin or feature", () => {
    const url = new URL(pricingUrl("extension_quota_exhausted", ANALYTICS_FEATURE.WORD_ANNOTATION))
    expect(url.pathname).toBe("/pricing")
    expect(url.search).toBe("")
  })

  it("keeps the upgrade action and omits attribution", () => {
    const action = upgradeAction("extension_video_quota", ANALYTICS_FEATURE.VIDEO_SUBTITLES)
    expect(action.label).toBe("action.upgrade")
    expect(new URL(action.url).search).toBe("")
  })
})
