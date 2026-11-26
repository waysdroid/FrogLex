import { IconExternalLink } from "@tabler/icons-react"
import { Link } from "react-router"
import { browser } from "#imports"
import { buttonVariants } from "@/components/ui/base-ui/button"
import { i18n } from "@/utils/i18n"
import { ConfigItem } from "../../components/config-item"
import { ConfigSection } from "../../components/config-section"

const linkClassName = buttonVariants({ size: "sm", variant: "outline" })

export function VersionUpdatesSection() {
  const manifest = browser.runtime.getManifest()
  return (
    <ConfigSection id="version-updates" title={i18n.t("options.preference.versionUpdates.title")}>
      <ConfigItem
        orientation="vertical"
        title={i18n.t("options.preference.versionUpdates.current", [
          manifest.version_name ?? manifest.version,
        ])}
        description={i18n.t("options.preference.versionUpdates.instructions")}
      >
        <div className="flex flex-wrap gap-2">
          <a
            href="https://github.com/waysdroid/read-frog/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
          >
            {i18n.t("options.preference.versionUpdates.releases")}
            <IconExternalLink aria-hidden="true" />
          </a>
          <Link
            to="/personal-vocabulary?transfer=1&section=vocabulary-backup"
            className={linkClassName}
          >
            {i18n.t("options.preference.versionUpdates.vocabularyBackup")}
          </Link>
          <Link to="/preference/config-backup" className={linkClassName}>
            {i18n.t("options.preference.config.backup.title")}
          </Link>
        </div>
      </ConfigItem>
    </ConfigSection>
  )
}
