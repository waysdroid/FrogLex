import type { SyncKind, SyncSettings } from "./types"
import { sha256 } from "js-sha256"
import { z } from "zod"
import { davDirectory, SyncError } from "./types"

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema = z.object({
  format: z.literal("read-frog-webdav"),
  version: z.literal(1),
  kind: z.enum(["config", "vocabulary"]),
  chunks: z.record(z.string().regex(/^(?:config|[01][a-f0-9])$/), digestSchema),
})
type Manifest = z.output<typeof manifestSchema>
type RemoteVersion = { etag: string | null; manifest: Manifest | null } | null
export type Chunks = Map<string, string>

export class WebDavClient {
  private readonly directory: URL
  private readonly authorization: string | undefined

  constructor(
    settings: SyncSettings,
    private readonly fetcher = fetch,
  ) {
    this.directory = davDirectory(settings.url)
    if (settings.username || settings.password) {
      const bytes = new TextEncoder().encode(`${settings.username}:${settings.password}`)
      this.authorization = `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`
    }
  }

  private async request(
    name: string,
    method: "PROPFIND" | "GET" | "PUT",
    headers: Record<string, string> = {},
    body?: string,
  ) {
    if (this.authorization) headers.Authorization = this.authorization
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
    if (response.status === 401 || response.status === 403) throw new SyncError("auth")
    return response
  }

  async test() {
    const response = await this.request(
      "",
      "PROPFIND",
      { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      '<?xml version="1.0" encoding="UTF-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
    )
    if (response.status === 404) throw new SyncError("folder")
    if (response.status !== 207) throw new SyncError("server")
    const xml = await response.text()
    if (!/<(?:[\w.-]+:)?collection(?:\s|\/?>)/u.test(xml)) throw new SyncError("folder")
  }

  async readVersion(kind: SyncKind, overwrite = false): Promise<RemoteVersion> {
    const response = await this.request(this.manifestName(kind), "GET")
    if (response.status === 404) return null
    if (response.status !== 200) throw new SyncError("server")
    const etag = response.headers.get("etag")
    if (overwrite) return { etag, manifest: null }
    try {
      const manifest = manifestSchema.parse(await response.json())
      const names = Object.keys(manifest.chunks)
      if (
        manifest.kind !== kind ||
        (kind === "config" ? names.length !== 1 || names[0] !== "config" : names.includes("config"))
      ) {
        throw new SyncError("invalid")
      }
      return { etag, manifest }
    } catch {
      throw new SyncError("invalid")
    }
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
      const body = await response.text()
      if (sha256(body) !== digest) throw new SyncError("invalid")
      chunks.set(name, body)
    })
    return chunks
  }

  async upload(kind: SyncKind, chunks: Chunks, remote: RemoteVersion) {
    const etag = remote?.etag
    if (remote && (!etag || !/^"[^"]*"$/u.test(etag))) throw new SyncError("validator")
    const chunksByName = Object.fromEntries([...chunks].map(([name, body]) => [name, sha256(body)]))
    const known = new Set(Object.values(remote?.manifest?.chunks ?? {}))
    const pending = [...new Map([...chunks.values()].map((body) => [sha256(body), body]))].filter(
      ([digest]) => !known.has(digest),
    )
    await inBatches(pending, async ([digest, body]) => {
      const response = await this.request(
        this.chunkName(kind, digest),
        "PUT",
        { "If-None-Match": "*", "Content-Type": "application/json; charset=utf-8" },
        body,
      )
      // Immutable chunks can already exist after a previous attempt or a parallel upload.
      if (response.status === 412) {
        const existing = await this.request(this.chunkName(kind, digest), "GET")
        if (existing.status !== 200 || sha256(await existing.text()) !== digest) {
          throw new SyncError("invalid")
        }
      } else if (!response.ok) {
        throw new SyncError(response.status === 409 ? "folder" : "server")
      }
    })
    const manifest: Manifest = {
      format: "read-frog-webdav",
      version: 1,
      kind,
      chunks: chunksByName,
    }
    const response = await this.request(
      this.manifestName(kind),
      "PUT",
      {
        ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }),
        "Content-Type": "application/json; charset=utf-8",
      },
      JSON.stringify(manifest),
    )
    if (response.status === 412 || response.status === 423) throw new SyncError("changed")
    if (!response.ok) throw new SyncError(response.status === 409 ? "folder" : "server")
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
