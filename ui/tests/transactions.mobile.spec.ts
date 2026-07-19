import { expect, test } from "./fixtures"
import {
  createIngestTransaction,
  createTransaction,
  ensureCategory,
  getCsrfToken,
  stubOsmTiles,
  uploadAttachment,
} from "./helpers"

test.describe.configure({ mode: "parallel" })

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pfdvK0AAAAASUVORK5CYII=",
  "base64"
)

const samplePdf = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9Db3VudCAxIC9LaWRzIFszIDAgUl0gPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCA+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgMTIwIFRkIChIZWxsbyBwZGYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNjIgMDAwMDAgbiAKMDAwMDAwMDExNyAwMDAwMCBuIAowMDAwMDAwMjI1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNSAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMzE5CiUlRU9G",
  "base64"
)

test.describe("Transactions Page (mobile)", () => {
  test("collapses filters and applies from the filter sheet", async ({ page }) => {
    await page.goto("/transactions")

    await expect(page.getByRole("button", { name: /Filters/ })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Category", exact: true })).toHaveCount(0)
    await expect(
      page.getByTestId("transactions-control-zone").getByRole("group", {
        name: "Period",
      }),
    ).toHaveCount(0)

    await page.getByRole("button", { name: /Filters/ }).click()
    const filterDialog = page.getByRole("dialog", { name: "Filter transactions" })
    await expect(filterDialog).toBeVisible()
    await expect(filterDialog.getByRole("group", { name: "Period" })).toBeVisible()
    await expect(
      filterDialog.getByRole("combobox", { name: "Category", exact: true })
    ).toBeVisible()

    await filterDialog.getByRole("button", { name: "This month" }).click()
    await filterDialog.getByRole("button", { name: "Cancel" }).click()
    await expect(page).not.toHaveURL(/period=this_month/)

    await page.getByRole("button", { name: /Filters/ }).click()
    const reopenedFilterDialog = page.getByRole("dialog", {
      name: "Filter transactions",
    })
    await reopenedFilterDialog.getByRole("button", { name: "This month" }).click()
    await reopenedFilterDialog
      .getByRole("button", { name: "Expense", exact: true })
      .click()
    await reopenedFilterDialog.getByRole("button", { name: "Apply" }).last().click()
    await expect(page).toHaveURL(/type=expense/)
    await expect(page).toHaveURL(/period=this_month/)
  })

  test("waits for the complete matching count before enabling query bulk edit", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "Mobile Bulk Count",
    )
    const title = `Mobile Bulk Count ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 1200,
      category_id: categoryId,
      title,
      tags: [],
    })

    let releaseSummary: (() => void) | undefined
    const summaryReady = new Promise<void>((resolve) => {
      releaseSummary = resolve
    })
    await page.route("**/api/transactions/summary?*", async (route) => {
      await summaryReady
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          income_cents: 0,
          expense_cents: 1_200_000,
          net_cents: -1_200_000,
          count: 1000,
        }),
      })
    })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await page
      .getByRole("checkbox", { name: `Select transaction ${transactionId}` })
      .check()
    await page.getByRole("button", { name: "Bulk edit" }).click()

    const dialog = page.getByRole("dialog", { name: "Bulk edit" })
    await expect(dialog.getByRole("button", { name: "Counting matching…" })).toBeDisabled()

    releaseSummary?.()
    await expect(
      dialog.getByRole("button", { name: "All 1000 matching" }),
    ).toBeEnabled()
  })

  test("opens fuzzy search in a full-width popover inside the viewport", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "Mobile Fuzzy Search")
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T14:00:00",
      type: "expense",
      amount_cents: 5000,
      category_id: categoryId,
      title: `Mobile description result ${Date.now()}`,
      description: "Warranty paperwork stored here",
      tags: [],
    })
    await page.goto("/transactions")

    await page.getByRole("button", { name: "Search transactions" }).click()
    const searchbox = page.getByRole("searchbox", { name: "Search transactions" })
    await expect(searchbox).toBeVisible()

    const popoverBox = await page.locator("#transaction-search").boundingBox()
    expect(popoverBox).not.toBeNull()
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    expect(popoverBox!.x).toBeGreaterThanOrEqual(0)
    expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(viewportWidth)
    expect(popoverBox!.width).toBeGreaterThan(viewportWidth * 0.85)

    await searchbox.fill("waranty paperwork")
    await expect(page).toHaveURL(/q=waranty(?:\+|%20)paperwork/)
    await expect(page.getByTestId(`transaction-row-${transactionId}`)).toBeVisible()
    await expect(page.getByRole("button", { name: "Run smart search" })).toHaveCount(0)
  })

  test("collapses secondary actions into an overflow menu and keeps selection discoverable", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "E2E Mobile Selection",
    )
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 2145,
      category_id: categoryId,
      title: `E2E Mobile Selection ${Date.now()}`,
      tags: [],
    })
    await page.goto("/transactions?period=all")

    const title = page.getByRole("heading", { name: "Transactions" })
    await expect(title).toBeVisible()
    await expect(page.getByTestId("transactions-control-zone")).toBeHidden()

    const titleBox = await title.boundingBox()
    const moreBox = await page
      .getByRole("button", { name: "More actions" })
      .boundingBox()
    expect(titleBox).not.toBeNull()
    expect(moreBox).not.toBeNull()
    expect(moreBox!.y).toBeLessThan(titleBox!.y + titleBox!.height)
    await expect(page.getByRole("link", { name: "Inbox" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Trash" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveCount(0)
    await expect(page.getByTestId("transactions-selection-controls")).toBeVisible()

    const filtersTrigger = page.getByRole("button", { name: /Filters/ })
    await expect(filtersTrigger).toBeVisible()
    const filtersBox = await filtersTrigger.boundingBox()
    expect(filtersBox).not.toBeNull()
    expect(filtersBox!.width).toBeLessThanOrEqual(56)

    await page.getByRole("button", { name: "More actions" }).click()
    const menu = page.getByRole("menu")
    await expect(menu.getByRole("menuitem", { name: "Inbox" })).toBeVisible()
    await expect(menu.getByRole("menuitem", { name: "Trash" })).toBeVisible()
    await expect(menu.getByRole("menuitem", { name: "Export CSV" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(menu).toHaveCount(0)

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth)

    const firstRow = page.getByTestId(`transaction-row-${transactionId}`)
    const checkbox = firstRow.getByRole("checkbox", { name: /Select transaction/ })
    await expect(checkbox).toBeVisible()
    await checkbox.check()
    await expect(page.getByTestId("transactions-selection-controls")).toContainText(
      "1 selected",
    )
    await expect(page.getByRole("button", { name: "Bulk edit" })).toBeVisible()
  })

  test("opens and dismisses the transaction location dialog", async ({
    page,
    request,
  }) => {
    await stubOsmTiles(page)

    const title = `E2E Mobile Location ${Date.now()}`
    await createIngestTransaction(request, {
      amount_cents: 880,
      title,
      date: "2026-03-20",
      category: "Food",
      latitude: 52.520008,
      longitude: 13.404954,
    })

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)

    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: /View location/ }).click()

    const dialog = page.getByRole("dialog", { name: "Transaction location" })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("52.520008, 13.404954")
    await expect(dialog.getByTestId("transaction-location-map")).toBeVisible()
    const dialogBounds = await dialog.boundingBox()
    if (!dialogBounds) {
      throw new Error("Expected transaction location dialog bounds")
    }
    const viewport = await page.evaluate(() => ({
      height: window.visualViewport?.height ?? window.innerHeight,
      width: window.visualViewport?.width ?? window.innerWidth,
    }))
    expect(
      Math.abs(viewport.height / 2 - (dialogBounds.y + dialogBounds.height / 2))
    ).toBeLessThan(24)
    expect(
      Math.abs(viewport.width / 2 - (dialogBounds.x + dialogBounds.width / 2))
    )
      .toBeLessThan(24)

    await dialog.getByRole("button", { name: "Close transaction location" }).click()
    await expect(dialog).toHaveCount(0)
  })

  test("navigates to detail from the mobile transaction row itself", async ({ page, request }) => {
    const title = `E2E Mobile Detail CTA ${Date.now()}`
    const transactionId = await createIngestTransaction(request, {
      amount_cents: 930,
      title,
      date: "2026-04-18",
      category: "Food",
    })

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)

    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
    await expect(row).toBeVisible()
    await expect(row.getByRole("link", { name: "View details" })).toHaveCount(0)
    await expect(row.getByRole("link", { name: "Edit" })).toHaveCount(0)

    await row.click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
  })

  test("keeps read-only summary above the fold and overflow-safe on mobile detail", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Mobile Detail")
    const title = `E2E Mobile Detail ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T07:20:00",
      type: "expense",
      amount_cents: 2315,
      category_id: categoryId,
      title,
      tags: ["mobile-summary"],
    })

    await page.goto(`/transactions/${transactionId}`)

    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
    await expect(page.locator("main")).toContainText(title)
    await expect(page.locator("main")).toContainText("-23,15 €")
    await expect(page.locator("main")).toContainText("18.04.2026 07:20")

    const summaryCard = page.locator('[data-financial-surface="hero"]')
    const bounds = await summaryCard.boundingBox()
    if (!bounds) {
      throw new Error("Expected detail summary card bounds")
    }
    const viewport = await page.evaluate(() => ({
      height: window.visualViewport?.height ?? window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    expect(bounds.y + bounds.height).toBeLessThan(viewport.height + 32)
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  })

  test("renders inline location and attachment previews on mobile detail", async ({
    page,
    request,
  }) => {
    await stubOsmTiles(page)

    const token = await getCsrfToken(request)
    const title = `E2E Mobile Detail Modules ${Date.now()}`
    const transactionId = await createIngestTransaction(request, {
      amount_cents: 1775,
      title,
      date: "2026-04-18",
      category: "Food",
      latitude: 52.520008,
      longitude: 13.404954,
    })

    const imageName = `mobile-receipt-${Date.now()}.png`
    const pdfName = `mobile-invoice-${Date.now()}.pdf`
    await uploadAttachment(request, token, transactionId, {
      name: imageName,
      mimeType: "image/png",
      buffer: onePixelPng,
    })
    await uploadAttachment(request, token, transactionId, {
      name: pdfName,
      mimeType: "application/pdf",
      buffer: samplePdf,
    })

    await page.goto(`/transactions/${transactionId}`)

    await expect(page.getByRole("heading", { name: "Location" })).toBeVisible()
    await expect(page.getByTestId("transaction-detail-location-map")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible()
    await expect(page.getByRole("img", { name: imageName })).toBeVisible()
    await expect(page.locator(`iframe[title="${pdfName}"]`)).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByTestId("app-shell-bottom-nav")).toHaveCount(0)
    await expect(page.getByTestId("app-shell-mobile-add-action")).toHaveCount(0)

    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  })

  test("edits a transaction from its mobile detail surface", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "Mobile edit")
    const title = `Mobile edit ${Date.now()}`
    const updatedTitle = `${title} updated`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 2450,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto(`/transactions/${transactionId}`)
    await page.getByRole("link", { name: "Edit transaction" }).click()
    await expect(page).toHaveURL(`/transactions/${transactionId}/edit`)
    await page.getByLabel("Title").fill(updatedTitle)
    await page.getByRole("button", { name: "Save changes" }).click()

    await expect(page).toHaveURL(`/transactions/${transactionId}`)
    await expect(page.getByRole("heading", { name: updatedTitle })).toBeVisible()
  })

  test("recategorizes a transaction from the mobile Inbox", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoriesResponse = await request.get("/api/categories?period=all")
    const categories = (await categoriesResponse.json()) as {
      categories: Array<{
        id: number
        name: string
        type: string
        archived_at: string | null
      }>
    }
    let uncategorizedId = categories.categories.find(
      (category) =>
        category.type === "expense" &&
        category.archived_at === null &&
        category.name.toLowerCase() === "uncategorized"
    )?.id
    if (!uncategorizedId) {
      const created = await request.post("/api/categories", {
        headers: { "X-CSRF-Token": token },
        data: { name: "Uncategorized", type: "expense", order: 0 },
      })
      expect(created.ok()).toBeTruthy()
      uncategorizedId = ((await created.json()) as { id: number }).id
    }
    const targetCategory = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: `Mobile inbox target ${Date.now()}`,
        type: "expense",
        order: 0,
      },
    })
    expect(targetCategory.ok()).toBeTruthy()
    const targetId = ((await targetCategory.json()) as { id: number }).id
    const title = `Mobile inbox ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 3100,
      category_id: uncategorizedId,
      title,
      tags: [],
    })

    await page.goto("/transactions")
    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Inbox" }).click()
    await expect(page).toHaveURL(/\/transactions\/inbox$/)
    await page.getByRole("button", { name: "All time", exact: true }).click()
    await page.getByRole("textbox", { name: "Search", exact: true }).fill(title)
    const row = page.getByTestId(`uncategorized-row-${transactionId}`)
    await row.getByRole("checkbox", { name: `Select transaction ${transactionId}` }).check()
    await page.getByLabel("Move selected to category").selectOption(String(targetId))
    page.once("dialog", (dialog) => dialog.accept())
    await page.getByRole("button", { name: "Apply", exact: true }).click()
    await expect(row).toBeHidden()
  })

  test("keeps the bulk-apply outcome visible in the mobile sheet until dismissed", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "Mobile bulk source")
    const targetResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: { name: `Mobile bulk target ${Date.now()}`, type: "expense", order: 0 },
    })
    expect(targetResponse.ok()).toBeTruthy()
    const targetId = ((await targetResponse.json()) as { id: number }).id
    const title = `Mobile bulk outcome ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 2750,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)
    await page
      .getByRole("checkbox", { name: `Select transaction ${transactionId}` })
      .check()
    await page.getByRole("button", { name: "Bulk edit" }).click()

    const dialog = page.getByRole("dialog", { name: "Bulk edit" })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel("Set category").selectOption(String(targetId))
    page.once("dialog", (confirmDialog) => confirmDialog.accept())
    await dialog.getByRole("button", { name: "Apply", exact: true }).click()

    await expect(dialog.getByText("Resolved 1, skipped 0")).toBeVisible()
    await expect(dialog.getByRole("group", { name: "Bulk edit scope" })).toHaveCount(0)
    const done = dialog.getByRole("button", { name: "Done" })
    await expect(done).toBeVisible()
    await done.click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText("Resolved 1, skipped 0")).toHaveCount(0)
  })

  test("deletes a transaction from mobile detail and permanently deletes it from Trash", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "Mobile delete")
    const title = `Mobile delete ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 1450,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)
    const row = page.getByTestId(`transaction-row-${transactionId}`)
    await expect(row).toBeVisible()
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    page.once("dialog", (dialog) => dialog.accept())
    await page.getByRole("button", { name: "Delete transaction" }).click()
    await expect(page).toHaveURL(/\/transactions\?/)
    await expect(page.getByTestId(`transaction-row-${transactionId}`)).toHaveCount(0)

    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Trash" }).click()
    await expect(page).toHaveURL(/\/transactions\/deleted$/)
    const deletedRow = page.getByTestId(`deleted-transaction-${transactionId}`)
    await expect(deletedRow).toBeVisible()

    page.once("dialog", (dialog) => dialog.accept())
    await deletedRow.getByRole("button", { name: "Delete forever" }).click()
    await expect(deletedRow).toHaveCount(0)
  })

  test("restores a transaction from mobile Trash", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "Mobile trash")
    const title = `Mobile trash ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 1999,
      category_id: categoryId,
      title,
      tags: [],
    })
    const deleted = await request.delete(`/api/transactions/${transactionId}`, {
      headers: { "X-CSRF-Token": token },
    })
    expect(deleted.ok()).toBeTruthy()

    await page.goto("/transactions")
    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Trash" }).click()
    await expect(page).toHaveURL(/\/transactions\/deleted$/)
    const row = page.getByTestId(`deleted-transaction-${transactionId}`)
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: "Restore" }).click()
    await expect(row).toBeHidden()
    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await expect(
      page.locator('[data-testid^="transaction-row-"]').filter({ hasText: title })
    ).toBeVisible()
  })
})
