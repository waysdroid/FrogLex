import type { SyncMode, SyncOutcome, SyncSettings, SyncStatus } from "@/utils/webdav-sync/types"
import { dequal } from "dequal"
import { useEffect, useState } from "react"
import { storage } from "#imports"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import { getUiLocale, i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import {
  defaultSettings,
  parseSettings,
  settingsKey,
  statusKey,
  syncKinds,
  syncTarget,
} from "@/utils/webdav-sync/types"
import { ConfigSection } from "../../components/config-section"

const key = "options.preference.webdav"

export function WebDavSyncSection() {
  const [saved, setSaved] = useState<SyncSettings>()
  const [draft, setDraft] = useState(defaultSettings)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [pending, setPending] = useState<"test" | "save" | SyncMode>()
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  const [cover, setCover] = useState<"push" | "pull">()

  useEffect(() => {
    let active = true
    const stopWatching = storage.watch<SyncStatus>(statusKey, (next) => setStatus(next))
    async function load() {
      try {
        const [settings, last] = await Promise.all([
          storage.getItem<SyncSettings>(settingsKey),
          storage.getItem<SyncStatus>(statusKey),
        ])
        if (!active) return
        const initial = parseSettings(settings ?? defaultSettings)
        setSaved(initial)
        setDraft(initial)
        setStatus(last)
      } catch {
        if (active) setNotice({ text: i18n.t(`${key}.error.local`), error: true })
      }
    }
    void load()
    return () => {
      active = false
      stopWatching()
    }
  }, [])

  function edit<K extends keyof SyncSettings>(field: K, value: SyncSettings[K]) {
    setDraft((previous) => ({ ...previous, [field]: value }))
    setNotice(undefined)
  }

  function report(outcome: SyncOutcome, successKey: "saved" | "connected" | "finished") {
    setNotice(
      outcome.ok
        ? { text: i18n.t(`${key}.${successKey}`) }
        : { text: i18n.t(`${key}.error.${outcome.error}`), error: true },
    )
  }

  async function execute(action: NonNullable<typeof pending>) {
    setPending(action)
    setNotice(undefined)
    try {
      if (action === "test") {
        report(await sendMessage("testWebDavConnection", draft), "connected")
      } else if (action === "save") {
        const result = await sendMessage("saveWebDavSettings", draft)
        if (result.ok) {
          const normalized = parseSettings(draft)
          setDraft(normalized)
          setSaved(normalized)
        }
        report(result, "saved")
      } else {
        const result = await sendMessage("runWebDavSync", {
          mode: action,
          target: syncTarget(draft),
        })
        if (result.ok && result.status) setStatus(result.status)
        else if (!result.ok) report(result, "finished")
      }
    } catch {
      setNotice({ text: i18n.t(`${key}.error.local`), error: true })
    } finally {
      setPending(undefined)
    }
  }

  const dirty = !dequal(saved, draft)
  const selected = syncKinds.filter((kind) => draft[kind])
  const canRun = !pending && !dirty && !!saved?.url && selected.length > 0
  const formatTime = (at: number) =>
    new Intl.DateTimeFormat(getUiLocale(), { dateStyle: "medium", timeStyle: "short" }).format(at)
  return (
    <ConfigSection id="webdav-sync" title={i18n.t(`${key}.title`)} contentClassName="gap-4">
      <p className="text-sm text-muted-foreground">{i18n.t(`${key}.description`)}</p>
      <div className="space-y-4 rounded-xl border p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            {i18n.t(`${key}.url`)}
            <Input
              type="url"
              placeholder="https://nas.example.com/dav/read-frog/"
              value={draft.url}
              disabled={!saved || !!pending}
              onChange={(event) => edit("url", event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {i18n.t(`${key}.username`)}
            <Input
              value={draft.username}
              disabled={!saved || !!pending}
              autoComplete="off"
              onChange={(event) => edit("username", event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {i18n.t(`${key}.password`)}
            <Input
              type="password"
              value={draft.password}
              disabled={!saved || !!pending}
              autoComplete="off"
              onChange={(event) => edit("password", event.target.value)}
            />
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-x-6 gap-y-2" disabled={!saved || !!pending}>
          <legend className="mb-2 text-sm font-medium">{i18n.t(`${key}.data`)}</legend>
          {syncKinds.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-sm">
              <Input
                type="checkbox"
                className="size-4 accent-primary"
                checked={draft[kind]}
                onChange={(event) => edit(kind, event.target.checked)}
              />
              {i18n.t(`${key}.kind.${kind}`)}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <label className="flex min-h-8 items-center gap-2 text-sm font-medium">
            <Input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.automatic}
              disabled={!saved || !!pending}
              onChange={(event) => edit("automatic", event.target.checked)}
            />
            {i18n.t(`${key}.automatic`)}
          </label>
          {draft.automatic && (
            <select
              aria-label={i18n.t(`${key}.interval`)}
              value={draft.interval}
              disabled={!saved || !!pending}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              onChange={(event) =>
                edit("interval", Number(event.target.value) as SyncSettings["interval"])
              }
            >
              {([15, 30, 60, 120] as const).map((minutes) => (
                <option key={minutes} value={minutes}>
                  {i18n.t(`${key}.minutes`, [minutes])}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!draft.url.trim() || !!pending || !saved}
            onClick={() => void execute("test")}
          >
            {i18n.t(`${key}.test`)}
          </Button>
          <Button disabled={!dirty || !!pending || !saved} onClick={() => void execute("save")}>
            {i18n.t(`${key}.save`)}
          </Button>
        </div>
      </div>
      <div className="space-y-3 rounded-xl border p-4">
        <h3 className="text-sm font-medium">{i18n.t(`${key}.manual`)}</h3>
        <p className="text-sm text-muted-foreground">{i18n.t(`${key}.modes`)}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!canRun} onClick={() => void execute("incremental")}>
            {i18n.t(`${key}.mode.incremental`)}
          </Button>
          {(["push", "pull"] as const).map((mode) => (
            <Button key={mode} variant="outline" disabled={!canRun} onClick={() => setCover(mode)}>
              {i18n.t(`${key}.mode.${mode}`)}
            </Button>
          ))}
        </div>
        {dirty && saved && (
          <p className="text-xs text-muted-foreground">{i18n.t(`${key}.unsaved`)}</p>
        )}
        <div aria-live="polite" className="space-y-1 text-sm">
          {pending && <p className="text-muted-foreground">{i18n.t(`${key}.working`)}</p>}
          {notice && (
            <p className={notice.error ? "text-destructive" : "text-muted-foreground"}>
              {notice.text}
            </p>
          )}
          {!pending && status && (
            <>
              <p className="text-muted-foreground">
                {i18n.t(`${key}.lastRun`, [
                  formatTime(status.at),
                  i18n.t(`${key}.mode.${status.mode}`),
                ])}
              </p>
              <ul className="space-y-1">
                {syncKinds.map((kind) => {
                  const outcome = status.results[kind]
                  if (!outcome) return null
                  return (
                    <li key={kind} className={outcome.ok ? undefined : "text-destructive"}>
                      {i18n.t(`${key}.result`, [
                        i18n.t(`${key}.kind.${kind}`),
                        outcome.ok
                          ? i18n.t(`${key}.${outcome.changed ? "finished" : "unchanged"}`)
                          : i18n.t(`${key}.error.${outcome.error}`),
                      ])}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </div>
      <AlertDialog
        open={!!cover}
        onOpenChange={(open) => {
          if (!open) setCover(undefined)
        }}
      >
        {cover && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{i18n.t(`${key}.mode.${cover}`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {i18n.t(`${key}.confirm.${cover}`, [
                  selected.map((kind) => i18n.t(`${key}.kind.${kind}`)).join(" / "),
                ])}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{i18n.t(`${key}.cancel`)}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={!canRun}
                onClick={() => {
                  setCover(undefined)
                  void execute(cover)
                }}
              >
                {i18n.t(`${key}.confirmAction`)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfigSection>
  )
}
