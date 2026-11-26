// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import { WebDavSyncSection } from "@/entrypoints/options/pages/preference/webdav-sync"
import { defaultSettings, settingsKey, syncTarget } from "../types"

const mocks = vi.hoisted(() => ({
  read: vi.fn<(key: string) => Promise<typeof configured | null>>(),
  send: vi.fn<(command: string, data: unknown) => Promise<{ ok: boolean; status: null }>>(),
}))
vi.mock("wxt/utils/storage", () => ({
  storage: { getItem: mocks.read, watch: () => () => {} },
}))
vi.mock("@/utils/message", () => ({ sendMessage: mocks.send }))

const base = "options.preference.webdav"
const configured = { ...defaultSettings, url: "https://dav.example.test/read-frog/" }

beforeEach(() => {
  mocks.send.mockReset()
  mocks.send.mockResolvedValue({ ok: true, status: null })
  mocks.read.mockImplementation(async (key) => (key === settingsKey ? configured : null))
})

it("confirms destination replacement and sends the dataset selection used in the confirmation", async () => {
  render(<WebDavSyncSection />)
  const overwrite = await screen.findByRole("button", { name: `${base}.mode.pull` })
  await waitFor(() => expect(overwrite).toBeEnabled())
  fireEvent.click(overwrite)
  let dialog = await screen.findByRole("alertdialog")
  expect(within(dialog).getByText(`${base}.confirm.pull`)).toBeVisible()
  expect(mocks.send).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole("button", { name: `${base}.cancel` }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  expect(mocks.send).not.toHaveBeenCalled()
  fireEvent.click(overwrite)
  dialog = await screen.findByRole("alertdialog")
  fireEvent.click(within(dialog).getByRole("button", { name: `${base}.confirmAction` }))
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith("runWebDavSync", {
    mode: "pull",
    target: syncTarget(configured),
  })
})

it("keeps synchronization disabled when the user changes the connected folder without saving", async () => {
  render(<WebDavSyncSection />)
  const input = await screen.findByLabelText(`${base}.url`)
  await waitFor(() => expect(input).toHaveValue(configured.url))
  fireEvent.change(input, { target: { value: "https://other.example.test/read-frog/" } })
  expect(screen.getByRole("button", { name: `${base}.mode.incremental` })).toBeDisabled()
  expect(screen.getByRole("button", { name: `${base}.save` })).toBeEnabled()
})
