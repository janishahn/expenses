import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken, loginAsIsolatedUser } from "./helpers"

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
  test("lists active and archived tags with period amounts, flags and sorting", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const busy = `E2E Busy ${stamp}`
    const quiet = `E2E Quiet ${stamp}`
    const old = `E2E Old ${stamp}`
    await createTag(request, token, busy, { is_hidden_from_budget: true })
    await createTag(request, token, quiet)
    const oldId = await createTag(request, token, old)
    await spend(request, token, busy, 4_200)
    await spend(request, token, busy, 800, "income")
    await spend(request, token, quiet, 1_000)
    expect(
      (
        await request.post(`/api/tags/${oldId}/archive`, {
          headers: { "X-CSRF-Token": token },
        })
      ).ok(),
    ).toBeTruthy()

    await page.goto("/tags")
    await expect(page.getByRole("heading", { name: "Tags", level: 1 })).toBeVisible()
    await expect(page.getByRole("button", { name: "Add tag" }).first()).toBeVisible()
    const list = page.getByRole("list", { name: "Tags" })
    const busyRow = list.getByRole("listitem", { name: busy })
    await expect(busyRow).toContainText("2 uses")
    await expect(busyRow).toContainText(/42,00\s?€/)
    await expect(busyRow).toContainText(/8,00\s?€/)
    await expect(busyRow.getByRole("img", { name: "Excluded from budgets" })).toBeVisible()
    const quietRow = list.getByRole("listitem", { name: quiet })
    await expect(quietRow).toContainText("1 use")
    await expect(quietRow.getByRole("img", { name: "Excluded from budgets" })).toHaveCount(0)
    const oldRow = list.getByRole("listitem", { name: old })
    await expect(oldRow).toContainText("Archived")

    // Active tags come first, archived ones sit in their own band at the end.
    const names = await list.getByRole("listitem").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("aria-label")),
    )
    expect(names.indexOf(busy)).toBeLessThan(names.indexOf(quiet))
    expect(names.indexOf(quiet)).toBeLessThan(names.indexOf(old))

    const orderOf = async () =>
      (
        await list
          .getByRole("listitem")
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")))
      ).filter((name) => [busy, quiet].includes(name ?? ""))
    await page.getByRole("button", { name: /^Sort/ }).click()
    await pickMenuItem(page, "menuitemcheckbox", "Name")
    await expect.poll(orderOf).toEqual([busy, quiet].sort())
    await page.getByRole("button", { name: /^Sort/ }).click()
    await pickMenuItem(page, "menuitemcheckbox", "Date created")
    await expect.poll(orderOf).toEqual([busy, quiet])
  })

  test("shows the empty state when there are no tags", async ({ page }) => {
    await page.goto("/tags")
    const { request } = await loginAsIsolatedUser(page)
    try {
      await page.goto("/tags")
      await expect(page.getByText("No tags yet.")).toBeVisible()
      await expect(page.getByRole("button", { name: "Add tag" })).toHaveCount(2)
    } finally {
      await request.dispose()
    }
  })

  test("creates a tag from the add dialog with options", async ({ page }) => {
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
  })

  test("clears a failed create request when reopening the add dialog", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const tagName = `E2E Duplicate Tag ${Date.now()}`
    await createTag(request, token, tagName)

    await page.goto("/tags")
    await page.getByRole("button", { name: "Add tag" }).first().click()
    let dialog = page.getByRole("dialog", { name: "Add tag" })
    await dialog.getByLabel("Name").fill(tagName)
    await dialog.getByRole("button", { name: "Add tag" }).click()
    await expect(dialog.getByRole("alert")).toBeVisible()

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: "Add tag" }).first().click()
    dialog = page.getByRole("dialog", { name: "Add tag" })
    await expect(dialog.getByRole("alert")).toHaveCount(0)
  })

  test("edits a tag in its peek and saves each change immediately", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const name = `E2E Peek Tag ${Date.now()}`
    const id = await createTag(request, token, name)
    await spend(request, token, name, 4_200)
    await spend(request, token, name, 1_500, "income")

    await page.goto("/tags")
    await page.getByRole("list", { name: "Tags" }).getByRole("listitem", { name }).click()
    await expect(page).toHaveURL(new RegExp(`peek=${id}`))
    let peek = page.getByRole("complementary", { name })
    await expect(peek).toContainText(/42,00\s?€/)
    await expect(peek).toContainText("spent")
    await expect(peek).toContainText(/15,00\s?€\s*income/)
    await expect(peek.getByRole("switch", { name: "Count in budgets" })).toBeChecked()
    await expect(peek.getByRole("switch", { name: "Show in filter menus" })).toBeChecked()

    const newName = `${name} renamed`
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill("")
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(peek.getByText("Enter a tag name.")).toBeVisible()
    await peek.getByRole("textbox", { name: "Name" }).fill(newName)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    peek = page.getByRole("complementary", { name: newName })
    await expect(peek).toBeVisible()

    await peek.getByRole("switch", { name: "Count in budgets" }).click()
    await expect(peek).toContainText("Excluded")
    await peek.getByRole("switch", { name: "Show in filter menus" }).click()
    await expect(peek).toContainText("Hidden")

    await peek.getByRole("button", { name: /Auto-add/ }).click()
    const popover = page.getByRole("dialog", { name: "Auto-add" })
    await popover.getByRole("button", { name: "Save" }).click()
    await expect(popover.getByText("Choose a start and an end date.")).toBeVisible()
    await popover.getByLabel("From").fill("2026-08-17")
    await popover.getByLabel("Until").fill("2026-08-10")
    await popover.getByRole("button", { name: "Save" }).click()
    await expect(popover.getByText("The end must not be before the start.")).toBeVisible()
    await popover.getByLabel("Until").fill("2026-08-24")
    await popover.getByRole("button", { name: "Save" }).click()
    await expect(popover).toHaveCount(0)
    await expect(peek.getByRole("button", { name: /Auto-add/ })).toContainText("17")

    // The changes reached the backend and the list.
    await page.reload()
    peek = page.getByRole("complementary", { name: newName })
    await expect(peek.getByRole("switch", { name: "Count in budgets" })).not.toBeChecked()
    await expect(peek.getByRole("switch", { name: "Show in filter menus" })).not.toBeChecked()
    await expect(peek.getByRole("button", { name: /Auto-add/ })).toContainText("24")
    const row = page.getByRole("list", { name: "Tags" }).getByRole("listitem", { name: newName })
    await expect(row.getByRole("img", { name: "Excluded from budgets" })).toBeVisible()

    await peek.getByRole("button", { name: /Auto-add/ }).click()
    await page.getByRole("dialog", { name: "Auto-add" }).getByRole("button", { name: "Turn off" }).click()
    await expect(peek.getByRole("button", { name: /Auto-add/ })).toContainText("Off")
  })

  test("archives with undo, restores and deletes a tag after confirmation", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const name = `E2E Lifecycle Tag ${Date.now()}`
    await createTag(request, token, name)

    await page.goto("/tags")
    const list = page.getByRole("list", { name: "Tags" })
    await list.getByRole("listitem", { name }).click()
    const peek = page.getByRole("complementary", { name })
    await peek.getByRole("button", { name: "More actions" }).click()
    await pickMenuItem(page, "menuitem", "Archive")
    const toast = page.getByRole("status").filter({ hasText: `Archived ${name}.` })
    await expect(toast).toBeVisible()
    await expect(peek).toContainText("Archived")
    await toast.getByRole("button", { name: "Undo" }).click()
    await expect(peek.getByText("Archived", { exact: true })).toHaveCount(0)

    await peek.getByRole("button", { name: "More actions" }).click()
    await pickMenuItem(page, "menuitem", "Archive")
    await expect(list.getByRole("listitem", { name })).toContainText("Archived")
    await peek.getByRole("button", { name: "More actions" }).click()
    await pickMenuItem(page, "menuitem", "Restore")
    await expect(list.getByRole("listitem", { name })).not.toContainText("Archived")

    await peek.getByRole("button", { name: "More actions" }).click()
    await pickMenuItem(page, "menuitem", "Delete")
    const confirm = page.getByRole("dialog", { name: `Delete tag "${name}"?` })
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(list.getByRole("listitem", { name })).toBeVisible()
    await peek.getByRole("button", { name: "More actions" }).click()
    await pickMenuItem(page, "menuitem", "Delete")
    await confirm.getByRole("button", { name: "Delete" }).click()
    await expect(list.getByRole("listitem", { name })).toHaveCount(0)
    await expect(page).not.toHaveURL(/peek=/)
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

  test("opens the tag page from the peek's recent transactions", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const name = `E2E Recent Tag ${Date.now()}`
    await createTag(request, token, name)
    await spend(request, token, name, 1_250)
    await spend(request, token, name, 2_250)

    await page.goto("/tags")
    await page.getByRole("list", { name: "Tags" }).getByRole("listitem", { name }).click()
    const peek = page.getByRole("complementary", { name })
    const recent = peek.getByRole("list", { name: "Recent transactions" })
    await expect(recent.getByRole("listitem")).toHaveCount(2)
    await peek.getByRole("button", { name: "All 2" }).click()
    await expect(page).toHaveURL(/\/tags\/\d+/)
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible()
  })
})
