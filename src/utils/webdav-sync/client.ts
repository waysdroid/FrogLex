import type { SyncKind, SyncSettings } from "./types"
import { sha256 } from "js-sha256"
import { z } from "zod"
import {
  davDirectory,
  isNutstoreDirectory,
  nutstoreDefaultFolder,
  nutstoreRoot,
  SyncError,
} from "./types"

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema = z.object({
  format: z.literal("read-frog-webdav"),
  version: z.literal(1),
  kind: z.enum(["config", "vocabulary"]),
  chunks: z.record(z.string().regex(/^(?:config|[01][a-f0-9])$/), digestSchema),
})
type Manifest = z.output<typeof manifestSchema>
type RemoteVersion = { etag: string | null; bodyHash?: string; manifest: Manifest | null } | null
type DavMethod = "PROPFIND" | "GET" | "PUT" | "MKCOL" | "COPY"
export type Chunks = Map<string, string>

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" }
const xmlHeaders = { Depth: "0", "Content-Type": "application/xml; charset=utf-8" }

async function readText(response: Response) {
  try {
    return await response.text()
  } catch {
    throw new SyncError("connection")
  }
}

function assertManifestWritten(response: Response) {
  if (response.status === 412 || response.status === 423) throw new SyncError("changed")
  if (!response.ok) {
    throw new SyncError(response.status === 404 || response.status === 409 ? "folder" : "server")
  }
}

export class WebDavClient {
  private readonly directory: URL
  private readonly authorization: string | undefined
  private readonly nutstore: boolean
  private defaultFolderChecked = false

  constructor(
    settings: SyncSettings,
    // Chromium requires the worker global as the receiver of native fetch.
    private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    this.directory = davDirectory(settings.url)
    this.nutstore = isNutstoreDirectory(this.directory)
    if (settings.username || settings.password) {
      const bytes = new TextEncoder().encode(`${settings.username}:${settings.password}`)
      this.authorization = `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`
    }
  }

  private async request(
    name: string,
    method: DavMethod,
    headers: Record<string, string> = {},
    body?: string,
  ) {
    if (this.authorization) headers = { ...headers, Authorization: this.authorization }
    let response
    try {
      response = await this.fetcher(new URL(name, this.directory), {
        method,
        headers,
        body,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      })
    } catch {
      throw new SyncError("connection")
    }
    if (response.status === 401) throw new SyncError("auth")
    if (response.status === 403) {
      throw new SyncError(
        method === "PUT" || method === "COPY" || method === "MKCOL" ? "writeDenied" : "auth",
      )
    }
    if (response.status === 429 || (this.nutstore && response.status === 503)) {
      throw new SyncError("rateLimited")
    }
    return response
  }

  private async properties(name: string, property: "resourcetype" | "getetag") {
    const response = await this.request(
      name,
      "PROPFIND",
      xmlHeaders,
      `<?xml version="1.0" encoding="UTF-8"?><propfind xmlns="DAV:"><prop><${property}/></prop></propfind>`,
    )
    if (response.status === 404) return null
    if (response.status !== 207) throw new SyncError("server")
    return readText(response)
  }

  private async isCollection(name: string) {
    const xml = await this.properties(name, "resourcetype")
    return xml !== null && /<(?:[\w.-]+:)?collection(?:\s|\/?>)/u.test(xml)
  }

  async test() {
    if (await this.isCollection("")) return
    if (this.directory.href === nutstoreDefaultFolder && (await this.isCollection(nutstoreRoot)))
      return
    throw new SyncError("folder")
  }

  async prepareUpload() {
    if (this.directory.href !== nutstoreDefaultFolder || this.defaultFolderChecked) return
    if (!(await this.isCollection(""))) {
      const response = await this.request("", "MKCOL")
      // Another device may create the collection between PROPFIND and MKCOL.
      if (response.status !== 201 && !(response.status === 405 && (await this.isCollection("")))) {
        throw new SyncError("folder")
      }
    }
    this.defaultFolderChecked = true
  }

  private writableTag(etag: string | null) {
    if (etag && /^"[^"]*"$/u.test(etag)) return etag
    // Nutstore can return a bare ETag and expects the same token in If-Match.
    if (this.nutstore && etag && !etag.startsWith("W/") && /^[a-z\d._:+/=-]+$/iu.test(etag))
      return etag
    return null
  }

  async readVersion(kind: SyncKind, overwrite = false): Promise<RemoteVersion> {
    const response = await this.request(this.manifestName(kind), "GET")
    if (response.status === 404) return null
    if (response.status !== 200) throw new SyncError("server")
    const etag = this.writableTag(response.headers.get("etag"))
    const body = !overwrite || (this.nutstore && !etag) ? await readText(response) : undefined
    const bodyHash = this.nutstore && !etag && body !== undefined ? sha256(body) : undefined
    if (overwrite) {
      if (body === undefined) await response.body?.cancel()
      return { etag, bodyHash, manifest: null }
    }
    try {
      const manifest = manifestSchema.parse(JSON.parse(body ?? ""))
      const names = Object.keys(manifest.chunks)
      if (
        manifest.kind !== kind ||
        (kind === "config" ? names.length !== 1 || names[0] !== "config" : names.includes("config"))
      ) {
        throw new SyncError("invalid")
      }
      return { etag, bodyHash, manifest }
    } catch {
      throw new SyncError("invalid")
    }
  }

