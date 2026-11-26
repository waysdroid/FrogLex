import { sha256 } from "js-sha256"
import { describe, expect, it } from "vitest"
import { WebDavClient } from "../client"
import { davDirectory, defaultSettings, nutstoreDefaultFolder, nutstoreRoot } from "../types"

const collection =
  "<?xml version='1.0'?><D:multistatus xmlns:D='DAV:'><D:resourcetype><D:collection/></D:resourcetype></D:multistatus>"
const manifest = "/dav/read-frog/read-frog-config.json"
const version1 = new Map([["config", "first version"]])
const version2 = new Map([["config", "second version"]])

function nutstore(url = nutstoreRoot) {
  const files = new Map<string, string>()
  const folders = new Set(["/dav/"])
  const actions: Array<{ path: string; method: string; headers: Headers }> = []
  const settings = {
    omitHttpTag: false,
    quotedHttpTag: false,
    httpStatus: 0,
    propertyTag: true,
    changedDuringPropfind: false,
  }
  const fetcher: typeof fetch = async (input, init) => {
    const target = input instanceof Request ? new URL(input.url) : new URL(input)
    const path = target.pathname
    const method = init?.method ?? "GET"
    const headers = new Headers(init?.headers)
    const requestBody = typeof init?.body === "string" ? init.body : undefined
    actions.push({ path, method, headers })
    if (headers.get("Authorization") !== "Basic dGVzdDphcHBwYXNz") {
      return new Response(null, { status: 401 })
    }
    if (method === "MKCOL") {
      if (folders.has(path)) return new Response(null, { status: 405 })
      folders.add(path)
      return new Response(null, { status: 201 })
    }
    const body = files.get(path)
    const status = (value: number) => new Response(null, { status: value })
    if (method === "PROPFIND") {
      if (requestBody?.includes("<getetag/>")) {
        if (body === undefined) return status(404)
        if (settings.changedDuringPropfind) files.set(path, "another device changed the manifest")
        const tag = settings.propertyTag ? `<D:getetag>${sha256(body)}</D:getetag>` : ""
        return new Response(`<D:multistatus xmlns:D="DAV:">${tag}</D:multistatus>`, { status: 207 })
      }
      return folders.has(path) ? new Response(collection, { status: 207 }) : status(404)
    }
    if (method === "GET") {
      if (body === undefined) return status(404)
      const tag = sha256(body)
      return new Response(body, {
        headers: settings.omitHttpTag ? {} : { ETag: settings.quotedHttpTag ? `"${tag}"` : tag },
      })
    }
    if (method === "PUT") {
      if (settings.httpStatus) return status(settings.httpStatus)
      const parent = path.slice(0, path.lastIndexOf("/") + 1)
      if (parent === "/dav/" || !folders.has(parent)) return status(404)
      const match = headers.get("If-Match")
      if (match && (body === undefined || match !== sha256(body))) return status(412)
      // Nutstore's PUT may ignore If-None-Match.
      if (requestBody === undefined) return status(400)
      files.set(path, requestBody)
      return status(body === undefined ? 201 : 204)
    }
    if (method === "COPY") {
      if (body === undefined) return status(404)
      const destination = new URL(headers.get("Destination")!)
      if (headers.get("Overwrite") === "F" && files.has(destination.pathname)) return status(412)
      files.set(destination.pathname, body)
      return status(201)
    }
    return status(405)
  }
  const client = new WebDavClient(
    { ...defaultSettings, url, username: "test", password: "apppass" },
    fetcher,
  )
  return { client, files, folders, actions, settings }
}

describe("Nutstore WebDAV compatibility", () => {
  it("uses a writable app folder for the official address and respects an explicit folder", () => {
    expect(davDirectory("dav.jianguoyun.com/dav/").href).toBe(nutstoreDefaultFolder)
    expect(davDirectory("https://dav.jianguoyun.com").href).toBe(nutstoreDefaultFolder)
    expect(davDirectory("https://dav.jianguoyun.com/dav/%E8%AF%8D%E5%BA%93").pathname).toBe(
      "/dav/%E8%AF%8D%E5%BA%93/",
    )
    expect(davDirectory("https://example.com/dav/").href).toBe("https://example.com/dav/")
  })

  it("tests a root connection without writing, then creates a folder and syncs using a bare ETag", async () => {
    const { client, files, folders, actions } = nutstore()
    await client.test()
    expect(actions.map(({ method, path }) => [method, path])).toEqual([
      ["PROPFIND", "/dav/read-frog/"],
      ["PROPFIND", "/dav/"],
    ])
    await client.prepareUpload()
    await client.upload("config", version1, await client.readVersion("config"))
    expect(folders.has("/dav/read-frog/")).toBe(true)
    const previous = await client.readVersion("config")
    expect(previous?.etag).toBe(sha256(files.get(manifest)!))
    await client.upload("config", version2, previous)
    const current = await client.readVersion("config")
    expect(await client.download("config", current!.manifest!, new Map())).toEqual(version2)
    await expect(client.upload("config", version1, previous)).rejects.toMatchObject({
      code: "changed",
    })
    expect(
      actions
        .find(({ path, method }) => path === manifest && method === "PUT")
        ?.headers.get("If-Match"),
    ).toBe(previous?.etag)
  })

  it("does not replace a manifest concurrently published by another device", async () => {
    const { client, files } = nutstore()
    const a = await client.readVersion("config")
    const b = await client.readVersion("config")
    await client.upload("config", version1, a)
    const committed = files.get(manifest)
    await expect(client.upload("config", version2, b)).rejects.toMatchObject({ code: "changed" })
    expect(files.get(manifest)).toBe(committed)
  })

  it("uses a PROPFIND validator only while the manifest still matches the read used for merging", async () => {
    const { client, files, settings } = nutstore()
    await client.upload("config", version1, null)
    settings.omitHttpTag = true
    await client.upload("config", version2, await client.readVersion("config"))
    const current = await client.readVersion("config")
    expect(await client.download("config", current!.manifest!, new Map())).toEqual(version2)
    settings.propertyTag = false
    await expect(client.upload("config", version1, current)).rejects.toMatchObject({
      code: "validator",
    })
    settings.propertyTag = true
    settings.changedDuringPropfind = true
    await expect(client.upload("config", version1, current)).rejects.toMatchObject({
      code: "changed",
    })
    expect(files.get(manifest)).toBe("another device changed the manifest")
  })

  it("retries a rejected quoted ETag only when the server confirms the equivalent bare tag", async () => {
    const { client, files, settings } = nutstore()
    await client.upload("config", version1, null)
    settings.quotedHttpTag = true
    const old = await client.readVersion("config")
    await client.upload("config", version2, old)
    const committed = files.get(manifest)
    await expect(client.upload("config", version1, old)).rejects.toMatchObject({ code: "changed" })
    expect(files.get(manifest)).toBe(committed)
  })

  it("reports write permission and service limits separately from bad credentials", async () => {
    const { client, settings } = nutstore()
    settings.httpStatus = 403
    await expect(client.upload("config", version1, null)).rejects.toMatchObject({
      code: "writeDenied",
    })
    settings.httpStatus = 503
    await expect(client.upload("config", version1, null)).rejects.toMatchObject({
      code: "rateLimited",
    })
  })
})
