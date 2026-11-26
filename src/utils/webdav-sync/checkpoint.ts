import type { SyncData } from "./run"
import type { SyncKind, SyncSettings } from "./types"
import { Dexie } from "dexie"
import { sha256 } from "js-sha256"

interface Checkpoint {
  kind: SyncKind
  endpoint: string
  data: SyncData[SyncKind]
}

const db = new Dexie("read-frog-webdav-sync")
db.version(1).stores({ checkpoints: "kind" })
const table = db.table<Checkpoint, SyncKind>("checkpoints")

export function checkpoint<K extends SyncKind>(settings: SyncSettings, kind: K) {
  // Key by directory and account. A password rotation does not break the baseline.
  const endpoint = sha256(JSON.stringify([settings.url, settings.username]))
  return {
    async loadCheckpoint() {
      const row = await table.get(kind)
      return row?.endpoint === endpoint ? (row.data as SyncData[K]) : undefined
    },
    async saveCheckpoint(data: SyncData[K]) {
      await table.put({ kind, endpoint, data })
    },
  }
}
