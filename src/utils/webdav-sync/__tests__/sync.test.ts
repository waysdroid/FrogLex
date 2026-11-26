import type { IncomingMessage, ServerResponse } from "node:http"
import type { SyncDataset } from "../run"
import type { VocabularyBackup } from "@/utils/personal-vocabulary/backup"
import { createServer } from "node:http"
import { Dexie } from "dexie"
import { IDBKeyRange, indexedDB } from "fake-indexeddb"
import { sha256 } from "js-sha256"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { PersonalVocabularyRepository } from "@/utils/personal-vocabulary/repository"
import { WebDavClient } from "../client"
import {
  mergeConfig,
  packConfig,
  projectConfig,
  restoreConfigCredentials,
  unpackConfig,
} from "../config"
import { syncDataset } from "../run"
import { davDirectory, defaultSettings } from "../types"
import { mergeVocabulary, packVocabulary, unpackVocabulary } from "../vocabulary"

interface File {
  body: string
  etag: string
}

const files = new Map<string, File>()
const requests: [method: string, path: string][] = []
let rejectManifest = false
let weakEtag = false
let directory = ""
let repositories: { repo: PersonalVocabularyRepository; name: string }[] = []

async function handle(request: IncomingMessage, response: ServerResponse) {
  const path = request.url!
  const method = request.method!
  requests.push([method, path])
  if (request.headers.authorization !== "Basic dGVzdDpwYXNzd29yZA==") {
    response.writeHead(401).end()
    return
  }
  if (method === "PROPFIND") {
    response
      .writeHead(path === "/dav/" ? 207 : 404)
      .end(
        '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:resourcetype><D:collection/></D:resourcetype></D:multistatus>',
      )
    return
  }
  const existing = files.get(path)
  if (method === "GET") {
    if (!existing) response.writeHead(404).end()
    else
      response
        .writeHead(200, { ETag: weakEtag ? `W/${existing.etag}` : existing.etag })
        .end(existing.body)
    return
  }
  if (method !== "PUT") {
    response.writeHead(405).end()
    return
  }
  if (
    (existing && request.headers["if-none-match"] === "*") ||
    (request.headers["if-match"] && existing?.etag !== request.headers["if-match"]) ||
    (rejectManifest && path === "/dav/read-frog-vocabulary.json")
  ) {
    response.writeHead(412).end()
    return
  }
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const body = Buffer.concat(chunks).toString()
  const etag = `"${sha256(body)}"`
  files.set(path, { body, etag })
  response.writeHead(existing ? 204 : 201, { ETag: etag }).end()
}

const server = createServer((request, response) => {
  void handle(request, response).catch(() => response.writeHead(500).end())
})

beforeAll(async () => {
  Dexie.dependencies.indexedDB = indexedDB
  Dexie.dependencies.IDBKeyRange = IDBKeyRange
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No address")
  directory = `http://127.0.0.1:${address.port}/dav`
})

beforeEach(() => {
  files.clear()
  requests.length = 0
  rejectManifest = false
  weakEtag = false
  repositories = []
})

