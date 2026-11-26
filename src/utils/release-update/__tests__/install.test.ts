import { expect, it } from "vitest"
import { installFiles } from "../install"

function installation() {
  const files = new Map([
    ["manifest.json", "old manifest"],
    ["options.html", "old page"],
    ["chunks/shared.js", "same"],
    ["personal-notes.txt", "keep"],
  ])
  const directories = new Set(["", "chunks/"])
  const writes: string[] = []
  let failPath = ""
  function directory(parent = "") {
    return {
      getDirectoryHandle: async (name: string, { create = false } = {}) => {
        const path = `${parent}${name}/`
        if (!directories.has(path) && !create) throw new DOMException("Missing", "NotFoundError")
        directories.add(path)
        return directory(path)
      },
      getFileHandle: async (name: string, { create = false } = {}) => {
        const path = `${parent}${name}`
        if (!files.has(path) && !create) throw new DOMException("Missing", "NotFoundError")
        if (!files.has(path)) files.set(path, "")
        return {
          getFile: async () => new File([files.get(path)!], name),
          createWritable: async () => {
            let buffer = ""
            return {
              write: async (data: Blob | Uint8Array) => {
                if (path === failPath) {
                  failPath = ""
                  throw new Error("simulated disk failure")
                }
                buffer = data instanceof Blob ? await data.text() : new TextDecoder().decode(data)
              },
              close: async () => {
                writes.push(path)
                files.set(path, buffer)
              },
              abort: async () => {},
            }
          },
        }
      },
      removeEntry: async (name: string) => {
        files.delete(`${parent}${name}`)
      },
    } as unknown as FileSystemDirectoryHandle
  }
  return {
    files,
    writes,
    handle: directory(),
    failOn(path: string) {
      failPath = path
    },
  }
}
const changes = new Map(
  [
    ["manifest.json", "new manifest"],
    ["options.html", "new page"],
    ["chunks/shared.js", "same"],
    ["chunks/new.js", "new script"],
  ].map(([path, contents]) => [path!, new TextEncoder().encode(contents)]),
)

it("backs up replaced files, writes the manifest last, and retains other files", async () => {
  const disk = installation()
  await installFiles(disk.handle, changes, "backup")
  expect(disk.writes).toEqual([
    "backup/options.html",
    "backup/manifest.json",
    "chunks/new.js",
    "options.html",
    "manifest.json",
  ])
  expect(disk.files.get("manifest.json")).toBe("new manifest")
  expect(disk.files.get("backup/manifest.json")).toBe("old manifest")
  expect(disk.files.get("personal-notes.txt")).toBe("keep")
})

it("restores replacements and removes partial additions when the browser refuses a write", async () => {
  const disk = installation()
  disk.failOn("manifest.json")
  await expect(installFiles(disk.handle, changes, "backup")).rejects.toMatchObject({
    code: "write",
  })
  expect(disk.files.get("manifest.json")).toBe("old manifest")
  expect(disk.files.get("options.html")).toBe("old page")
  expect(disk.files.has("chunks/new.js")).toBe(false)
  expect(disk.files.get("personal-notes.txt")).toBe("keep")
})
