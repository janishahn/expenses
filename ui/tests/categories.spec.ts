import { test, expect, type APIRequestContext, type Page } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

type StoredCategory = {
  id: number
  name: string
  type: string
  icon: string | null
  order: number | null
  archived_at: string | null
}

async function fetchCategory(
  request: APIRequestContext,
  name: string,
): Promise<StoredCategory | undefined> {
  const response = await request.get("/api/categories?period=all")
  expect(response.ok()).toBeTruthy()
  const { categories } = (await response.json()) as { categories: StoredCategory[] }
  return categories.find((category) => category.name === name)
}

async function createMonthlyBudgetTemplate(
  request: APIRequestContext,
  csrfToken: string,
  categoryId: number,
): Promise<void> {
  const response = await request.post("/api/budgets/templates", {
    headers: { "X-CSRF-Token": csrfToken },
    data: {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 9000,
      starts_on: "2025-01-01",
      ends_on: null,
    },
  })
  expect(response.ok()).toBeTruthy()
}

function categoryRow(page: Page, name: string) {
  return page.getByRole("list", { name: "Categories" }).getByRole("listitem", { name, exact: true })
}

async function addCategory(page: Page, name: string, type?: "Income") {
  await page.getByRole("button", { name: "Add category" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Add category" })
  if (type) await dialog.getByRole("radio", { name: type }).click()
  await dialog.getByRole("textbox", { name: "Name" }).fill(name)
  return dialog
}

test.describe("Categories Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/categories")
    await expect(page.getByRole("heading", { name: "Categories", level: 1 })).toBeVisible()
  })

  test("opens and cancels the add category dialog from the page action", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add category" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
  })

  test("asks for a name before creating a category", async ({ page }) => {
    await page.getByRole("button", { name: "Add category" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add category" })
    await dialog.getByRole("button", { name: "Add category" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Enter a category name.")
  })

  test("clears a failed create request when reopening the add category dialog", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Duplicate Category ${Date.now()}`
    await createCategory(request, token, "expense", categoryName)
    await page.reload()

    let dialog = await addCategory(page, categoryName)
    await dialog.getByRole("button", { name: "Add category" }).click()
    await expect(dialog.getByRole("alert")).toBeVisible()

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: "Add category" }).first().click()
    dialog = page.getByRole("dialog", { name: "Add category" })
    await expect(dialog.getByRole("alert")).toHaveCount(0)
  })

  test("creates a category with an icon chosen from the suggestions", async ({
    page,
    request,
  }) => {
    const categoryName = `E2E Icon ${Date.now()}`
    const dialog = await addCategory(page, categoryName)

    await dialog.getByRole("button", { name: /^Icon / }).click()
    const picker = page.getByRole("dialog", { name: "Icon" })
    const choice = picker.getByRole("group", { name: "Suggested icons" }).getByRole("button").first()
    const iconLabel = await choice.getAttribute("aria-label")
    await choice.click()
    await expect(picker).toBeHidden()
    await expect(dialog.getByRole("button", { name: `Icon ${iconLabel}` })).toBeVisible()
    await dialog.getByRole("button", { name: "Add category" }).click()

    await expect(categoryRow(page, categoryName)).toBeVisible()
    const stored = await fetchCategory(request, categoryName)
    expect(stored?.icon?.toLowerCase().replace(/-/g, " ")).toBe(iconLabel?.toLowerCase())
  })

  test("creates a category with an icon found by searching all icons", async ({
    page,
    request,
  }) => {
    const categoryName = `E2E Search Icon ${Date.now()}`
    const dialog = await addCategory(page, categoryName)

    await dialog.getByRole("button", { name: /^Icon / }).click()
    const picker = page.getByRole("dialog", { name: "Icon" })
    await picker.getByRole("searchbox", { name: "Search icons" }).fill("pizza")
    await picker.getByRole("group", { name: "Matching icons" }).getByRole("button", { name: "Pizza", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Icon Pizza" })).toBeVisible()
    await dialog.getByRole("button", { name: "Add category" }).click()

    await expect(categoryRow(page, categoryName)).toBeVisible()
    expect((await fetchCategory(request, categoryName))?.icon).toBe("pizza")
  })

  test("creates an income category with an order", async ({ page, request }) => {
    const categoryName = `E2E Income ${Date.now()}`
    const dialog = await addCategory(page, categoryName, "Income")
    await dialog.getByRole("button", { name: "Order 0" }).click()
    const popover = page.getByRole("dialog", { name: "Order" })
    await popover.getByRole("textbox", { name: "Order" }).fill("abc")
    await popover.getByRole("button", { name: "Done" }).click()
    await expect(popover.getByRole("alert")).toHaveText("Enter a whole number.")
    await popover.getByRole("textbox", { name: "Order" }).fill("7")
    await popover.getByRole("button", { name: "Done" }).click()
    await expect(dialog.getByRole("button", { name: "Order 7" })).toBeVisible()
    await dialog.getByRole("button", { name: "Add category" }).click()

    await expect(categoryRow(page, categoryName)).toBeVisible()
    expect(await fetchCategory(request, categoryName)).toMatchObject({
      type: "income",
      order: 7,
    })
  })

  test("archives a category with Undo and restores an archived one", async ({
    page,
    request,
  }) => {
    const categoryName = `E2E Category ${Date.now()}`
    const dialog = await addCategory(page, categoryName)
    await dialog.getByRole("button", { name: "Add category" }).click()

    await categoryRow(page, categoryName).click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Archive" }).click()
    await expect(page.getByRole("menu")).toBeHidden()

    const toast = page.getByRole("status").filter({ hasText: `Archived ${categoryName}.` })
    await expect(toast).toBeVisible()
    await expect.poll(async () => (await fetchCategory(request, categoryName))?.archived_at).not.toBeNull()
    await expect(peek.getByText("Archived", { exact: true })).toBeVisible()

    await toast.getByRole("button", { name: "Undo" }).click()
    await expect.poll(async () => (await fetchCategory(request, categoryName))?.archived_at).toBeNull()
    await expect(peek.getByText("Archived", { exact: true })).toBeHidden()

    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Archive" }).click()
    await expect(page.getByRole("menu")).toBeHidden()
    await expect(peek.getByText("Archived", { exact: true })).toBeVisible()
    await expect(page.getByRole("menu")).toBeHidden()
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Restore" }).click()
    await expect.poll(async () => (await fetchCategory(request, categoryName))?.archived_at).toBeNull()
  })

  test("edits a category's name, icon and order in its peek", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Edit ${Date.now()}`
    const updatedName = `${categoryName} Updated`
    await createCategory(request, token, "expense", categoryName)
    await page.reload()

    await categoryRow(page, categoryName).click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await peek.getByRole("button", { name: "Edit Name" }).click()
    await peek.getByRole("textbox", { name: "Name" }).fill(updatedName)
    await peek.getByRole("textbox", { name: "Name" }).press("Enter")
    await expect(categoryRow(page, updatedName)).toBeVisible()

    const renamed = page.getByRole("complementary", { name: updatedName })
    await renamed.getByRole("button", { name: /^Icon/ }).click()
    const picker = page.getByRole("dialog", { name: "Icon" })
    await picker.getByRole("searchbox", { name: "Search icons" }).fill("pizza")
    await picker.getByRole("group", { name: "Matching icons" }).getByRole("button", { name: "Pizza", exact: true }).click()
    await expect(renamed.getByRole("button", { name: /^Icon/ })).toContainText("Pizza")

    await renamed.getByRole("button", { name: /^Order/ }).click()
    const orderPopover = page.getByRole("dialog", { name: "Order" })
    await orderPopover.getByRole("textbox", { name: "Order" }).fill("12")
    await orderPopover.getByRole("button", { name: "Save" }).click()
    await expect(renamed.getByRole("button", { name: /^Order/ })).toContainText("12")

    await expect
      .poll(async () => fetchCategory(request, updatedName))
      .toMatchObject({ icon: "pizza", order: 12 })
    expect(await fetchCategory(request, categoryName)).toBeUndefined()
  })

  test("shows a category's uses, total and recent transactions in its peek", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const categoryName = `E2E Usage ${stamp}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    const today = new Date().toISOString().slice(0, 10)
    for (const [title, amount] of [
      [`Usage first ${stamp}`, 1250],
      [`Usage second ${stamp}`, 2000],
    ] as const) {
      await createTransaction(request, token, {
        date: today,
        occurred_at: new Date().toISOString(),
        type: "expense",
        amount_cents: amount,
        category_id: categoryId,
        title,
        tags: [],
      })
    }

    await page.reload()
    await expect(categoryRow(page, categoryName)).toContainText("2 uses")
    await categoryRow(page, categoryName).click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await expect(peek).toContainText("2 uses · 32,50")
    const recent = peek.getByRole("list", { name: "Recent transactions" })
    await expect(recent.getByRole("listitem", { name: `Usage first ${stamp}` })).toContainText("12,50")
    await expect(recent.getByRole("listitem", { name: `Usage second ${stamp}` })).toContainText("20,00")
  })

  test("orders the list by name in both directions", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const first = `E2E Order A ${stamp}`
    const second = `E2E Order B ${stamp}`
    await createCategory(request, token, "expense", second)
    await createCategory(request, token, "expense", first)
    await page.reload()

    await page.getByRole("button", { name: /^Sort by/ }).click()
    await page.getByRole("menuitemcheckbox", { name: "Name" }).click()
    await expect(page.getByRole("menu")).toBeHidden()
    const names = page.getByRole("list", { name: "Categories" }).getByRole("listitem")
    const position = async (name: string) =>
      (await names.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))).indexOf(name)
    expect(await position(first)).toBeLessThan(await position(second))

    await page.getByRole("button", { name: /^Sort by/ }).click()
    await page.getByRole("menuitemcheckbox", { name: "Z to A" }).click()
    expect(await position(first)).toBeGreaterThan(await position(second))
  })

  test("merges a category into another after choosing it and reviewing the counts", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const sourceName = `E2E Merge Source ${suffix}`
    const targetName = `E2E Merge Target ${suffix}`
    const sourceId = await createCategory(request, token, "expense", sourceName)
    const targetId = await createCategory(request, token, "expense", targetName)
    const today = new Date().toISOString().slice(0, 10)
    await createTransaction(request, token, {
      date: today,
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 999,
      category_id: sourceId,
      title: `Merge me ${suffix}`,
      tags: [],
    })

    await page.goto(`/categories?peek=${sourceId}`)
    const peek = page.getByRole("complementary", { name: sourceName })
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Merge into…" }).click()

    const dialog = page.getByRole("dialog", { name: `Merge ${sourceName}` })
    await expect(dialog).toContainText(`${sourceName} is archived after the merge.`)
    await expect(dialog.getByRole("button", { name: "Merge", exact: true })).toBeDisabled()
    await dialog.getByLabel("Into").selectOption(String(targetId))
    await expect(dialog).toContainText("Transactions")
    await expect(dialog.getByText("1", { exact: true })).toBeVisible()
    await dialog.getByRole("button", { name: "Merge", exact: true }).click()

    await expect(
      page.getByRole("status").filter({ hasText: `Merged ${sourceName} into ${targetName}.` }),
    ).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("complementary", { name: targetName })).toBeVisible()
    await expect(page.getByRole("complementary", { name: targetName })).toContainText("1 use")
    await expect.poll(async () => (await fetchCategory(request, sourceName))?.archived_at).not.toBeNull()
  })

  test("clears a failed preview once another target previews successfully", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const sourceName = `E2E Preview Error Source ${suffix}`
    const firstTarget = `E2E Preview Error Target A ${suffix}`
    const secondTarget = `E2E Preview Error Target B ${suffix}`
    const sourceId = await createCategory(request, token, "expense", sourceName)
    const firstId = await createCategory(request, token, "expense", firstTarget)
    const secondId = await createCategory(request, token, "expense", secondTarget)

    let previewAttemptCount = 0
    await page.route("**/api/categories/merge/preview", async (route) => {
      previewAttemptCount += 1
      if (previewAttemptCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Temporary preview failure" }),
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/categories?peek=${sourceId}`)
    await page.getByRole("complementary", { name: sourceName }).getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Merge into…" }).click()
    const dialog = page.getByRole("dialog", { name: `Merge ${sourceName}` })

    await dialog.getByLabel("Into").selectOption(String(firstId))
    await expect(dialog.getByRole("alert")).toHaveText("Temporary preview failure")
    await expect(dialog.getByRole("button", { name: "Merge", exact: true })).toBeDisabled()

    await dialog.getByLabel("Into").selectOption(String(secondId))
    await expect(dialog.getByRole("alert")).toHaveCount(0)
    await dialog.getByRole("button", { name: "Merge", exact: true }).click()
    await expect(
      page.getByRole("status").filter({ hasText: `Merged ${sourceName} into ${secondTarget}.` }),
    ).toBeVisible()
  })

  test("shows the guarded budget conflict when a merge is blocked", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const sourceName = `E2E Conflict Source ${suffix}`
    const targetName = `E2E Conflict Target ${suffix}`
    const sourceId = await createCategory(request, token, "expense", sourceName)
    const targetId = await createCategory(request, token, "expense", targetName)
    await createMonthlyBudgetTemplate(request, token, sourceId)
    await createMonthlyBudgetTemplate(request, token, targetId)

    await page.goto(`/categories?peek=${sourceId}`)
    await page.getByRole("complementary", { name: sourceName }).getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Merge into…" }).click()
    const dialog = page.getByRole("dialog", { name: `Merge ${sourceName}` })
    await dialog.getByLabel("Into").selectOption(String(targetId))
    await expect(dialog).toContainText("1 plan, 0 adjustments")

    await dialog.getByRole("button", { name: "Merge", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText(/overlapping budget scopes/i)
    expect((await fetchCategory(request, sourceName))?.archived_at).toBeNull()
  })
})
