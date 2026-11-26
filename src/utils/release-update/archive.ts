import JSZip from "jszip"
import { z } from "zod"
import { compareVersions, UpdateError } from "./release"

const manifestSchema = z.object({
  manifest_version: z.literal(3),
  version: z.string().regex(/^\d{1,5}(?:\.\d{1,5}){0,3}$/u),
  version_name: z.string().optional(),
  name: z.string(),
  key: z.string().optional(),
  update_url: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  optional_permissions: z.array(z.string()).default([]),
  host_permissions: z.array(z.string()).default([]),
  optional_host_permissions: z.array(z.string()).default([]),
  background: z.object({ service_worker: z.string() }),
  options_ui: z.object({ page: z.string() }),
})
export type InstallerManifest = z.output<typeof manifestSchema>

const packageDirectories = new Set([
  "_locales",
  "assets",
  "chunks",
  "content-runtime",
  "content-scripts",
  "icon",
])
const packageExtensions = /\.(?:css|html|js|json|png|svg|txt|webp|woff2)$/iu
const reservedFile = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu
const maxUnpackedBytes = 128 * 1024 * 1024

export function readInstallerManifest(value: unknown) {
  const result = manifestSchema.safeParse(value)
  if (!result.success) throw new UpdateError("package")
  return result.data
}

function validPath(path: string) {
  const parts = path.split("/")
  return (
    path.length <= 240 &&
    parts.every(
      (part) =>
        /^[\w.-]+$/u.test(part) &&
        !part.startsWith(".") &&
        !part.endsWith(".") &&
        !reservedFile.test(part),
    ) &&
    (parts.length === 1 || packageDirectories.has(parts[0]!)) &&
    (path === "LICENSE" || packageExtensions.test(path))
  )
}

export async function extractRelease(
  zip: Uint8Array,
  installedManifest: unknown,
  targetVersion: string,
) {
  try {
    const archive = await JSZip.loadAsync(zip)
    const entries = Object.values(archive.files).filter((entry) => !entry.dir)
    if (entries.length > 1024) throw new UpdateError("package")
    const paths = new Map<string, string>()
    for (const entry of entries) {
      const path = entry.name
      if (entry.unsafeOriginalName !== path || !validPath(path)) throw new UpdateError("package")
      const parts = path.split("/")
      for (let length = 1; length <= parts.length; length++) {
        const prefix = parts.slice(0, length).join("/")
        const key = prefix.toLowerCase()
        const existing = paths.get(key)
        if (
          (existing && existing !== prefix) ||
          (length < parts.length && archive.files[prefix] && !archive.files[prefix].dir)
        ) {
          throw new UpdateError("package")
        }
        paths.set(key, prefix)
      }
    }
    const manifest = archive.file("manifest.json")
    if (!manifest) throw new UpdateError("package")
    const next = readInstallerManifest(JSON.parse(await manifest.async("string")))
    const current = readInstallerManifest(installedManifest)
    if (
      next.version_name !== targetVersion ||
      compareVersions(next.version, current.version) <= 0 ||
      next.name !== current.name ||
      next.key !== current.key ||
      next.update_url !== current.update_url ||
      !archive.file(next.background.service_worker) ||
      !archive.file(next.options_ui.page)
    ) {
      throw new UpdateError("package")
    }
    for (const field of [
      "permissions",
      "optional_permissions",
      "host_permissions",
      "optional_host_permissions",
    ] as const) {
      if (next[field].some((permission) => !current[field].includes(permission))) {
        throw new UpdateError("permission")
      }
    }
    const files = new Map<string, Uint8Array<ArrayBuffer>>()
    let size = 0
    for (const entry of entries) {
      const data = new Uint8Array(await entry.async("arraybuffer"))
      size += data.byteLength
      if (size > maxUnpackedBytes) throw new UpdateError("package")
      files.set(entry.name, data)
    }
    return files
  } catch (error) {
    throw error instanceof UpdateError ? error : new UpdateError("package")
  }
}
