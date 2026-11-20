import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

async function createTag(
  request: APIRequestContext,
  token: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false, ...extra },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

async function spend(
  request: APIRequestContext,
  token: string,
  tagName: string,
  amountCents: number,
  type: "expense" | "income" = "expense",
) {
  const categoryId = await ensureCategory(request, token, type, `E2E Tags ${type}`)
  const today = new Date().toISOString().slice(0, 10)
  await createTransaction(request, token, {
    date: today,
    occurred_at: new Date().toISOString(),
    type,
    amount_cents: amountCents,
    category_id: categoryId,
    title: `Tag seed ${tagName}`,
    tags: [tagName],
  })
}

// Waits for the menu to leave, so the next menu opens after the previous one finished closing.
async function pickMenuItem(page: Page, role: "menuitem" | "menuitemcheckbox", name: string) {
  await page.getByRole(role, { name }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)
}

test.describe("Tags Page", () => {
  test("creates a tag from the add dialog with options and archives it with Undo", async ({ page }) => {
    const tagName = `E2E Tag ${Date.now()}`
    await page.goto("/tags")
    await page.getByRole("button", { name: "Add tag" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add tag" })
    await dialog.getByRole("button", { name: "Add tag" }).click()
    await expect(dialog.getByText("Enter a tag name.")).toBeVisible()

    await dialog.getByLabel("Name").fill(tagName)
    const excluded = dialog.getByRole("button", { name: "Exclude from budgets" })
    await expect(excluded).toHaveAttribute("aria-pressed", "false")
    await excluded.click()
    await expect(excluded).toHaveAttribute("aria-pressed", "true")
    await dialog.getByRole("button", { name: "Hide from filters" }).click()
    await dialog.getByRole("button", { name: "Auto-add off" }).click()
    const popover = page.getByRole("dialog", { name: "Auto-add" })
    await popover.getByLabel("From").fill("2026-08-10")
    await popover.getByLabel("Until").fill("2026-08-17")
    await popover.getByRole("button", { name: "Save" }).click()
    await expect(dialog.getByRole("button", { name: /^Auto-add/ })).toContainText("10")
    await dialog.getByRole("button", { name: "Add tag" }).click()
    await expect(dialog).toHaveCount(0)

    const row = page.getByRole("list", { name: "Tags" }).getByRole("listitem", { name: tagName })
    await expect(row).toBeVisible()
    await expect(row.getByRole("img", { name: "Excluded from budgets" })).toBeVisible()
    await expect(row).toContainText("Auto")
    await row.click()
    const peek = page.getByRole("complementary", { name: tagName })
    await expect(peek.getByRole("switch", { name: "Show in filter menus" })).not.toBeChecked()
    await expect(peek.getByRole("switch", { name: "Count in budgets" })).not.toBeChecked()

    await peek.getByRole("button", { name: "More actions" }).click()
    await pickMenuItem(page, "menuitem", "Archive")
    const toast = page.getByRole("status").filter({ hasText: `Archived ${tagName}.` })
    await expect(toast).toBeVisible()
    await expect(row).toContainText("Archived")
    await toast.getByRole("button", { name: "Undo" }).click()
    await expect(peek.getByText("Archived", { exact: true })).toHaveCount(0)
    await expect(row).not.toContainText("Archived")
  })

  test("merges a tag into another after previewing the move", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const source = `E2E Merge Source ${stamp}`
    const target = `E2E Merge Target ${stamp}`
    await createTag(request, token, source)
    await createTag(request, token, target)
    await spend(request, token, source, 3_300)

    await page.goto("/tags")
    const list = page.getByRole("list", { name: "Tags" })
    await list.getByRole("listitem", { name: source }).click()
    await page
      .getByRole("complementary", { name: source })
      .getByRole("button", { name: "More actions" })
      .click()
    await pickMenuItem(page, "menuitem", "Merge into…")
    const dialog = page.getByRole("dialog", { name: `Merge ${source}` })
    await expect(dialog.getByRole("button", { name: "Merge", exact: true })).toBeDisabled()
    await dialog.getByLabel("Into").selectOption({ label: target })
    await expect(dialog.getByText("Transactions")).toBeVisible()
    await expect(dialog.getByText("Transactions").locator("..")).toContainText("1")
    await dialog.getByRole("button", { name: "Merge", exact: true }).click()

    await expect(
      page.getByRole("status").filter({ hasText: `Merged ${source} into ${target}.` }),
    ).toBeVisible()
    await expect(list.getByRole("listitem", { name: source })).toContainText("Archived")
    const targetPeek = page.getByRole("complementary", { name: target })
    await expect(targetPeek).toContainText(/33,00\s?€/)
  })
})
