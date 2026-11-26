import { sha256 } from "js-sha256"
import { z } from "zod"

export const releasesUrl = "https://github.com/waysdroid/FrogLex/releases"
const catalogUrl = `${releasesUrl}/latest/download/read-frog-update.json`
const maxZipBytes = 64 * 1024 * 1024

const releaseVersionPattern = /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}$/u
const assetSchema = z.object({
  size: z.number().int().positive().max(maxZipBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
})
const catalogSchema = z.object({
  format: z.literal(1),
  version: z.string().regex(releaseVersionPattern),
  chrome: assetSchema,
  edge: assetSchema,
})

export type UpdateBrowser = "chrome" | "edge"
export type UpdateRelease = {
  version: string
  browser: UpdateBrowser
  notesUrl: string
  assetUrl: string
  size: number
  sha256: string
}

export type UpdateErrorCode = "network" | "package" | "folder" | "permission" | "write" | "restore"
export class UpdateError extends Error {
  constructor(readonly code: UpdateErrorCode) {
    super(code)
  }
}

export function compareVersions(left: string, right: string) {
  const a = left.split(".").map(Number)
  const b = right.split(".").map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff) return Math.sign(diff)
  }
  return 0
}

export function parseCatalog(value: unknown, target: UpdateBrowser): UpdateRelease {
  const catalog = catalogSchema.safeParse(value)
  if (!catalog.success) throw new UpdateError("package")
  const { version } = catalog.data
  return {
    version,
    browser: target,
    notesUrl: `${releasesUrl}/tag/v${version}`,
    assetUrl: `${releasesUrl}/download/v${version}/read-frog-personal-vocabulary-v${version}-${target}.zip`,
    ...catalog.data[target],
  }
}

async function githubFile(url: string, maxBytes: number, timeout: number) {
  // Requests are made only from the update controls. Keep GitHub session cookies out of them.
  try {
    const response = await globalThis.fetch(url, {
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok || !response.body) throw new UpdateError("network")
    const final = new URL(response.url)
    if (
      final.protocol !== "https:" ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(final.hostname)
    ) {
      await response.body.cancel()
      throw new UpdateError("network")
    }

    const chunks: Uint8Array[] = []
    let length = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const result = await reader.read()
        if (result.done) break
        length += result.value.byteLength
        if (length > maxBytes) {
          await reader.cancel()
          throw new UpdateError("package")
        }
        chunks.push(result.value)
      }
    } finally {
      reader.releaseLock()
    }
    const data = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    return data
  } catch (error) {
    throw error instanceof UpdateError ? error : new UpdateError("network")
  }
}

export async function checkForRelease(target: UpdateBrowser) {
  const bytes = await githubFile(catalogUrl, 16_384, 15_000)
  try {
    return parseCatalog(JSON.parse(new TextDecoder().decode(bytes)), target)
  } catch {
    throw new UpdateError("package")
  }
}

export async function downloadRelease(release: UpdateRelease) {
  const bytes = await githubFile(release.assetUrl, release.size, 120_000)
  if (bytes.byteLength !== release.size || sha256(bytes) !== release.sha256) {
    throw new UpdateError("package")
  }
  return bytes
}
