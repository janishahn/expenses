import type { APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures"
import { getCsrfToken } from "./helpers"

async function createTag(request: APIRequestContext, token: string, name: string): Promise<number> {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

test.describe("Tag Detail Page", () => {
  test("edits settings as they change and keeps them after reload", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const originalName = `E2E Tag Edit ${Date.now()}`
    const tagId = await createTag(request, token, originalName)

    await page.goto(`/tags/${tagId}?period=all`)
    const settings = page.getByRole("region", { name: "Settings" })
    await expect(settings.getByRole("switch", { name: "Count in budgets" })).toBeChecked()
    await expect(settings.getByRole("switch", { name: "Show in filter menus" })).toBeChecked()

    const updatedName = `${originalName} Updated`
    await settings.getByRole("button", { name: /^Name/ }).click()
    const namePopover = page.getByRole("dialog", { name: "Name" })
    await namePopover.getByLabel("Name").fill("")
    await namePopover.getByRole("button", { name: "Save" }).click()
    await expect(namePopover.getByText("Enter a tag name.")).toBeVisible()
    await namePopover.getByLabel("Name").fill(updatedName)
    await namePopover.getByRole("button", { name: "Save" }).click()
    await expect(page.getByRole("heading", { name: updatedName, level: 1 })).toBeVisible()

    await settings.getByRole("switch", { name: "Count in budgets" }).click()
    await expect(settings).toContainText("Excluded")
    await settings.getByRole("switch", { name: "Show in filter menus" }).click()
    await expect(settings).toContainText("Hidden")

    await settings.getByRole("button", { name: /Auto-add/ }).click()
    const autoAdd = page.getByRole("dialog", { name: "Auto-add" })
    await autoAdd.getByLabel("From").fill("2026-08-10")
    await autoAdd.getByLabel("Until").fill("2026-08-17")
    await autoAdd.getByRole("button", { name: "Save" }).click()
    await expect(settings.getByRole("button", { name: /Auto-add/ })).toContainText("10")

    await page.reload()
    await expect(page.getByRole("heading", { name: updatedName, level: 1 })).toBeVisible()
    await expect(settings.getByRole("switch", { name: "Count in budgets" })).not.toBeChecked()
    await expect(settings.getByRole("switch", { name: "Show in filter menus" })).not.toBeChecked()
    await settings.getByRole("button", { name: /Auto-add/ }).click()
    await expect(autoAdd.getByLabel("From")).toHaveValue("2026-08-10")
    await expect(autoAdd.getByLabel("Until")).toHaveValue("2026-08-17")
    await autoAdd.getByRole("button", { name: "Turn off" }).click()
    await expect(settings.getByRole("button", { name: /Auto-add/ })).toContainText("Off")
  })
})
