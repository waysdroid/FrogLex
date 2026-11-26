import { Navigate, useLocation } from "react-router"
import { i18n } from "@/utils/i18n"
import { getSectionIdFromSearch } from "../../command-palette/section-scroll"
import { ConfigSection } from "../../components/config-section"
import { PageLayout } from "../../components/page-layout"
import { AppearanceAndLanguageSection } from "./appearance-and-language"
import { ResetConfigItem } from "./config/reset-config"
import { ExtensionActivationSection } from "./extension-activation"
import { TranslationLanguageSection } from "./translation-language"

export function PreferencePage() {
  const { search } = useLocation()
  const section = getSectionIdFromSearch(search)
  if (section === "version-updates")
    return <Navigate to={{ pathname: "/version-updates", search }} replace />
  if (section === "manual-config-sync" || section === "webdav-sync") {
    return <Navigate to={{ pathname: "/data-management", search }} replace />
  }
  return (
    <PageLayout
      title={i18n.t("options.preference.title")}
      description={i18n.t("options.preference.pageDescription")}
      innerClassName="flex flex-col gap-10"
    >
      <AppearanceAndLanguageSection />
      <TranslationLanguageSection />
      <ExtensionActivationSection />
      <ConfigSection title={i18n.t("options.preference.config.title")}>
        <ResetConfigItem />
      </ConfigSection>
    </PageLayout>
  )
}
