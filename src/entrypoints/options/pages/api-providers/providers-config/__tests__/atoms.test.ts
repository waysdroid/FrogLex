// @vitest-environment jsdom
import { createStore } from "jotai"
import { describe, expect, it } from "vitest"
import { selectedProviderIdAtom } from "../atoms"

describe("selectedProviderIdAtom", () => {
  it("opens with no provider selected", () => {
    const store = createStore()

    expect(store.get(selectedProviderIdAtom)).toBeUndefined()
  })

  it("keeps the provider picked afterwards", async () => {
    const store = createStore()

    await store.set(selectedProviderIdAtom, "provider-1")

    expect(store.get(selectedProviderIdAtom)).toBe("provider-1")
  })
})
