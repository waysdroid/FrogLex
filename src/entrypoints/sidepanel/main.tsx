import "@/utils/zod-config"
import type { ThemeMode } from "@/types/config/theme"
import { Provider as JotaiProvider } from "jotai"
import { useHydrateAtoms } from "jotai/utils"
import readFrogLogo from "@/assets/icons/read-frog.png?url&no-inline"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { baseThemeModeAtom } from "@/utils/atoms/theme"
import { i18n, initI18n } from "@/utils/i18n"
import { setupExtensionPageLogging } from "@/utils/logging/setup"
import { renderPersistentReactRoot } from "@/utils/react-root"
import { getLocalThemeMode } from "@/utils/theme"
import "@fontsource-variable/inter/index.css"
import "@/assets/styles/text-small.css"
import "@/assets/styles/theme.css"

setupExtensionPageLogging("sidepanel")

function HydrateAtoms({
  initialValues,
  children,
}: {
  initialValues: [[typeof baseThemeModeAtom, ThemeMode]]
  children: React.ReactNode
}) {
  useHydrateAtoms(initialValues)
  return children
}

function SidePanelShell() {
  const name = i18n.t("name")
  return (
    <main className="flex min-h-screen flex-col bg-background px-5 py-6 text-foreground">
      <section className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <img src={readFrogLogo} alt={name} className="size-16 rounded-full" />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
          <p className="text-sm text-muted-foreground">Side Panel is coming soon.</p>
        </div>
      </section>
    </main>
  )
}

async function initApp() {
  const root = document.getElementById("root")!
  root.className = "min-h-screen bg-background text-base antialiased"

  const [themeMode] = await Promise.all([getLocalThemeMode(), initI18n()])

  renderPersistentReactRoot(
    root,
    <JotaiProvider>
      <HydrateAtoms initialValues={[[baseThemeModeAtom, themeMode]]}>
        <ThemeProvider>
          <SidePanelShell />
        </ThemeProvider>
      </HydrateAtoms>
    </JotaiProvider>,
  )
}

void initApp()
