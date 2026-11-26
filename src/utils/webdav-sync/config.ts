import type { Chunks } from "./client"
import type { Config } from "@/types/config/config"
import { z } from "zod"
import { configSchema } from "@/types/config/config"
import { migrateConfig } from "@/utils/config/migration"
import { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG } from "@/utils/constants/config"
import { mergeRows, mergeValue } from "./merge"
import { SyncError } from "./types"

function safeEndpoint(value: string | undefined) {
  if (!value) return value
  try {
    const url = new URL(value)
    if (!(url.username || url.password || url.search || url.hash)) return value
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    return url.href
  } catch {
    return value.split(/[?#]/u, 1)[0]!.replace(/\/\/[^/]+@/u, "//")
  }
}

export function projectConfig(config: Config): Config {
  return {
    ...config,
    providersConfig: config.providersConfig.map((provider) => {
      if (
        !(
          "apiKey" in provider ||
          "headers" in provider ||
          "providerOptions" in provider ||
          "baseURL" in provider ||
          "url" in provider
        )
      )
        return provider
      // Provider options and arbitrary headers can contain tokens under unknown keys.
      const { apiKey, headers, providerOptions, ...publicFields } = provider
      void apiKey
      void headers
      void providerOptions
      if ("baseURL" in publicFields) publicFields.baseURL = safeEndpoint(publicFields.baseURL)
      if ("url" in publicFields) publicFields.url = safeEndpoint(publicFields.url) ?? ""
      return publicFields
    }),
  }
}

export function restoreConfigCredentials(current: Config, incoming: Config): Config {
  const providers = new Map(current.providersConfig.map((provider) => [provider.id, provider]))
  return configSchema.parse({
    ...incoming,
    providersConfig: incoming.providersConfig.map((provider) => {
      const previous = providers.get(provider.id)
      if (!previous || previous.provider !== provider.provider) return provider
      const urlKey = "url" in provider || "url" in previous ? "url" : "baseURL"
      const oldUrl = urlKey in previous ? (previous as Record<string, unknown>)[urlKey] : undefined
      const newUrl = urlKey in provider ? (provider as Record<string, unknown>)[urlKey] : undefined
      if (safeEndpoint(typeof oldUrl === "string" ? oldUrl : undefined) !== newUrl) return provider
      // Keep local-only fields on the same provider and endpoint.
      return {
        ...provider,
        ...Object.fromEntries(
          ["apiKey", "headers", "providerOptions", urlKey].flatMap((key) =>
            Object.hasOwn(previous, key) ? [[key, (previous as Record<string, unknown>)[key]]] : [],
          ),
        ),
      }
    }),
  })
}

export function packConfig(config: Config): Chunks {
  return new Map([["config", JSON.stringify({ schemaVersion: CONFIG_SCHEMA_VERSION, config })]])
}

export async function unpackConfig(chunks: Chunks) {
  try {
    const { config, schemaVersion } = z
      .object({
        config: z.unknown(),
        schemaVersion: z.number().int().positive(),
      })
      .parse(JSON.parse(chunks.get("config") ?? ""))
    return projectConfig(await migrateConfig(config, schemaVersion))
  } catch {
    throw new SyncError("invalid")
  }
}

export function mergeConfig(baseline: Config | undefined, local: Config, remote: Config): Config {
  const { providersConfig: baseProviders, ...base } = baseline ?? projectConfig(DEFAULT_CONFIG)
  const { providersConfig: localProviders, ...left } = local
  const { providersConfig: remoteProviders, ...right } = remote
  const providers = mergeRows(baseProviders, localProviders, remoteProviders, ({ id }) => id)
  const ids = ({ id }: { id: string }) => id
  const order = [
    ...(remoteProviders.map(ids).join("\n") === baseProviders.map(ids).join("\n")
      ? localProviders
      : remoteProviders),
    ...localProviders,
  ].map(ids)
  const rank = new Map([...new Set(order)].map((id, index) => [id, index]))
  const parsed = configSchema.safeParse({
    ...(mergeValue(base, left, right) as object),
    providersConfig: providers.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!),
  })
  if (!parsed.success) throw new SyncError("conflict")
  return parsed.data
}
