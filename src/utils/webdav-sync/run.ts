import type { Chunks } from "./client"
import type { SyncKind, SyncMode } from "./types"
import type { Config } from "@/types/config/config"
import type { VocabularyBackup } from "@/utils/personal-vocabulary/backup"
import { dequal } from "dequal"
import { sha256 } from "js-sha256"
import { WebDavClient } from "./client"
import { SyncError } from "./types"

export interface SyncData {
  config: Config
  vocabulary: VocabularyBackup
}

export interface SyncDataset<T> {
  read: () => Promise<T>
  apply: (before: T, next: T) => Promise<boolean>
  project: (value: T) => T
  pack: (value: T) => Chunks
  unpack: (chunks: Chunks) => T | Promise<T>
  merge: (baseline: T | undefined, local: T, remote: T) => T
  loadCheckpoint: () => Promise<T | undefined>
  saveCheckpoint: (data: T) => Promise<void>
}

export async function syncDataset<T>(
  client: WebDavClient,
  kind: SyncKind,
  mode: SyncMode,
  dataset: SyncDataset<T>,
) {
  const current = await dataset.read()
  const local = dataset.project(current)
  const localChunks = dataset.pack(local)
  const previous = await dataset.loadCheckpoint()
  const previousChunks = previous ? dataset.pack(previous) : undefined
  const remote = await client.readVersion(kind, mode === "push")

  if (mode === "push") {
    await client.upload(kind, localChunks, remote)
    await dataset.saveCheckpoint(local)
    return true
  }
  if (!remote?.manifest) {
    if (mode === "pull" || previous) throw new SyncError("missing")
    await client.upload(kind, localChunks, null)
    await dataset.saveCheckpoint(local)
    return true
  }

  const cached = new Map(
    [...(previousChunks?.values() ?? []), ...localChunks.values()].map((body) => [
      sha256(body),
      body,
    ]),
  )
  const remoteChunks = await client.download(kind, remote.manifest, cached)
  const incoming = await dataset.unpack(remoteChunks)
  const projectedRemoteChunks = dataset.pack(incoming)
  let next: T = incoming
  let nextChunks = projectedRemoteChunks
  if (mode === "incremental" && !dequal(localChunks, projectedRemoteChunks)) {
    // An unchanged side can be replaced directly, including propagated deletions.
    if (previousChunks && dequal(projectedRemoteChunks, previousChunks)) {
      next = local
      nextChunks = localChunks
    } else if (!previousChunks || !dequal(localChunks, previousChunks)) {
      next = dataset.merge(previous, local, incoming)
      nextChunks = dataset.pack(next)
    }
  }

  const publish = mode === "incremental" && !dequal(nextChunks, remoteChunks)
  const apply = !dequal(localChunks, nextChunks)
  if (publish) await client.upload(kind, nextChunks, remote)
  if (apply && !(await dataset.apply(current, next))) throw new SyncError("changed")
  if (!previousChunks || !dequal(previousChunks, nextChunks)) await dataset.saveCheckpoint(next)
  return publish || apply
}
