import { sha256 } from "js-sha256"
import JSZip from "jszip"
import { afterEach, expect, it, vi } from "vitest"
import { extractRelease } from "../archive"
import { checkForRelease, compareVersions, downloadRelease, parseCatalog } from "../release"

const oldManifest = {
  manifest_version: 3,
  version: "1.61.3.8",
  version_name: "1.1.8",
  name: "__MSG_extName__",
  permissions: ["alarms", "storage"],
  host_permissions: ["*://*/*"],
  background: { service_worker: "background.js" },
  options_ui: { page: "options.html" },
}
const nextManifest = { ...oldManifest, version: "1.61.3.10", version_name: "1.1.10" }
const payload = new TextEncoder().encode("archive bytes")
const catalog = {
  format: 1,
  version: "1.1.10",
  chrome: { size: payload.length, sha256: sha256(payload) },
  edge: { size: payload.length, sha256: sha256(payload) },
}

async function archive(manifest: unknown = nextManifest, extra?: string) {
  const zip = new JSZip()
  zip.file("manifest.json", JSON.stringify(manifest))
  zip.file("background.js", "/* new worker */")
  zip.file("options.html", "<main>options</main>")
  zip.file("chunks/options-cT2.js", "/* chunk */")
  if (extra) zip.file(extra, "invalid path")
  return zip.generateAsync({ type: "uint8array" })
}

function redirected(response: Response, host = "release-assets.githubusercontent.com") {
  Object.defineProperty(response, "url", { value: `https://${host}/download` })
  return response
}

afterEach(() => vi.restoreAllMocks())

it("selects the expected artifact, checks numeric versions, and verifies the downloaded bytes", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(redirected(Response.json(catalog)))
    .mockResolvedValueOnce(redirected(new Response(payload)))
    .mockResolvedValueOnce(redirected(new Response(payload)))
  const update = await checkForRelease("edge")
  expect(compareVersions(update.version, oldManifest.version_name)).toBe(1)
  expect(compareVersions("1.1.7", oldManifest.version_name)).toBe(-1)
  expect(update.assetUrl).toBe(
    "https://github.com/waysdroid/read-frog/releases/download/v1.1.10/read-frog-personal-vocabulary-v1.1.10-edge.zip",
  )
  expect(update.notesUrl).toBe("https://github.com/waysdroid/read-frog/releases/tag/v1.1.10")
  expect(await downloadRelease(update)).toEqual(payload)
  await expect(downloadRelease({ ...update, sha256: "0".repeat(64) })).rejects.toMatchObject({
    code: "package",
  })
  expect(fetcher.mock.calls.every(([, options]) => options?.credentials === "omit")).toBe(true)
})

it("rejects a foreign download origin and invalid catalog versions", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    redirected(new Response(payload), "elsewhere.test"),
  )
  await expect(downloadRelease(parseCatalog(catalog, "chrome"))).rejects.toMatchObject({
    code: "network",
  })
  expect(() => parseCatalog({ ...catalog, version: "1.1.10-preview" }, "chrome")).toThrow("package")
})

it("opens the release archive and rejects incompatible versions, new permissions, and unsafe paths", async () => {
  const extracted = await extractRelease(await archive(), oldManifest, "1.1.10")
  expect([...extracted.keys()]).toEqual([
    "manifest.json",
    "background.js",
    "options.html",
    "chunks/options-cT2.js",
  ])
  for (const [manifest, pathname, reason] of [
    [oldManifest, undefined, "package"],
    [nextManifest, "../overwrite.js", "package"],
    [nextManifest, "Chunks/options-cT2.js", "package"],
    [nextManifest, "chunks/OPTIONS-CT2.js", "package"],
    [{ ...nextManifest, key: "different-extension" }, undefined, "package"],
    [{ ...nextManifest, permissions: ["storage", "downloads"] }, undefined, "permission"],
  ] as const) {
    await expect(
      extractRelease(await archive(manifest, pathname), oldManifest, "1.1.10"),
    ).rejects.toMatchObject({ code: reason })
  }
})
