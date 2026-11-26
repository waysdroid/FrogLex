import type { UpdateFolder } from "@/utils/release-update/install"
import type { UpdateBrowser, UpdateRelease } from "@/utils/release-update/release"
import { IconExternalLink } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { Link } from "react-router"
import { browser } from "#imports"
import { Button, buttonVariants } from "@/components/ui/base-ui/button"
import { i18n } from "@/utils/i18n"
import {
  applyRelease,
  authorizeUpdateFolder,
  getUpdateFolder,
  supportsFolderUpdates,
} from "@/utils/release-update/install"
import {
  checkForRelease,
  compareVersions,
  releasesUrl,
  UpdateError,
} from "@/utils/release-update/release"
import { ConfigItem } from "../../components/config-item"
import { PageLayout } from "../../components/page-layout"

const linkClassName = buttonVariants({ size: "sm", variant: "outline" })
const key = "options.preference.versionUpdates"

function updateTarget(): UpdateBrowser | undefined {
  if (import.meta.env.BROWSER === "chrome" || import.meta.env.BROWSER === "edge") {
    return import.meta.env.BROWSER
  }
  return undefined
}

export function VersionUpdatesPage() {
  const manifest = browser.runtime.getManifest()
  const version = manifest.version_name ?? manifest.version
  const target = updateTarget()
  const [release, setRelease] = useState<UpdateRelease>()
  const [folder, setFolder] = useState<UpdateFolder>()
  const [canInstall, setCanInstall] = useState(false)
  const [working, setWorking] = useState<"check" | "install">()
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()

  useEffect(() => {
    if (!target || !supportsFolderUpdates()) return undefined
    let active = true
    async function load() {
      const extension = await browser.management.getSelf()
      if (extension.installType !== "development") return
      const saved = await getUpdateFolder().catch(() => undefined)
      if (!active) return
      setFolder(saved)
      setCanInstall(true)
    }
    void load().catch(() => {})
    return () => {
      active = false
    }
  }, [target])

  async function check() {
    if (!target) return
    setWorking("check")
    setMessage(undefined)
    setRelease(undefined)
    try {
      const latest = await checkForRelease(target)
      if (compareVersions(latest.version, version) > 0) setRelease(latest)
      else setMessage({ text: i18n.t(`${key}.currentLatest`) })
    } catch (error) {
      const code = error instanceof UpdateError ? error.code : "network"
      setMessage({ text: i18n.t(`${key}.error.${code}`), error: true })
    } finally {
      setWorking(undefined)
    }
  }

  async function install(reselect = false) {
    if (!release) return
    setWorking("install")
    setMessage(undefined)
    try {
      // The picker must run as part of the click, before fetching the package.
      const chosen = await authorizeUpdateFolder(reselect ? undefined : folder)
      const guardPageClose = (event: BeforeUnloadEvent) => {
        event.preventDefault()
        event.returnValue = ""
      }
      window.addEventListener("beforeunload", guardPageClose)
      try {
        await applyRelease(release, chosen)
      } finally {
        window.removeEventListener("beforeunload", guardPageClose)
      }
      browser.runtime.reload()
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const code = error instanceof UpdateError ? error.code : "folder"
        setMessage({ text: i18n.t(`${key}.error.${code}`), error: true })
      }
    } finally {
      setWorking(undefined)
    }
  }

  return (
    <PageLayout title={i18n.t(`${key}.title`)} description={i18n.t(`${key}.instructions`)}>
      <ConfigItem
        id="version-updates"
        orientation="vertical"
        title={i18n.t(`${key}.current`, [version])}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {target && (
              <Button size="sm" variant="outline" disabled={!!working} onClick={() => void check()}>
                {i18n.t(`${key}.check`)}
              </Button>
            )}
            <a
              href={`${releasesUrl}/latest`}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClassName}
            >
              {i18n.t(`${key}.releases`)}
              <IconExternalLink aria-hidden="true" />
            </a>
            <Link
              to="/personal-vocabulary?transfer=1&section=vocabulary-backup"
              className={linkClassName}
            >
              {i18n.t(`${key}.vocabularyBackup`)}
            </Link>
            <Link to="/data-management/config-backup" className={linkClassName}>
              {i18n.t("options.preference.config.backup.title")}
            </Link>
          </div>
          {release && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">{i18n.t(`${key}.available`, [release.version])}</p>
              <p className="text-sm text-muted-foreground">
                {i18n.t(`${key}.${canInstall ? "folderHint" : "manualHint"}`)}
              </p>
              <div className="flex flex-wrap gap-2">
                {canInstall && (
                  <>
                    <Button size="sm" disabled={!!working} onClick={() => void install()}>
                      {i18n.t(`${key}.install`)}
                    </Button>
                    {folder && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!working}
                        onClick={() => void install(true)}
                      >
                        {i18n.t(`${key}.reselect`)}
                      </Button>
                    )}
                  </>
                )}
                <a href={release.assetUrl} className={linkClassName}>
                  {i18n.t(`${key}.download`)}
                </a>
                <a
                  href={release.notesUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClassName}
                >
                  {i18n.t(`${key}.notes`)}
                  <IconExternalLink aria-hidden="true" />
                </a>
              </div>
            </div>
          )}
          <div aria-live="polite">
            {working && (
              <p className="text-sm text-muted-foreground">
                {i18n.t(`${key}.${working === "check" ? "checking" : "installing"}`)}
              </p>
            )}
            {message && (
              <p
                className={
                  message.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
                }
              >
                {message.text}
              </p>
            )}
          </div>
        </div>
      </ConfigItem>
    </PageLayout>
  )
}
