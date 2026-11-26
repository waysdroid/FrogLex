// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import * as React from "react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { FeaturesNav } from "../features-nav"
import { SettingsNav } from "../settings-nav"

vi.mock("@iconify/react", () => ({
  Icon: () => null,
}))

vi.mock("@/utils/i18n", () => ({
  i18n: { t: (key: string) => key },
}))

vi.mock("@/components/ui/base-ui/collapsible", () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <>{children}</>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}))

vi.mock("@/components/ui/base-ui/sidebar", () => {
  const Pass = ({ children }: { children: ReactNode }) => <>{children}</>
  function ButtonLink({
    children,
    render: renderElement,
    isActive,
  }: {
    children: ReactNode
    render: ReactElement<{ children?: ReactNode }>
    isActive?: boolean
  }) {
    return React.cloneElement(
      renderElement,
      { "aria-current": isActive ? "page" : undefined } as object,
      children,
    )
  }
  return {
    SidebarGroup: Pass,
    SidebarGroupContent: Pass,
    SidebarGroupLabel: Pass,
    SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
    SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
    SidebarMenuButton: ButtonLink,
    SidebarMenuSub: Pass,
    SidebarMenuSubItem: Pass,
    SidebarMenuSubButton: ButtonLink,
  }
})

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <SettingsNav />
    </MemoryRouter>,
  )
}

describe("SettingsNav", () => {
  it("lists the local options in order", () => {
    renderAt("/usage")

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/api-providers",
      "/preference",
      "/data-management",
      "/shortcuts",
    ])
    expect(screen.queryByRole("link", { name: "options.usage.title" })).toBeNull()
  })

  it("keeps Data Management selected while inspecting its configuration backups", () => {
    renderAt("/data-management/config-backup")

    expect(screen.getByRole("link", { name: "options.dataManagement.title" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("link", { name: "options.preference.title" })).not.toHaveAttribute(
      "aria-current",
    )
  })

  it("marks Preference as the page the options page opens on", () => {
    renderAt("/")

    expect(screen.getByRole("link", { name: "options.preference.title" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.queryByRole("link", { name: "options.usage.title" })).toBeNull()
    expect(screen.getByRole("link", { name: "options.apiProviders.title" })).not.toHaveAttribute(
      "aria-current",
    )
  })
})

it("puts Version and Updates last under Features and selects it on its own page", () => {
  render(
    <MemoryRouter initialEntries={["/version-updates"]}>
      <FeaturesNav />
    </MemoryRouter>,
  )

  const update = screen.getAllByRole("link").at(-1)
  expect(update).toHaveTextContent("options.preference.versionUpdates.title")
  expect(update).toHaveAttribute("href", "/version-updates")
  expect(update).toHaveAttribute("aria-current", "page")
})
