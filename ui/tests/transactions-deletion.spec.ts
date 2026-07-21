import { expect, test } from "./fixtures"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
} from "./helpers"

test.describe("Transaction deletion flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/transactions")
  })

  test("supports detail delete cancel and confirmed deletion", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Detail Delete")
    const title = `E2E Detail Delete ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T13:10:00",
      type: "expense",
      amount_cents: 6789,
      category_id: categoryId,
      title,
      tags: ["detail-delete"],
    })

    await page.goto(`/transactions/${transactionId}`)
    const detailDeleteButton = page.locator("button.btn-danger").first()
    await expect(detailDeleteButton).toBeVisible()

    let cancelPromptMessage = ""
    page.once("dialog", async (dialog) => {
      cancelPromptMessage = dialog.message()
      await dialog.dismiss()
    })
    await detailDeleteButton.click({ force: true })
    expect(cancelPromptMessage).toBe("Delete this transaction?")

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
    await expect(page.locator("body")).toContainText(title)

    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    page.once("dialog", (dialog) => dialog.accept())
    await detailDeleteButton.click({ force: true })
    await deleteResponse

    await expect(page).toHaveURL("/transactions")
  })


  test("deleting from edit keeps browser back away from dead transaction routes", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Edit Delete History")
    const title = `E2E Edit Delete History ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T14:55:00",
      type: "expense",
      amount_cents: 8123,
      category_id: categoryId,
      title,
      tags: ["edit-delete-history"],
    })

    const listUrl = `/transactions?period=all&q=${encodeURIComponent(title)}`
    await page.goto(listUrl)
    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
    await expect(row).toBeVisible()
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    await page.getByRole("link", { name: "Edit transaction", exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    const editDeleteButton = page.locator("form button.btn-danger").first()
    await expect(editDeleteButton).toBeVisible()
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    const confirmDialogEvent = page.waitForEvent("dialog")
    const confirmClick = editDeleteButton.click()
    const confirmDialog = await confirmDialogEvent
    await confirmDialog.accept()
    await confirmClick
    await deleteResponse

    await expect(page).toHaveURL(listUrl)

    await page.goBack()
    await expect(page).toHaveURL("/transactions")
    await expect(page).not.toHaveURL(
      new RegExp(`/transactions/${transactionId}(/edit)?$`)
    )
  })

  test("deleting from direct-detail edit flow clears deleted detail from browser back history", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      "E2E Direct Detail Delete History"
    )
    const title = `E2E Direct Detail Delete History ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T15:20:00",
      type: "expense",
      amount_cents: 8456,
      category_id: categoryId,
      title,
      tags: ["direct-detail-delete-history"],
    })

    await page.goto("/transactions")
    await page.goto(`/transactions/${transactionId}`)
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    await page.getByRole("link", { name: "Edit transaction" }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    const editDeleteButton = page.locator("form button.btn-danger").first()
    await expect(editDeleteButton).toBeVisible()
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    const confirmDialogEvent = page.waitForEvent("dialog")
    const confirmClick = editDeleteButton.click()
    const confirmDialog = await confirmDialogEvent
    await confirmDialog.accept()
    await confirmClick
    await deleteResponse

    await expect(page).toHaveURL("/transactions")

    await page.goBack()
    await expect(page).toHaveURL("/transactions")
    await expect(page).not.toHaveURL(
      new RegExp(`/transactions/${transactionId}(/edit)?$`)
    )
  })

  test("supports direct edit delete cancel and confirmed deletion", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Edit Delete")
    const title = `E2E Edit Delete ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T14:30:00",
      type: "expense",
      amount_cents: 7890,
      category_id: categoryId,
      title,
      tags: ["edit-delete"],
    })

    await page.goto(`/transactions/${transactionId}/edit`)
    const editDeleteButton = page.locator("form button.btn-danger").first()
    await expect(editDeleteButton).toBeVisible()

    const cancelDialogEvent = page.waitForEvent("dialog")
    const cancelClick = editDeleteButton.click({ force: true })
    const cancelDialog = await cancelDialogEvent
    expect(cancelDialog.message()).toBe("Delete this transaction?")
    await cancelDialog.dismiss()
    await cancelClick

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))
    await expect(page.getByLabel("Title")).toHaveValue(title)

    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    const confirmDialogEvent = page.waitForEvent("dialog")
    const confirmClick = editDeleteButton.click({ force: true })
    const confirmDialog = await confirmDialogEvent
    await confirmDialog.accept()
    await confirmClick
    await deleteResponse

    await expect(page).toHaveURL("/transactions")
  })

  test("keeps users on detail and edit with visible errors when delete fails", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Delete Failure")

    const detailTitle = `E2E Detail Delete Failure ${Date.now()}`
    const detailTransactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T15:40:00",
      type: "expense",
      amount_cents: 8901,
      category_id: categoryId,
      title: detailTitle,
      tags: ["detail-delete-fail"],
    })

    const detailDeleteError = "Delete failed from detail"
    await page.route(`**/api/transactions/${detailTransactionId}`, async (route, routedRequest) => {
      if (routedRequest.method() === "DELETE") {
        await route.fulfill({
          status: 500,
          contentType: "text/plain",
          body: detailDeleteError,
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/transactions/${detailTransactionId}`)
    const detailDeleteButton = page.locator("button.btn-danger").first()
    await expect(detailDeleteButton).toBeVisible()
    const detailDeleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${detailTransactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 500
    )
    const detailDialogEvent = page.waitForEvent("dialog")
    const detailClick = detailDeleteButton.click()
    const detailDialog = await detailDialogEvent
    await detailDialog.accept()
    await detailClick
    await detailDeleteResponse

    await expect(page).toHaveURL(new RegExp(`/transactions/${detailTransactionId}$`))
    await expect(page.locator("body")).toContainText(detailDeleteError)

    const editTitle = `E2E Edit Delete Failure ${Date.now()}`
    const editTransactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T16:05:00",
      type: "expense",
      amount_cents: 9012,
      category_id: categoryId,
      title: editTitle,
      tags: ["edit-delete-fail"],
    })

    const editDeleteError = "Delete failed from edit"
    await page.route(`**/api/transactions/${editTransactionId}`, async (route, routedRequest) => {
      if (routedRequest.method() === "DELETE") {
        await route.fulfill({
          status: 500,
          contentType: "text/plain",
          body: editDeleteError,
        })
        return
      }
      await route.continue()
    })

    await page.goto(`/transactions/${editTransactionId}/edit`)
    const editDeleteButton = page.locator("form button.btn-danger").first()
    await expect(editDeleteButton).toBeVisible()
    const editDeleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${editTransactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 500
    )
    const editDialogEvent = page.waitForEvent("dialog")
    const editClick = editDeleteButton.click()
    const editDialog = await editDialogEvent
    await editDialog.accept()
    await editClick
    await editDeleteResponse

    await expect(page).toHaveURL(new RegExp(`/transactions/${editTransactionId}/edit$`))
    await expect(page.locator("body")).toContainText(editDeleteError)
  })

  test("shows recoverable not-found states for missing detail and edit routes", async ({
    page,
  }) => {
    await page.goto("/transactions/999999999")
    await expect(page.locator("body")).toContainText("Transaction not found")
    await page.getByRole("link", { name: "← Back" }).click()
    await expect(page).toHaveURL("/transactions")

    await page.goto("/transactions/999999999/edit")
    await expect(page.locator("body")).toContainText("Transaction not found")
    await page.getByRole("link", { name: "← Back" }).click()
    await expect(page).toHaveURL("/transactions")
  })
})
