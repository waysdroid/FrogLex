import { z } from "zod"

export const nutstoreRoot = "https://dav.jianguoyun.com/dav/"
export const nutstoreDefaultFolder = new URL("read-frog/", nutstoreRoot).href

export function isNutstoreDirectory(url: URL) {
  return url.origin === "https://dav.jianguoyun.com" && url.pathname.startsWith("/dav/")
}

export const settingsKey = "local:webdav-sync-settings"
export const statusKey = "local:webdav-sync-status"
export const syncKinds = ["config", "vocabulary"] as const
export type SyncKind = (typeof syncKinds)[number]
export const syncModes = ["incremental", "push", "pull"] as const
export type SyncMode = (typeof syncModes)[number]

export const settingsSchema = z.object({
  url: z.string().trim(),
  username: z.string().refine((value) => !value.includes(":")),
  password: z.string(),
  config: z.boolean(),
  vocabulary: z.boolean(),
  automatic: z.boolean(),
  interval: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
})
export type SyncSettings = z.output<typeof settingsSchema>
export type SyncTarget = Pick<SyncSettings, "url" | "username" | SyncKind>

export function syncTarget({ url, username, config, vocabulary }: SyncSettings): SyncTarget {
  return { url, username, config, vocabulary }
}
export const defaultSettings: SyncSettings = {
  url: "",
  username: "",
  password: "",
  config: true,
  vocabulary: true,
  automatic: false,
  interval: 30,
}

export type SyncErrorCode =
  | "settings"
  | "connection"
  | "auth"
  | "writeDenied"
  | "rateLimited"
  | "folder"
  | "server"
  | "validator"
  | "changed"
  | "missing"
  | "invalid"
  | "conflict"
  | "local"
  | "busy"

export class SyncError extends Error {
  constructor(readonly code: SyncErrorCode) {
    super(code)
  }
}

export type SyncOutcome = { ok: true; changed: boolean } | { ok: false; error: SyncErrorCode }
export type SyncResults = Partial<Record<SyncKind, SyncOutcome>>
export interface SyncStatus {
  at: number
  mode: SyncMode
  results: SyncResults
}

export function davDirectory(input: string) {
  try {
    const address = /^dav\.jianguoyun\.com(?:\/|$)/iu.test(input) ? `https://${input}` : input
    const url = new URL(address)
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new SyncError("settings")
    if (!url.pathname.endsWith("/")) url.pathname += "/"
    if (url.href === nutstoreRoot || url.href === new URL("/", nutstoreRoot).href) {
      return new URL(nutstoreDefaultFolder)
    }
    return url
  } catch {
    throw new SyncError("settings")
  }
}

export function parseSettings(input: unknown) {
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) throw new SyncError("settings")
  const settings = parsed.data
  if (!settings.url) return { ...settings, automatic: false }
  return { ...settings, url: davDirectory(settings.url).href }
}

export function failure(
  error: unknown,
  fallback: SyncErrorCode = "local",
): Extract<SyncOutcome, { ok: false }> {
  return { ok: false, error: error instanceof SyncError ? error.code : fallback }
}
