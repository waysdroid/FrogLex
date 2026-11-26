// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import * as React from "react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import { SettingsNav } from "../settings-nav"

vi.mock("@iconify/react", () => ({
  Icon: () => null,
}))

vi.mock("@/utils/i18n", () => ({
  i18n: { t: (key: string) => key },
}))

vi.mock("@/components/ui/base-ui/sidebar", () => {
  const Pass = ({ children }: { children: ReactNode }) => <>{children}</>
  return {
    SidebarGroup: Pass,
    SidebarGroupContent: Pass,
    SidebarGroupLabel: Pass,
    SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
    SidebarMenuItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
    SidebarMenuButton: ({
      children,
      render: renderElement,
      isActive,
    }: {
      children: ReactNode
      render: ReactElement<{ children?: ReactNode }>
      isActive?: boolean
    }) =>
      React.cloneElement(
        renderElement,
        { "aria-current": isActive ? "page" : undefined } as object,
        children,
      ),
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
      "/shortcuts",
    ])
    expect(screen.queryByRole("link", { name: "options.usage.title" })).toBeNull()
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
