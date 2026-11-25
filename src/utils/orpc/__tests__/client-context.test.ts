import { describe, expect, it } from "vitest"
import { buildExtensionORPCHeaders } from "../client-context"

describe("buildExtensionORPCHeaders", () => {
  it("only sends the protocol's static extension header", () => {
    expect(buildExtensionORPCHeaders()).toEqual({ "x-orpc-source": "extension" })
  })
})
