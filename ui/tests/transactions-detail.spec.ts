import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

test.describe("Transaction detail and edit routes", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/transactions")
  })

  test("keeps transactions-origin detail/edit history coherent and preserves filtered list context", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Expense")

    const title = `E2E Detail ${Date.now()}`
    const tag = "detailflow"
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-12",
      occurred_at: "2026-04-12T09:30:00",
      type: "expense",
      amount_cents: 1234,
      category_id: categoryId,
      title,
      tags: [tag],
    })

    await page.evaluate(() => {
      window.localStorage.setItem("ew.theme.preference", "light")
    })
    const listParams = new URLSearchParams({
      period: "custom",
      start: "2026-04-01",
      end: "2026-04-30",
      type: "expense",
      category: String(categoryId),
      tag,
      q: title,
      page: "1",
    })
    const listUrl = `/transactions?${listParams.toString()}`
    await page.goto(listUrl)
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")

    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
    await expect(row).toBeVisible()
    await row.click()

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")

    await page.locator(`a[href="/transactions/${transactionId}/edit"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    await page.locator(`a[href="/transactions/${transactionId}/edit"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    await page.locator(`a[href="/transactions/${transactionId}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    await page.getByRole("link", { name: "← Back" }).click()
    await expect(page).toHaveURL(listUrl)
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")
  })

  test("supports direct edit-route loads with usable fallback back navigation", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Direct Edit")
    const title = `E2E Direct Edit ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T08:45:00",
      type: "expense",
      amount_cents: 5600,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto("about:blank")
    await page.goto(`/transactions/${transactionId}/edit`)
    await expect(page.locator("main h1")).toContainText("Edit Transaction")
    await expect(page.getByLabel("Title")).toHaveValue(title)

    await page.getByRole("link", { name: "← Back" }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
    await expect(page.locator("body")).toContainText(title)

    await page.goBack()
    await expect(page).toHaveURL("/transactions")
  })

  test("supports direct edit save and returns to refreshed detail with fallback back navigation", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Direct Save")
    const originalTitle = `E2E Direct Save ${Date.now()}`
    const updatedTitle = `${originalTitle} Updated`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T10:15:00",
      type: "expense",
      amount_cents: 4567,
      category_id: categoryId,
      title: originalTitle,
      tags: ["direct-save"],
    })

    await page.goto(`/transactions/${transactionId}/edit`)
    await expect(page.getByLabel("Title")).toHaveValue(originalTitle)

    await page.getByLabel("Title").fill(updatedTitle)
    const saveResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "PUT" &&
        response.status() === 200
    )
    await page.getByRole("button", { name: "Save changes" }).click()
    await saveResponse

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
    await expect(page.locator("body")).toContainText(updatedTitle)

    await page.getByRole("link", { name: "← Back" }).click()
    await expect(page).toHaveURL("/transactions")
  })

  test("keeps user on edit and preserves unsaved values when save fails", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Save Failure")
    const originalTitle = `E2E Save Failure ${Date.now()}`
    const updatedTitle = `${originalTitle} Edited`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T11:25:00",
      type: "expense",
      amount_cents: 1234,
      category_id: categoryId,
      title: originalTitle,
      tags: ["save-fail"],
    })

    const saveFailureMessage = "Save failed from test"
    await page.route(`**/api/transactions/${transactionId}`, async (route, routedRequest) => {
      if (routedRequest.method() === "PUT") {
        await route.fulfill({
          status: 422,
          contentType: "text/plain",
          body: saveFailureMessage,
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/transactions/${transactionId}/edit`)
    await page.getByLabel("Title").fill(updatedTitle)
    await page.getByLabel("Amount").fill("45.67")

    await page.getByRole("button", { name: "Save changes" }).click()

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))
    await expect(page.locator("body")).toContainText(saveFailureMessage)
    await expect(page.getByLabel("Title")).toHaveValue(updatedTitle)
    await expect(page.getByLabel("Amount")).toHaveValue("45.67")
  })

  test("keeps unsaved edit changes isolated when leaving without saving", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Unsaved")
    const originalTitle = `E2E Unsaved ${Date.now()}`
    const updatedTitle = `${originalTitle} Edited`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T12:00:00",
      type: "expense",
      amount_cents: 2345,
      category_id: categoryId,
      title: originalTitle,
      tags: ["unsaved"],
    })

    let putRequests = 0
    page.on("request", (outgoingRequest) => {
      if (
        outgoingRequest.method() === "PUT" &&
        outgoingRequest.url().includes(`/api/transactions/${transactionId}`)
      ) {
        putRequests += 1
      }
    })

    await page.goto(`/transactions/${transactionId}`)
    await page.getByRole("link", { name: "Edit transaction" }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    await page.getByLabel("Title").fill(updatedTitle)
    await page.getByRole("link", { name: "← Back" }).click()

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
    await expect(page.locator("body")).toContainText(originalTitle)
    await expect(page.locator("body")).not.toContainText(updatedTitle)
    expect(putRequests).toBe(0)
  })

  test("renders read-only detail summary metadata and description content", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "income", "E2E Detail Summary")
    const title = `E2E Detail Summary ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T14:05:00",
      type: "income",
      amount_cents: 98765,
      category_id: categoryId,
      title,
      description: "**Reimbursement note** for lunch",
      tags: ["team", "lunch"],
      is_reimbursement: true,
    })

    await page.goto(`/transactions/${transactionId}`)

    await expect(page.locator("main h1")).toContainText("Transaction")
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
    await expect(page.getByLabel("Title")).toHaveCount(0)
    await expect(page.locator("main")).toContainText(title)
    await expect(page.locator("main")).toContainText("+987,65 €")
    await expect(page.locator("main")).toContainText("18.04.2026 14:05")
    await expect(page.locator("main")).toContainText("Reimbursement")
    await expect(page.locator("main")).toContainText("team")
    await expect(page.locator("main")).toContainText("lunch")
    await expect(page.locator("main")).toContainText("Description")
    await expect(page.locator("main")).toContainText("Reimbursement note")
    await expect(page.getByTestId("category-icon").last()).toBeVisible()
    await expect(page.getByText("Recorded", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Edit transaction" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Delete transaction" })).toBeVisible()

    const summaryCard = page.locator('[data-financial-surface="hero"]')
    const bounds = await summaryCard.boundingBox()
    if (!bounds) {
      throw new Error("Expected detail summary card bounds")
    }
    const viewport = page.viewportSize()
    if (!viewport) {
      throw new Error("Expected viewport size")
    }
    expect(bounds.y + bounds.height).toBeLessThan(viewport.height + 24)
  })

  test("shows durable purchase metadata and omits empty description section", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Durable Detail")
    const title = `E2E Durable Detail ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T08:40:00",
      type: "expense",
      amount_cents: 45210,
      category_id: categoryId,
      title,
      tags: ["durable-proof"],
    })

    const durableResponse = await request.post(`/api/transactions/${transactionId}/durable`, {
      headers: { "X-CSRF-Token": token },
      data: {
        expected_lifespan_days: 730,
        acquired_on: "2026-04-01",
      },
    })
    expect(durableResponse.ok()).toBeTruthy()

    await page.goto(`/transactions/${transactionId}`)

    await expect(page.locator("main")).toContainText("Durable purchase")
    await expect(page.locator("main")).toContainText("2 years")
    await expect(page.locator("main")).toContainText("Acquired 01.04.2026")
    await expect(page.getByRole("heading", { name: "Description" })).toHaveCount(0)
  })
})