  private async propertyWriteTag(name: string) {
    const xml = await this.properties(name, "getetag")
    if (xml === null) throw new SyncError("changed")
    const property = /<(?:[\w.-]+:)?getetag(?:\s[^>]*)?>([^<]+)<\/(?:[\w.-]+:)?getetag\s*>/u.exec(
      xml,
    )?.[1]
    return this.writableTag(property?.trim().replaceAll("&quot;", '"') ?? null)
  }

  private async requireWriteTag(name: string, remote: NonNullable<RemoteVersion>) {
    if (remote.etag) return remote.etag
    if (!this.nutstore || !remote.bodyHash) throw new SyncError("validator")
    const etag = await this.propertyWriteTag(name)
    if (!etag) throw new SyncError("validator")
    // Pair the property with the manifest bytes used for this merge before issuing a CAS.
    const version = await this.request(name, "GET")
    if (version.status === 404) throw new SyncError("changed")
    if (version.status !== 200) throw new SyncError("server")
    if (sha256(await readText(version)) !== remote.bodyHash) throw new SyncError("changed")
    return etag
  }

  async download(kind: SyncKind, manifest: Manifest, available: Chunks): Promise<Chunks> {
    const chunks = new Map<string, string>()
    const pending: [string, string][] = []
    for (const [name, digest] of Object.entries(manifest.chunks)) {
      const cached = available.get(digest)
      if (cached !== undefined) chunks.set(name, cached)
      else pending.push([name, digest])
    }
    await inBatches(pending, async ([name, digest]) => {
      const response = await this.request(this.chunkName(kind, digest), "GET")
      if (response.status !== 200) throw new SyncError("invalid")
      const body = await readText(response)
      if (sha256(body) !== digest) throw new SyncError("invalid")
      chunks.set(name, body)
    })
    return chunks
  }

  async upload(kind: SyncKind, chunks: Chunks, remote: RemoteVersion) {
    const manifestName = this.manifestName(kind)
    const etag = remote ? await this.requireWriteTag(manifestName, remote) : null
    if (!remote) await this.prepareUpload()
    const chunksByName = Object.fromEntries([...chunks].map(([name, body]) => [name, sha256(body)]))
    const known = new Set(Object.values(remote?.manifest?.chunks ?? {}))
    const pending = [...new Map([...chunks.values()].map((body) => [sha256(body), body]))].filter(
      ([digest]) => !known.has(digest),
    )
    await inBatches(pending, async ([digest, body]) => {
      const response = await this.request(
        this.chunkName(kind, digest),
        "PUT",
        { ...jsonHeaders, "If-None-Match": "*" },
        body,
      )
      // Immutable chunks can already exist after a previous attempt or a parallel upload.
      if (response.status === 412) {
        const existing = await this.request(this.chunkName(kind, digest), "GET")
        if (existing.status !== 200 || sha256(await readText(existing)) !== digest) {
          throw new SyncError("invalid")
        }
      } else if (!response.ok) {
        throw new SyncError(
          response.status === 404 || response.status === 409 ? "folder" : "server",
        )
      }
    })
    const manifest: Manifest = {
      format: "read-frog-webdav",
      version: 1,
      kind,
      chunks: chunksByName,
    }
    const body = JSON.stringify(manifest)
    if (!remote && this.nutstore) {
      // Nutstore may ignore If-None-Match on PUT. COPY with Overwrite F reserves
      // the public manifest name without clobbering a peer's first sync.
      const source = `read-frog-${kind}-manifest-${sha256(body)}.json`
      assertManifestWritten(await this.request(source, "PUT", jsonHeaders, body))
      const response = await this.request(source, "COPY", {
        Destination: new URL(manifestName, this.directory).href,
        Overwrite: "F",
      })
      assertManifestWritten(response)
      if (response.status !== 201) throw new SyncError("server")
      return
    }
    let response = await this.request(
      manifestName,
      "PUT",
      { ...jsonHeaders, ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }) },
      body,
    )
    if (this.nutstore && response.status === 412 && etag?.startsWith('"')) {
      // Only retry a rejected quoted tag if Nutstore advertises the same
      // version as a bare token. A different token signals a real conflict.
      const rawTag = await this.propertyWriteTag(manifestName)
      if (rawTag && rawTag === etag.slice(1, -1)) {
        response = await this.request(
          manifestName,
          "PUT",
          { ...jsonHeaders, "If-Match": rawTag },
          body,
        )
      }
    }
    assertManifestWritten(response)
  }

  private manifestName(kind: SyncKind) {
    return `read-frog-${kind}.json`
  }

  private chunkName(kind: SyncKind, digest: string) {
    return `read-frog-${kind}-${digest}.json`
  }
}

async function inBatches<T>(items: T[], operation: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += 4) {
    const results = await Promise.allSettled(items.slice(index, index + 4).map(operation))
    const failure = results.find((result) => result.status === "rejected")
    if (failure) throw failure.reason
  }
}
