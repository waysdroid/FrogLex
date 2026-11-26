import type { SyncSettings, SyncStatus } from "../types"
import { beforeEach, expect, it, vi } from "vitest"
import { setupWebDavSync } from "@/entrypoints/background/webdav-sync"
import { defaultSettings, settingsKey, statusKey, syncTarget } from "../types"

type MessageHandler = (request: {
  sender: { id: string; url: string }
  data: unknown
}) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  now: new Map<string, unknown>(),
  alarm: { current: undefined as { periodInMinutes: number } | undefined },
  listener: { current: undefined as ((alarm: { name: string }) => Promise<void>) | undefined },
  messages: new Map<string, MessageHandler>(),
  sync: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
}))

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-extension",
      getURL: (path: string) => `chrome-extension://test-extension${path}`,
    },
    alarms: {
      get: async () => mocks.alarm.current,
      clear: async () => {
        mocks.alarm.current = undefined
      },
      create: async (_name: string, options: { periodInMinutes: number }) => {
        mocks.alarm.current = options
      },
      onAlarm: {
        addListener: (listener: NonNullable<typeof mocks.listener.current>) => {
          mocks.listener.current = listener
        },
      },
    },
  },
}))

vi.mock("wxt/utils/storage", () => ({
  storage: {
    getItem: async (key: string) => mocks.now.get(key),
    setItem: async (key: string, value: unknown) => {
      mocks.now.set(key, value)
    },
    removeItem: async (key: string) => {
      mocks.now.delete(key)
    },
  },
}))

vi.mock("@/utils/message", () => ({
  onMessage: (key: string, callback: MessageHandler) => {
    mocks.messages.set(key, callback)
  },
}))
vi.mock("@/utils/config/storage", () => ({
  getLocalConfigAndMeta: vi.fn<() => Promise<unknown>>(),
  setLocalConfig: vi.fn<() => Promise<void>>(),
}))
vi.mock("@/utils/personal-vocabulary/repository", () => ({ personalVocabularyRepository: {} }))
vi.mock("@/utils/webdav-sync/checkpoint", () => ({ checkpoint: () => ({}) }))
vi.mock("@/utils/webdav-sync/run", () => ({ syncDataset: mocks.sync }))

const sender = {
  id: "test-extension",
  url: "chrome-extension://test-extension/options.html#/preference",
}
const configured: SyncSettings = {
  ...defaultSettings,
  url: "https://dav.example.test/read-frog/",
  username: "device",
  config: false,
  automatic: true,
  interval: 60,
}

function message(key: string, data: unknown, from = sender) {
  return mocks.messages.get(key)!({ sender: from, data })
}

beforeEach(() => {
  mocks.now.clear()
  mocks.messages.clear()
  mocks.alarm.current = undefined
  mocks.listener.current = undefined
  mocks.sync.mockClear()
})

it("updates the schedule, runs only incremental work, and removes the alarm when disabled", async () => {
  setupWebDavSync(async () => {})
  expect(await message("saveWebDavSettings", configured)).toEqual({ ok: true, changed: false })
  expect(mocks.alarm.current?.periodInMinutes).toBe(60)
  expect(mocks.now.get(settingsKey)).toEqual(configured)
  await mocks.listener.current?.({ name: "webdav-auto-incremental" })
  expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    "vocabulary",
    "incremental",
    expect.anything(),
  )
  const status = mocks.now.get(statusKey) as SyncStatus
  expect(status.results).toEqual({ vocabulary: { ok: true, changed: true } })
  expect(await message("saveWebDavSettings", { ...configured, automatic: false })).toEqual({
    ok: true,
    changed: false,
  })
  expect(mocks.alarm.current).toBeUndefined()
  await mocks.listener.current?.({ name: "webdav-auto-incremental" })
  expect(mocks.sync).toHaveBeenCalledTimes(1)
})

it("requires the options page and the confirmed, currently saved target for destructive runs", async () => {
  mocks.now.set(settingsKey, configured)
  setupWebDavSync(async () => {})
  const manual = { mode: "pull", target: syncTarget(configured) }
  await expect(
    message("runWebDavSync", manual, { ...sender, url: "https://example.test/" }),
  ).resolves.toEqual({ ok: false, error: "settings" })
  await expect(
    message("runWebDavSync", { ...manual, target: { ...manual.target, vocabulary: false } }),
  ).resolves.toEqual({ ok: false, error: "changed" })
  expect(mocks.sync).not.toHaveBeenCalled()
  await expect(message("runWebDavSync", manual)).resolves.toMatchObject({
    ok: true,
    status: { mode: "pull" },
  })
  expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    "vocabulary",
    "pull",
    expect.anything(),
  )
})
