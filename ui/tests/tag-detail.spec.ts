import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

async function createTag(request: APIRequestContext, token: string, name: string): Promise<number> {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function seed(
  request: APIRequestContext,
  token: string,
  tagName: string,
  categoryName: string,
  amountCents: number,
  type: "expense" | "income" = "expense",
) {
  const categoryId = await createCategory(request, token, type, categoryName)
  const today = new Date().toISOString().slice(0, 10)
  await createTransaction(request, token, {
    date: today,
    occurred_at: new Date().toISOString(),
    type,
    amount_cents: amountCents,
    category_id: categoryId,
    title: `Tag detail ${type} ${tagName}`,
    tags: [tagName],
  })
}

// Waits for the menu to leave, so the next menu opens after the previous one finished closing.
async function pickMenuItem(page: Page, role: "menuitem" | "menuitemcheckbox", name: string) {
  await page.getByRole(role, { name }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)
}

test.describe("Tag Detail Page", () => {
  test("shows totals, transactions and the breakdown of a tag", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const name = `E2E Tag Detail ${stamp}`
    const tagId = await createTag(request, token, name)
    await seed(request, token, name, `E2E Tag Detail Groceries ${stamp}`, 4_200)

    await page.goto(`/tags/${tagId}?period=all`)
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Tags")
    const metric = (label: string) =>
      page.locator('[class*="_lab_"]', { hasText: new RegExp(`^${label}$`) }).locator("..")
    await expect(metric("Expenses")).toContainText(/42,00\s?€/)
    await expect(metric("Income")).toContainText(/0,00\s?€/)
    await expect(metric("Balance")).toContainText(/42,00\s?€/)
    await expect(
      page.getByRole("list", { name: "Transactions" }).getByRole("listitem"),
    ).toHaveCount(1)

    const expenses = page.getByRole("region", { name: "Expenses" })
    await expenses.getByRole("button", { name: "Chart options" }).click()
    await pickMenuItem(page, "menuitemcheckbox", "Show as table")
    const table = expenses.getByRole("table", { name: "Expenses by category" })
    await expect(table).toContainText(`E2E Tag Detail Groceries ${stamp}`)
    await expect(table).toContainText(/42,00\s?€/)
    await expect(table).toContainText("100 %")
    await expect(page.getByRole("region", { name: "Income" })).toHaveCount(0)
  })

  test("shows the income breakdown only when the tag has income", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const name = `E2E Tag Income ${stamp}`
    const tagId = await createTag(request, token, name)
    await seed(request, token, name, `E2E Tag Detail Groceries ${stamp}`, 1_000)
    await seed(request, token, name, `E2E Tag Detail Salary ${stamp}`, 5_000, "income")

    await page.goto(`/tags/${tagId}?period=all`)
    const income = page.getByRole("region", { name: "Income" })
    await income.getByRole("button", { name: "Chart options" }).click()
    await pickMenuItem(page, "menuitemcheckbox", "Show as table")
    const table = income.getByRole("table", { name: "Income by category" })
    await expect(table).toContainText(`E2E Tag Detail Salary ${stamp}`)
    await expect(table).toContainText(/50,00\s?€/)
  })

  test("shows an empty state for a tag without transactions", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const tagId = await createTag(request, token, `E2E Tag Empty ${Date.now()}`)
    await page.goto(`/tags/${tagId}?period=all`)
    await expect(page.getByText("No transactions in this period.")).toBeVisible()
    await expect(page.getByText("No spending in this period.")).toBeVisible()
  })

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

  test("archives with undo, restores and deletes a tag", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const name = `E2E Tag Lifecycle ${Date.now()}`
    const tagId = await createTag(request, token, name)

    await page.goto(`/tags/${tagId}?period=all`)
    const settings = page.getByRole("region", { name: "Settings" })
    await page.getByRole("button", { name: "More actions" }).first().click()
    await pickMenuItem(page, "menuitem", "Archive")
    const toast = page.getByRole("status").filter({ hasText: `Archived ${name}.` })
    await expect(toast).toBeVisible()
    await expect(settings.getByText("Archived", { exact: true })).toBeVisible()
    await toast.getByRole("button", { name: "Undo" }).click()
    await expect(settings.getByText("Archived", { exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: "More actions" }).first().click()
    await pickMenuItem(page, "menuitem", "Archive")
    await expect(settings.getByText("Archived", { exact: true })).toBeVisible()

    await page.goto("/tags?period=all")
    await expect(
      page.getByRole("list", { name: "Tags" }).getByRole("listitem", { name }),
    ).toContainText("Archived")
    await page.goto(`/tags/${tagId}?period=all`)
    await page.getByRole("button", { name: "More actions" }).first().click()
    await pickMenuItem(page, "menuitem", "Restore")
    await expect(settings.getByText("Archived", { exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: "More actions" }).first().click()
    await pickMenuItem(page, "menuitem", "Delete")
    await page
      .getByRole("dialog", { name: `Delete tag "${name}"?` })
      .getByRole("button", { name: "Delete" })
      .click()
    await expect(page).toHaveURL(/\/tags$/)
    await expect(page.getByRole("list", { name: "Tags" }).getByRole("listitem", { name })).toHaveCount(0)
  })

  test("merges the tag into another and opens the target", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const source = `E2E Detail Merge Source ${stamp}`
    const target = `E2E Detail Merge Target ${stamp}`
    const sourceId = await createTag(request, token, source)
    const targetId = await createTag(request, token, target)
    await seed(request, token, source, `E2E Tag Detail Groceries ${stamp}`, 2_700)

    await page.goto(`/tags/${sourceId}?period=all`)
    await page.getByRole("button", { name: "More actions" }).first().click()
    await pickMenuItem(page, "menuitem", "Merge into…")
    const dialog = page.getByRole("dialog", { name: `Merge ${source}` })
    await dialog.getByLabel("Into").selectOption({ label: target })
    await expect(dialog.getByText("Transactions").locator("..")).toContainText("1")
    await dialog.getByRole("button", { name: "Merge", exact: true }).click()

    await expect(page).toHaveURL(new RegExp(`/tags/${targetId}`))
    await expect(page.getByRole("heading", { name: target, level: 1 })).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: `Merged ${source} into ${target}.` })).toBeVisible()
    await expect(page.getByRole("list", { name: "Transactions" }).getByRole("listitem")).toHaveCount(1)
  })

  test("shows a way back when the tag does not exist", async ({ page }) => {
    await page.goto("/tags/999999")
    await expect(page.getByText("Tag not found.")).toBeVisible()
    await page.getByRole("link", { name: "Back to tags" }).click()
    await expect(page).toHaveURL(/\/tags$/)
  })
})
