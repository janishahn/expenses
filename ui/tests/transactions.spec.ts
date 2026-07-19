import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

test.describe("Transactions Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/transactions")
  })

  test("should be navigable to deleted transactions page", async ({ page }) => {
    await page.goto("/transactions/deleted")
    await expect(page.locator("main h1")).toContainText("Deleted Transactions")
  })

  test("should load transaction list", async ({ page }) => {
    await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0, { timeout: 10000 })
  })

  test("fuzzy-searches transaction descriptions", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Fuzzy Search")
    const title = `E2E description result ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T14:00:00",
      type: "expense",
      amount_cents: 5000,
      category_id: categoryId,
      title,
      description: "Warranty paperwork stored here",
      tags: [],
    })

    await page.getByRole("button", { name: "Search transactions" }).click()
    await page
      .getByPlaceholder("Search titles and descriptions…")
      .fill("waranty paperwork")

    await expect(page.getByTestId(`transaction-row-${transactionId}`)).toBeVisible()
    await expect(page.getByRole("button", { name: "Run smart search" })).toHaveCount(0)
  })


  test("edits transaction tags by toggling existing-tag chips", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Tag Edit")
    const keepTag = `keep-${Date.now()}`
    const addTag = `add-${Date.now()}`
    for (const name of [keepTag, addTag]) {
      const tagResponse = await request.post("/api/tags", {
        headers: { "X-CSRF-Token": token },
        data: { name, is_hidden_from_budget: false },
      })
      expect(tagResponse.ok()).toBeTruthy()
    }
    const title = `E2E Tag Edit ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T14:00:00",
      type: "expense",
      amount_cents: 5000,
      category_id: categoryId,
      title,
      tags: [keepTag],
    })

    await page.goto(`/transactions/${transactionId}/edit`)
    // The existing tag is pre-selected; the new tag is added from search.
    await expect(
      page.getByRole("button", { name: `Remove tag ${keepTag}` })
    ).toBeVisible()
    await page.getByPlaceholder("Search tags").fill(addTag)
    await page.getByRole("button", { name: `Add tag ${addTag}` }).click()
    await expect(
      page.getByRole("button", { name: `Remove tag ${addTag}` })
    ).toBeVisible()

    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "PUT" &&
        response.ok()
    )
    await page.getByRole("button", { name: "Save changes" }).click()
    await saveResponse

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
    await expect(page.locator(".chip").filter({ hasText: keepTag })).toBeVisible()
    await expect(page.locator(".chip").filter({ hasText: addTag })).toBeVisible()
  })


  test("separates page actions from filters and keeps selection controls stable", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Checkbox Align")
    const title = `E2E Checkbox Align ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 12345,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    const controlZone = page.getByTestId("transactions-control-zone")
    const register = page.getByTestId("transactions-register")
    const row = page.getByTestId(`transaction-row-${transactionId}`)
    await expect(page.getByRole("link", { name: "Inbox" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Trash" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible()
    await expect(controlZone.getByRole("link")).toHaveCount(0)
    await expect(
      controlZone.getByRole("group", { name: "Transaction type" }),
    ).toBeVisible()
    await expect(
      controlZone.getByRole("combobox", { name: "Category", exact: true }),
    ).toBeVisible()
    const tagFilter = controlZone.getByRole("combobox", { name: "Tag", exact: true })
    const clearFilters = controlZone.getByRole("button", { name: "Clear filters" })
    const [tagFilterBox, clearFiltersBox] = await Promise.all([
      tagFilter.boundingBox(),
      clearFilters.boundingBox(),
    ])
    expect(tagFilterBox).not.toBeNull()
    expect(clearFiltersBox).not.toBeNull()
    expect(
      clearFiltersBox!.x - (tagFilterBox!.x + tagFilterBox!.width),
    ).toBeLessThanOrEqual(16)
    await expect(register).toBeVisible()
    await expect(row).toBeVisible()
    await expect(controlZone.getByTestId("transactions-summary")).toHaveCount(0)
    await expect(row.getByTestId("category-icon")).not.toHaveAttribute(
      "data-category-icon",
      "currency-circle-dollar",
    )

    const checkbox = row.getByRole("checkbox", {
      name: `Select transaction ${transactionId}`,
    })
    const selectionControls = page.getByTestId("transactions-selection-controls")
    await expect(selectionControls).toBeVisible()
    await expect(selectionControls).toContainText("matching transactions")
    await expect(checkbox).toBeVisible()
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveCount(0)

    const registerHeaderHeight = await register.evaluate((element) => {
      const header = element.querySelector<HTMLElement>(
        "[data-testid='transactions-selection-controls']"
      )
      const firstRow = element.querySelector<HTMLElement>(
        "[data-testid^='transaction-row-']"
      )
      if (!header || !firstRow) {
        return Number.POSITIVE_INFINITY
      }
      return Math.abs(
        firstRow.getBoundingClientRect().top - header.getBoundingClientRect().bottom
      )
    })
    expect(registerHeaderHeight).toBeLessThanOrEqual(1)

    await checkbox.check()
    await expect(selectionControls).toContainText("1 selected")
    await expect(selectionControls.getByRole("button", { name: "Bulk edit" })).toBeVisible()

    const offsets = await row.evaluate((element, ariaLabel) => {
      const rowRect = element.getBoundingClientRect()
      const cb = element.querySelector(
        `input[type="checkbox"][aria-label="${ariaLabel}"]`,
      )
      const icon = element.querySelector('span[data-testid="category-icon"]')
      if (!cb || !icon) {
        return {
          checkbox: Number.POSITIVE_INFINITY,
          icon: Number.POSITIVE_INFINITY,
        }
      }
      const cbRect = cb.getBoundingClientRect()
      const iconRect = icon.getBoundingClientRect()
      const rowCenter = rowRect.top + rowRect.height / 2
      const cbCenter = cbRect.top + cbRect.height / 2
      const iconCenter = iconRect.top + iconRect.height / 2
      return {
        checkbox: Math.abs(rowCenter - cbCenter),
        icon: Math.abs(rowCenter - iconCenter),
      }
    }, `Select transaction ${transactionId}`)

    expect(offsets.checkbox).toBeLessThanOrEqual(3)
    expect(offsets.icon).toBeLessThanOrEqual(3)
  })

  test("row navigation does not interfere with checkbox selection or delete actions", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Row Action Guard")
    const title = `E2E Row Action Guard ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 6543,
      category_id: categoryId,
      title,
      tags: [],
    })

    const listUrl = `/transactions?q=${encodeURIComponent(title)}`
    await page.goto(listUrl)

    const row = page.getByTestId(`transaction-row-${transactionId}`)
    await expect(row).toBeVisible()

    const checkbox = row.getByRole("checkbox", { name: `Select transaction ${transactionId}` })
    await checkbox.check()
    await expect(page).toHaveURL(listUrl)
    await expect(checkbox).toBeChecked()

    let cancelPromptMessage = ""
    page.once("dialog", async (dialog) => {
      cancelPromptMessage = dialog.message()
      await dialog.dismiss()
    })
    await row.getByRole("button", { name: "Delete" }).click()
    expect(cancelPromptMessage).toBe("Delete this transaction?")
    await expect(page).toHaveURL(listUrl)
    await expect(row).toBeVisible()
  })

  test("should save and remove durable purchase tracking", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Durable Edit")
    const title = `E2E Durable Edit ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 120_000,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto(`/transactions/${transactionId}/edit`)
    await expect(page.locator("main h1")).toContainText("Edit Transaction")

    await page.getByRole("button", { name: "Track as durable purchase" }).click()
    await expect(page.getByLabel("Expected lifespan")).toBeVisible()

    await page.getByLabel("Expected lifespan").selectOption("730")
    await expect(page.locator("body")).toContainText("€/day")

    const saveDurableResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}/durable`) &&
        response.request().method() === "POST" &&
        response.status() === 200
    )
    await page.getByRole("button", { name: "Save durable tracking" }).click()
    await saveDurableResponse

    await expect(page.getByText("Remove durable tracking")).toBeVisible()

    const removeDurableResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}/durable`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    await page.getByRole("button", { name: "Remove durable tracking" }).click()
    await removeDurableResponse

    await expect(page.getByText("Track as durable purchase")).toBeVisible()
  })

  test("should recategorize uncategorized inbox transactions", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoriesResponse = await request.get("/api/categories?period=all")
    const categoriesPayload = (await categoriesResponse.json()) as {
      categories: Array<{
        id: number
        name: string
        type: string
        archived_at: string | null
      }>
    }

    let uncategorizedCategory = categoriesPayload.categories.find(
      (category) =>
        category.type === "expense" &&
        category.archived_at === null &&
        category.name.trim().toLowerCase() === "uncategorized"
    )
    if (!uncategorizedCategory) {
      const createUncategorizedResponse = await request.post("/api/categories", {
        headers: { "X-CSRF-Token": token },
        data: {
          name: "Uncategorized",
          type: "expense",
          order: 0,
        },
      })
      expect(createUncategorizedResponse.ok()).toBeTruthy()
      const created = (await createUncategorizedResponse.json()) as { id: number }
      uncategorizedCategory = {
        id: created.id,
        name: "Uncategorized",
        type: "expense",
        archived_at: null,
      }
    }

    const targetCategoryResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: `E2E Inbox Target ${Date.now()}`,
        type: "expense",
        order: 0,
      },
    })
    expect(targetCategoryResponse.ok()).toBeTruthy()
    const targetCategory = (await targetCategoryResponse.json()) as { id: number }

    const title = `E2E Inbox Recat ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 4321,
      category_id: uncategorizedCategory.id,
      title,
      tags: [],
    })

    let forecastRequests = 0
    await page.route("**/api/forecast?*", async (route) => {
      forecastRequests += 1
      await route.continue()
    })
    await page.goto("/")
    await expect.poll(() => forecastRequests).toBeGreaterThanOrEqual(1)

    const sidebar = page.getByRole("complementary", {
      name: "Application navigation",
    })
    await sidebar.getByRole("link", { name: "Transactions", exact: true }).click()
    await page.getByRole("link", { name: "Inbox", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Uncategorized", level: 1 })
    ).toBeVisible()
    await page.getByRole("button", { name: "All time", exact: true }).click()
    await page.getByRole("textbox", { name: "Search", exact: true }).fill(title)

    const row = page.getByTestId(`uncategorized-row-${transactionId}`)
    await expect(row).toBeVisible()
    await row.getByRole("checkbox", { name: `Select transaction ${transactionId}` }).check()

    await page.getByLabel("Move selected to category").selectOption(String(targetCategory.id))
    page.once("dialog", (dialog) => dialog.accept())
    const applyResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/transactions/bulk/apply") &&
        response.request().method() === "POST" &&
        response.status() === 200
    )
    await page.getByRole("button", { name: "Apply", exact: true }).click()
    await applyResponse

    await expect(row).toHaveCount(0)
    const detailResponse = await request.get(`/api/transactions/${transactionId}`)
    expect(detailResponse.ok()).toBeTruthy()
    const detailPayload = (await detailResponse.json()) as { category_id: number }
    expect(detailPayload.category_id).toBe(targetCategory.id)

    await sidebar.getByRole("link", { name: "Dashboard", exact: true }).click()
    await expect.poll(() => forecastRequests).toBeGreaterThanOrEqual(2)
  })

})
