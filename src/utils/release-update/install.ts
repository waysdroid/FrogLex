import type { UpdateRelease } from "./release"
import { dequal } from "dequal"
import { Dexie } from "dexie"
import { extractRelease, readInstallerManifest } from "./archive"
import { downloadRelease, UpdateError } from "./release"

type FilePermission = { mode: "readwrite" }
export interface UpdateFolder extends FileSystemDirectoryHandle {
  requestPermission: (options: FilePermission) => Promise<PermissionState>
}

type DirectoryPicker = (options: FilePermission & { id: string }) => Promise<UpdateFolder>
function folderPicker() {
  return (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
}

export function supportsFolderUpdates() {
  return typeof folderPicker() === "function" && !!navigator.locks
}

const db = new Dexie("read-frog-release-updates")
db.version(1).stores({ folders: "id" })
const folders = db.table<{ id: string; folder: UpdateFolder }, string>("folders")

export async function getUpdateFolder() {
  return (await folders.get("installation"))?.folder
}

export async function authorizeUpdateFolder(saved?: UpdateFolder) {
  if (saved) {
    if ((await saved.requestPermission({ mode: "readwrite" })) !== "granted") {
      throw new UpdateError("folder")
    }
    return saved
  }
  const picker = folderPicker()
  if (!picker) throw new UpdateError("folder")
  return picker.call(window, { mode: "readwrite", id: "read-frog-installation" })
}

async function location(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split("/")
  const name = parts.pop()!
  let folder = root
  for (const part of parts) {
    folder = await folder.getDirectoryHandle(part, { create })
  }
  return { folder, name }
}

async function readFile(root: FileSystemDirectoryHandle, path: string) {
  try {
    const { folder, name } = await location(root, path, false)
    return await (await folder.getFileHandle(name)).getFile()
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return undefined
    throw error
  }
}

async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  data: BufferSource | Blob | string,
) {
  const { folder, name } = await location(root, path, true)
  const writer = await (await folder.getFileHandle(name, { create: true })).createWritable()
  try {
    await writer.write(data)
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }
}

async function removeFile(root: FileSystemDirectoryHandle, path: string) {
  try {
    const { folder, name } = await location(root, path, false)
    await folder.removeEntry(name)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error
  }
}

async function packagedFile(path: string) {
  // Relative requests stay inside this extension's origin, including after a reload.
  return globalThis.fetch(new URL(path, window.location.href), { cache: "no-store" })
}

async function verifyInstallationFolder(root: FileSystemDirectoryHandle, expected: unknown) {
  try {
    const file = await readFile(root, "manifest.json")
    if (
      !file ||
      !dequal(readInstallerManifest(JSON.parse(await file.text())), readInstallerManifest(expected))
    ) {
      throw new UpdateError("folder")
    }

    // Two copies of the same ZIP can have an identical manifest. Verify that a
    // random, disposable file in the chosen folder is visible to this extension.
    const nonce = crypto.randomUUID()
    const probe = `read-frog-installation-${nonce}.txt`
    try {
      await writeFile(root, probe, nonce)
      const response = await packagedFile(probe)
      if (!response.ok || (await response.text()) !== nonce) throw new UpdateError("folder")
    } finally {
      await removeFile(root, probe)
    }
  } catch {
    throw new UpdateError("folder")
  }
}

type FileChange = { path: string; before: File | undefined; after: Uint8Array<ArrayBuffer> }

export async function installFiles(
  root: FileSystemDirectoryHandle,
  files: Map<string, Uint8Array<ArrayBuffer>>,
  backupName: string,
) {
  const changes: FileChange[] = []
  const attempted: FileChange[] = []
  try {
    // New files can be in place before anything currently loaded is replaced.
    // Write the manifest last so Chrome sees the previous version until then.
    for (const [path, after] of files) {
      const before = await readFile(root, path)
      if (
        before &&
        before.size === after.byteLength &&
        dequal(new Uint8Array(await before.arrayBuffer()), after)
      ) {
        continue
      }
      changes.push({ path, before, after })
    }
    changes.sort(
      (a, b) =>
        Number(a.path === "manifest.json") - Number(b.path === "manifest.json") ||
        Number(!!a.before) - Number(!!b.before),
    )
    const backup = await root.getDirectoryHandle(backupName, { create: true })
    for (const { path, before } of changes) {
      if (before) await writeFile(backup, path, before)
    }
    for (const change of changes) {
      attempted.push(change)
      await writeFile(root, change.path, change.after)
    }
  } catch {
    let restoreFailed = false
    attempted
      .reverse()
      .sort((a, b) => Number(a.path === "manifest.json") - Number(b.path === "manifest.json"))
    for (const { path, before } of attempted) {
      try {
        if (before) {
          const backup = await root.getDirectoryHandle(backupName)
          const original = await readFile(backup, path)
          if (!original) throw new UpdateError("restore")
          await writeFile(root, path, original)
        } else {
          await removeFile(root, path)
        }
      } catch {
        restoreFailed = true
      }
    }
    throw new UpdateError(restoreFailed ? "restore" : "write")
  }
}

export async function applyRelease(release: UpdateRelease, folder: UpdateFolder) {
  return navigator.locks.request(
    "read-frog-release-install",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new UpdateError("write")
      const response = await packagedFile("manifest.json")
      if (!response.ok) throw new UpdateError("folder")
      const current: unknown = await response.json()
      const manifest = readInstallerManifest(current)
      const zip = await downloadRelease(release)
      const files = await extractRelease(zip, current, release.version)
      await verifyInstallationFolder(folder, current)
      // A handle that cannot be persisted can still finish the currently authorized update.
      await folders.put({ id: "installation", folder }).catch(() => {})
      const backupName = `read-frog-backup-v${manifest.version}-${crypto.randomUUID().slice(0, 8)}`
      await installFiles(folder, files, backupName)
    },
  )
}
