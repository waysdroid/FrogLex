import type { SyncResults, SyncSettings, SyncStatus, SyncTarget } from "@/utils/webdav-sync/types"
import { dequal } from "dequal"
import { browser, storage } from "#imports"
import { getLocalConfigAndMeta, setLocalConfig } from "@/utils/config/storage"
import { onMessage } from "@/utils/message"
import { personalVocabularyRepository } from "@/utils/personal-vocabulary/repository"
import { checkpoint } from "@/utils/webdav-sync/checkpoint"
import { WebDavClient } from "@/utils/webdav-sync/client"
import {
  mergeConfig,
  packConfig,
  projectConfig,
  restoreConfigCredentials,
  unpackConfig,
} from "@/utils/webdav-sync/config"
import { syncDataset } from "@/utils/webdav-sync/run"
import {
  defaultSettings,
  failure,
  parseSettings,
  settingsKey,
  statusKey,
  SyncError,
  syncKinds,
  syncModes,
  syncTarget,
} from "@/utils/webdav-sync/types"
import { mergeVocabulary, packVocabulary, unpackVocabulary } from "@/utils/webdav-sync/vocabulary"

const alarmName = "webdav-auto-incremental"
let running = false

async function readSettings() {
  return parseSettings((await storage.getItem(settingsKey)) ?? defaultSettings)
}

async function schedule(settings: SyncSettings) {
  if (!settings.automatic || !settings.url || !syncKinds.some((kind) => settings[kind])) {
    await browser.alarms.clear(alarmName)
    return
  }
  const alarm = await browser.alarms.get(alarmName)
  if (alarm?.periodInMinutes !== settings.interval) {
    await browser.alarms.create(alarmName, {
      delayInMinutes: settings.interval,
      periodInMinutes: settings.interval,
    })
  }
}

async function perform(
  mode: SyncStatus["mode"],
  ready: () => Promise<void>,
  expected?: SyncTarget,
): Promise<SyncStatus | null> {
  if (running) throw new SyncError("busy")
  running = true
  try {
    await ready()
    const settings = await readSettings()
    if (expected && !dequal(expected, syncTarget(settings))) throw new SyncError("changed")
    const selected = syncKinds.filter((kind) => settings[kind])
    if (!expected && !settings.automatic) return null
    if (!settings.url || !selected.length) throw new SyncError("settings")
    const client = new WebDavClient(settings)
    const results: SyncResults = {}
    for (const kind of selected) {
      try {
        const changed =
          kind === "config"
            ? await syncDataset(client, kind, mode, {
                read: async () => (await getLocalConfigAndMeta()).value,
                apply: async (before, next) => {
                  const { value } = await getLocalConfigAndMeta()
                  if (!dequal(value, before)) return false
                  await setLocalConfig(restoreConfigCredentials(value, next))
                  return true
                },
                project: projectConfig,
                pack: packConfig,
                unpack: unpackConfig,
                merge: mergeConfig,
                ...checkpoint(settings, kind),
              })
            : await syncDataset(client, kind, mode, {
                read: () => personalVocabularyRepository.createBackup(),
                apply: (before, next) =>
                  personalVocabularyRepository.applySyncSnapshot(before, next),
                project: (data) => data,
                pack: packVocabulary,
                unpack: unpackVocabulary,
                merge: mergeVocabulary,
                ...checkpoint(settings, kind),
              })
        results[kind] = { ok: true, changed }
      } catch (error) {
        results[kind] = failure(error)
      }
    }
    const status = { at: Date.now(), mode, results }
    await storage.setItem(statusKey, status)
    return status
  } finally {
    running = false
  }
}

function isOptionsPage(sender: { id?: string; url?: string }) {
  return (
    sender.id === browser.runtime.id &&
    sender.url?.split(/[?#]/u, 1)[0] === browser.runtime.getURL("/options.html")
  )
}

export function setupWebDavSync(ready: () => Promise<void>) {
  // Register listeners before any await so the browser can wake the worker for an alarm.
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === alarmName) await perform("incremental", ready).catch(() => {})
  })
  void readSettings()
    .then(schedule)
    .catch(() => {})

  onMessage("testWebDavConnection", async ({ sender, data }) => {
    if (!isOptionsPage(sender)) return failure(new SyncError("settings"))
    try {
      await new WebDavClient(parseSettings(data)).test()
      return { ok: true, changed: false }
    } catch (error) {
      return failure(error, "connection")
    }
  })
  onMessage("saveWebDavSettings", async ({ sender, data }) => {
    if (!isOptionsPage(sender)) return failure(new SyncError("settings"))
    if (running) return failure(new SyncError("busy"))
    running = true
    try {
      const settings = parseSettings(data)
      const previous = await readSettings()
      await storage.setItem(settingsKey, settings)
      if (previous.url !== settings.url || previous.username !== settings.username) {
        await storage.removeItem(statusKey)
      }
      await schedule(settings)
      return { ok: true, changed: false }
    } catch (error) {
      return failure(error)
    } finally {
      running = false
    }
  })
  onMessage("runWebDavSync", async ({ sender, data }) => {
    if (!isOptionsPage(sender) || !data?.target || !syncModes.includes(data.mode))
      return failure(new SyncError("settings"))
    try {
      return { ok: true, status: await perform(data.mode, ready, data.target) }
    } catch (error) {
      return failure(error)
    }
  })
}
