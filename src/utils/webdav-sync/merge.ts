import { dequal } from "dequal"
import { SyncError } from "./types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Merge JSON values against the last shared version. Concurrent edits to the
 * same value require an explicit choice before either side is overwritten. */
export function mergeValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (dequal(local, remote) || dequal(remote, base)) return local
  if (dequal(local, base)) return remote
  if (isRecord(local) && isRecord(remote) && (base === undefined || isRecord(base))) {
    const keys = new Set([
      ...Object.keys(base ?? {}),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])
    return Object.fromEntries(
      [...keys].flatMap((key) => {
        const value = mergeValue(
          base && Object.hasOwn(base, key) ? base[key] : undefined,
          Object.hasOwn(local, key) ? local[key] : undefined,
          Object.hasOwn(remote, key) ? remote[key] : undefined,
        )
        return value === undefined ? [] : [[key, value]]
      }),
    )
  }
  throw new SyncError("conflict")
}

export function mergeRows<T>(
  base: T[],
  local: T[],
  remote: T[],
  key: (row: T) => string,
  merge = mergeValue as (
    base: T | undefined,
    local: T | undefined,
    remote: T | undefined,
  ) => T | undefined,
): T[] {
  const old = new Map(base.map((row) => [key(row), row]))
  const left = new Map(local.map((row) => [key(row), row]))
  const right = new Map(remote.map((row) => [key(row), row]))
  const keys = new Set([...left.keys(), ...right.keys()])
  return [...keys].sort().flatMap((id) => {
    const row = merge(old.get(id), left.get(id), right.get(id))
    return row === undefined ? [] : [row]
  })
}