afterEach(async () => {
  for (const { repo, name } of repositories) {
    repo.close()
    await Dexie.delete(name)
  }
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

function dav() {
  return new WebDavClient({
    ...defaultSettings,
    url: directory,
    username: "test",
    password: "password",
  })
}

function device() {
  const name = `webdav-test-${crypto.randomUUID()}`
  const repo = new PersonalVocabularyRepository(name)
  repositories.push({ repo, name })
  let checkpoint: VocabularyBackup | undefined
  const dataset: SyncDataset<VocabularyBackup> = {
    read: () => repo.createBackup(),
    apply: (before, next) => repo.applySyncSnapshot(before, next),
    project: (snapshot) => snapshot,
    pack: packVocabulary,
    unpack: unpackVocabulary,
    merge: mergeVocabulary,
    loadCheckpoint: async () => checkpoint,
    saveCheckpoint: async (value) => {
      checkpoint = value
    },
  }
  return { repo, dataset }
}

function save(repo: PersonalVocabularyRepository, term: string, sentence?: string) {
  return repo.saveEncounter({
    operationId: crypto.randomUUID(),
    term,
    originalTerm: term,
    lemmaSource: "dictionary",
    ...(sentence ? { context: { sentence } } : {}),
  })
}

describe("WebDAV synchronization over HTTP", () => {
  it("calls the native fetch with the global receiver required by Chromium workers", async () => {
    const originalFetch = globalThis.fetch
    const strictFetch = vi.spyOn(globalThis, "fetch").mockImplementation(function (
      this: unknown,
      input,
      init,
    ) {
      if (this !== globalThis) throw new TypeError("Illegal invocation")
      return originalFetch(input, init)
    })
    try {
      await dav().test()
      expect(requests).toEqual([["PROPFIND", "/dav/"]])
    } finally {
      strictFetch.mockRestore()
    }
  })

  it("tests a real directory and rejects bad credentials or unsafe URLs", async () => {
    await expect(dav().test()).resolves.toBeUndefined()
    const withoutAuth = new WebDavClient({ ...defaultSettings, url: directory })
    await expect(withoutAuth.test()).rejects.toMatchObject({ code: "auth" })
    expect(() => davDirectory("http://example.test/dav")).toThrow("settings")
    expect(() => davDirectory("https://name:secret@example.test/dav")).toThrow("settings")
    expect(() => davDirectory("https://example.test/dav?token=secret")).toThrow("settings")
  })

  it("converges after distinct edits and transfers only changed vocabulary shards", async () => {
    const a = device()
    const b = device()
    const original = await save(a.repo, "read", "I read in the morning.")
    const tags = await a.repo.saveGroup("tag", "Daily")
    await a.repo.saveEntry(
      {
        term: "read",
        originalTerm: "read",
        lemmaSource: "dictionary",
        tagIds: [tags],
        collectionIds: [],
      },
      original.entryId,
    )
    await syncDataset(dav(), "vocabulary", "incremental", a.dataset)
    await syncDataset(dav(), "vocabulary", "incremental", b.dataset)
    const originalOnB = await b.repo.getEntryDetail(original.entryId)
    expect(originalOnB?.contexts[0]?.sentence).toBe("I read in the morning.")
    expect((await b.repo.getMembership(original.entryId)).tagIds).toEqual([tags])
    await a.repo.saveEntry(
      {
        term: "read",
        originalTerm: "read",
        lemmaSource: "dictionary",
        note: "from A",
        tagIds: [tags],
        collectionIds: [],
      },
      original.entryId,
    )
    await save(b.repo, "dawn")
    await syncDataset(dav(), "vocabulary", "incremental", b.dataset)
    requests.length = 0
    await syncDataset(dav(), "vocabulary", "incremental", a.dataset)
    expect(
      requests.filter(
        ([method, path]) => method === "PUT" && path !== "/dav/read-frog-vocabulary.json",
      ),
    ).toHaveLength(1)
    await syncDataset(dav(), "vocabulary", "incremental", b.dataset)
    expect((await b.repo.getEntryDetail(original.entryId))?.entry.note).toBe("from A")
    expect(packVocabulary(await a.repo.createBackup())).toEqual(
      packVocabulary(await b.repo.createBackup()),
    )
    requests.length = 0
    expect(await syncDataset(dav(), "vocabulary", "incremental", b.dataset)).toBe(false)
    expect(requests).toEqual([["GET", "/dav/read-frog-vocabulary.json"]])

    await b.repo.deleteEntries([original.entryId])
    await syncDataset(dav(), "vocabulary", "incremental", b.dataset)
    await syncDataset(dav(), "vocabulary", "incremental", a.dataset)
    expect((await a.repo.createBackup()).entries.map(({ term }) => term)).toEqual(["dawn"])
  })

  it("deduplicates independently collected words and preserves both encounter histories", async () => {
    const a = device()
    const b = device()
    await save(a.repo, "read", "How do you read this?")
    await save(b.repo, "read", "This is what I read.")
    await syncDataset(dav(), "vocabulary", "push", a.dataset)
    await syncDataset(dav(), "vocabulary", "incremental", b.dataset)
    await syncDataset(dav(), "vocabulary", "incremental", a.dataset)
    const saved = await a.repo.createBackup()
    expect(saved.entries).toHaveLength(1)
    expect(saved.entries[0]?.encounterCount).toBe(2)
    expect(saved.contexts).toHaveLength(2)
    expect(saved.encounters).toHaveLength(2)
    expect(saved.entryCollections).toHaveLength(1)
  })

  it("keeps both copies when the same field has different edits", async () => {
    const a = device()
    const b = device()
    const original = await save(a.repo, "rain")
    await syncDataset(dav(), "vocabulary", "push", a.dataset)
    await syncDataset(dav(), "vocabulary", "pull", b.dataset)
    const fields = {
      term: "rain",
      originalTerm: "rain",
      lemmaSource: "dictionary" as const,
      tagIds: [],
      collectionIds: [],
    }
    await a.repo.saveEntry({ ...fields, note: "local A" }, original.entryId)
    await b.repo.saveEntry({ ...fields, note: "local B" }, original.entryId)
    await syncDataset(dav(), "vocabulary", "incremental", a.dataset)
    requests.length = 0
    await expect(syncDataset(dav(), "vocabulary", "incremental", b.dataset)).rejects.toMatchObject({
      code: "conflict",
    })
    expect(requests.every(([method]) => method === "GET")).toBe(true)
    expect((await b.repo.getEntryDetail(original.entryId))?.entry.note).toBe("local B")
    await syncDataset(dav(), "vocabulary", "pull", b.dataset)
    expect((await b.repo.getEntryDetail(original.entryId))?.entry.note).toBe("local A")
  })

  it("overwrites exactly, rejecting missing or corrupted cloud copies without changing local data", async () => {
    const a = device()
    const b = device()
    await save(a.repo, "rain")
    const local = await save(b.repo, "snow")
    await expect(syncDataset(dav(), "vocabulary", "pull", b.dataset)).rejects.toMatchObject({
      code: "missing",
    })
    await syncDataset(dav(), "vocabulary", "push", a.dataset)
    const path = [...files.keys()].find((name) => name.startsWith("/dav/read-frog-vocabulary-"))!
    const valid = files.get(path)!
    files.set(path, { ...valid, body: "tampered" })
    await expect(syncDataset(dav(), "vocabulary", "pull", b.dataset)).rejects.toMatchObject({
      code: "invalid",
    })
    expect(await b.repo.getEntryDetail(local.entryId)).toBeTruthy()
    files.set(path, valid)
    await syncDataset(dav(), "vocabulary", "pull", b.dataset)
    expect(await b.repo.getEntryDetail(local.entryId)).toBeNull()
    expect(packVocabulary(await a.repo.createBackup())).toEqual(
      packVocabulary(await b.repo.createBackup()),
    )
  })

  it("rejects unsafe concurrent writes and preserves a local edit made during download", async () => {
    const a = device()
    const b = device()
    await save(a.repo, "rain")
    await syncDataset(dav(), "vocabulary", "push", a.dataset)
    await syncDataset(dav(), "vocabulary", "pull", b.dataset)
    await save(a.repo, "snow")
    weakEtag = true
    await expect(syncDataset(dav(), "vocabulary", "incremental", a.dataset)).rejects.toMatchObject({
      code: "validator",
    })
    weakEtag = false
    rejectManifest = true
    await expect(syncDataset(dav(), "vocabulary", "incremental", a.dataset)).rejects.toMatchObject({
      code: "changed",
    })
    rejectManifest = false
    await syncDataset(dav(), "vocabulary", "incremental", a.dataset)
    const beforeApply = b.dataset.apply
    b.dataset.apply = async (before, next) => {
      await save(b.repo, "ice")
      return beforeApply(before, next)
    }
    await expect(syncDataset(dav(), "vocabulary", "pull", b.dataset)).rejects.toMatchObject({
      code: "changed",
    })
    expect((await b.repo.createBackup()).entries.map(({ term }) => term)).toContain("ice")
  })
})

describe("WebDAV configuration", () => {
  it("combines independent edits and rejects changes to the same option", () => {
    const base = projectConfig(DEFAULT_CONFIG)
    const local = { ...base, language: { ...base.language, targetCode: "fr" as const } }
    const remote = { ...base, uiLanguage: "zh-CN" as const }
    expect(mergeConfig(base, local, remote)).toMatchObject({
      uiLanguage: "zh-CN",
      language: { targetCode: "fr" },
    })
    expect(() =>
      mergeConfig(base, local, { ...base, language: { ...base.language, targetCode: "ja" } }),
    ).toThrow("conflict")
  })

  it("redacts credentials and only restores them to the same endpoint", async () => {
    const provider = {
      id: "custom-sync-test",
      name: "OpenAI test",
      provider: "openai" as const,
      enabled: true,
      model: { model: "gpt-4o" as const, isCustomModel: false, customModel: null },
      apiKey: "private-secret",
      headers: { Authorization: "private-header" },
      providerOptions: { token: "private-option" },
      baseURL: "https://person:private-login@example.test/v1?token=private-query",
    }
    const raw = {
      ...DEFAULT_CONFIG,
      providersConfig: [...DEFAULT_CONFIG.providersConfig, provider],
    }
    const sanitized = projectConfig(raw)
    const chunks = packConfig(sanitized)
    expect([...chunks.values()].join()).not.toContain("private-")
    const incoming = await unpackConfig(chunks)
    expect(restoreConfigCredentials(raw, incoming).providersConfig.at(-1)).toEqual(provider)
    const changedEndpoint = {
      ...incoming,
      providersConfig: incoming.providersConfig.map((item) =>
        item.id === provider.id ? { ...item, baseURL: "https://other.example.test/v1" } : item,
      ),
    }
    expect(
      restoreConfigCredentials(raw, changedEndpoint).providersConfig.at(-1),
    ).not.toHaveProperty("apiKey")
  })
})
