import { MAX_BACKUPS_COUNT } from "@/utils/constants/backup"
import { i18n } from "@/utils/i18n"
import { ConfigNavItem } from "../../components/config-nav-item"
import { ConfigSection } from "../../components/config-section"
import { PageLayout } from "../../components/page-layout"
import { ManualConfigSyncConfigItems } from "../preference/config/manual-config-sync"
import { WebDavSyncSection } from "../preference/webdav-sync"

export function DataManagementPage() {
  return (
    <PageLayout
      title={i18n.t("options.dataManagement.title")}
      description={i18n.t("options.dataManagement.description")}
      innerClassName="flex flex-col gap-10"
    >
      <ConfigSection id="data-management" title={i18n.t("options.dataManagement.local")}>
        <ManualConfigSyncConfigItems />
        <ConfigNavItem
          to="/data-management/config-backup"
          title={i18n.t("options.preference.config.backup.title")}
          description={i18n.t("options.preference.config.backup.description", [MAX_BACKUPS_COUNT])}
        />
        <ConfigNavItem
          to="/personal-vocabulary?transfer=1"
          title={i18n.t("options.dataManagement.vocabulary")}
          description={i18n.t("options.dataManagement.vocabularyDescription")}
        />
      </ConfigSection>
      <WebDavSyncSection />
    </PageLayout>
  )
}
