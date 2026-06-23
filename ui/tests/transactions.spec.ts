import { expect, test } from "@playwright/test"
import {
  createIngestTransaction,
  createTransaction,
  ensureCategory,
  getCsrfToken,
  stubOsmTiles,
  uploadAttachment,
} from "./helpers"

test.describe("Transactions Page", () => {
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pfdvK0AAAAASUVORK5CYII=",
  "base64"
)

const samplePdf = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9Db3VudCAxIC9LaWRzIFszIDAgUl0gPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCA+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgMTIwIFRkIChIZWxsbyBwZGYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNjIgMDAwMDAgbiAKMDAwMDAwMDExNyAwMDAwMCBuIAowMDAwMDAwMjI1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNSAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMzE5CiUlRU9G",
  "base64"
)

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
    await page.getByRole("link", { name: "Edit" }).click()
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

    const summaryCard = page.locator("main .surface-card").first()
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

    await page.getByRole("link", { name: "Edit" }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    const editDeleteButton = page.locator("form button.btn-danger").first()
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    page.once("dialog", (dialog) => dialog.accept())
    await editDeleteButton.click({ force: true })
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

    await page.getByRole("link", { name: "Edit" }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    const editDeleteButton = page.locator("form button.btn-danger").first()
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    page.once("dialog", (dialog) => dialog.accept())
    await editDeleteButton.click({ force: true })
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

    let cancelPromptMessage = ""
    page.once("dialog", async (dialog) => {
      cancelPromptMessage = dialog.message()
      await dialog.dismiss()
    })
    await editDeleteButton.click({ force: true })
    expect(cancelPromptMessage).toBe("Delete this transaction?")

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))
    await expect(page.getByLabel("Title")).toHaveValue(title)

    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${transactionId}`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    page.once("dialog", (dialog) => dialog.accept())
    await editDeleteButton.click({ force: true })
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
    page.once("dialog", (dialog) => dialog.accept())
    await detailDeleteButton.click({ force: true })

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
    page.once("dialog", (dialog) => dialog.accept())
    await editDeleteButton.click({ force: true })

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

  test("renders inline location and attachment modules on detail with usable actions", async ({
    page,
    request,
  }) => {
    await stubOsmTiles(page)
    await page.addInitScript(() => {
      const openCalls: string[] = []
      ;(window as typeof window & { __attachmentOpenCalls: string[] }).__attachmentOpenCalls =
        openCalls
      window.open = ((url?: string | URL) => {
        const normalizedUrl = typeof url === "string" ? url : url ? String(url) : ""
        openCalls.push(normalizedUrl)
        if (normalizedUrl.startsWith("blob:")) {
          return null
        }
        return {
          closed: false,
          close() {},
          location: { href: normalizedUrl },
          opener: null,
        } as unknown as Window
      }) as typeof window.open
    })

    const token = await getCsrfToken(request)
    const title = `E2E Detail Modules ${Date.now()}`
    const transactionId = await createIngestTransaction(request, {
      amount_cents: 1299,
      title,
      date: "2026-04-18",
      category: "Food",
      latitude: 52.520008,
      longitude: 13.404954,
    })

    const imageName = `receipt-${Date.now()}.png`
    const pdfName = `invoice-${Date.now()}.pdf`
    const imageAttachmentId = await uploadAttachment(request, token, transactionId, {
      name: imageName,
      mimeType: "image/png",
      buffer: onePixelPng,
    })
    const pdfAttachmentId = await uploadAttachment(request, token, transactionId, {
      name: pdfName,
      mimeType: "application/pdf",
      buffer: samplePdf,
    })

    await page.goto(`/transactions/${transactionId}`)

    await expect(page.getByRole("heading", { name: "Location" })).toBeVisible()
    await expect(page.getByTestId("transaction-detail-location-map")).toBeVisible()
    await expect(page.locator("main")).toContainText("52.520008, 13.404954")
    await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible()
    await expect(page.getByRole("img", { name: imageName })).toBeVisible()
    await expect(page.locator(`iframe[title="${pdfName}"]`)).toBeVisible()

    const openResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/attachments/${imageAttachmentId}/download`) &&
        response.request().method() === "GET" &&
        response.status() === 200
    )
    await page.getByRole("button", { name: `Open ${imageName}` }).click()
    await openResponse
    await expect(page.locator("main")).not.toContainText("Unable to open attachment")

    const openCalls = await page.evaluate(
      () =>
        (window as typeof window & { __attachmentOpenCalls?: string[] })
          .__attachmentOpenCalls ?? []
    )
    expect(openCalls.length).toBeGreaterThan(0)
    expect(openCalls[0]?.startsWith("blob:")).toBe(false)

    const downloadResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/attachments/${pdfAttachmentId}/download`) &&
        response.request().method() === "GET" &&
        response.status() === 200
    )
    await page.getByRole("button", { name: `Download ${pdfName}` }).click()
    await downloadResponse
  })

  test("omits location and attachment modules cleanly when absent", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Detail No Modules")
    const title = `E2E Detail No Modules ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T08:25:00",
      type: "expense",
      amount_cents: 3210,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto(`/transactions/${transactionId}`)

    await expect(page.getByRole("heading", { name: "Location" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Attachments" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Metadata" })).toHaveCount(0)
    await expect(page.getByTestId("transaction-detail-location-map")).toHaveCount(0)

    const summaryLayout = await page
      .getByRole("heading", { name: title })
      .evaluate((heading) => {
        const summaryCard = heading.parentElement?.parentElement
        const summaryGrid = summaryCard?.parentElement
        if (!summaryCard || !summaryGrid) {
          return null
        }
        return {
          summaryWidth: summaryCard.getBoundingClientRect().width,
          gridWidth: summaryGrid.getBoundingClientRect().width,
        }
      })

    expect(summaryLayout).not.toBeNull()
    if (!summaryLayout) {
      return
    }
    expect(summaryLayout.summaryWidth / summaryLayout.gridWidth).toBeGreaterThanOrEqual(0.95)
  })

  test("should open a location dialog with an embedded map", async ({
    page,
    request,
  }) => {
    await stubOsmTiles(page)

    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E No Location")
    const locationTitle = `E2E Location ${Date.now()}`
    const plainTitle = `E2E No Location ${Date.now()}`

    await createIngestTransaction(request, {
      amount_cents: 1299,
      title: locationTitle,
      date: "2026-03-20",
      category: "Food",
      latitude: 52.520008,
      longitude: 13.404954,
    })

    await createTransaction(request, token, {
      date: "2026-03-20",
      occurred_at: new Date("2026-03-20T12:00:00Z").toISOString(),
      type: "expense",
      amount_cents: 4321,
      category_id: categoryId,
      title: plainTitle,
      tags: [],
    })

    await page.goto("/transactions?period=all")

    const locationRow = page.locator("div.surface-card").filter({ hasText: locationTitle }).first()
    const plainRow = page.locator("div.surface-card").filter({ hasText: plainTitle }).first()

    await expect(locationRow).toBeVisible()
    await expect(plainRow).toBeVisible()
    await expect(locationRow.getByRole("button", { name: /View location/ })).toBeVisible()
    await expect(plainRow.getByRole("button", { name: /View location/ })).toHaveCount(0)
    await expect(page.getByTestId("transaction-location-map")).toHaveCount(0)

    await locationRow.getByRole("button", { name: /View location/ }).click()

    const dialog = page.getByRole("dialog", { name: "Transaction location" })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(locationTitle)
    await expect(dialog).toContainText("20.03.2026")
    await expect(dialog).toContainText("Food")
    await expect(dialog).toContainText("-12,99 €")
    await expect(dialog).toContainText("52.520008, 13.404954")
    await expect(dialog.getByTestId("transaction-location-map")).toBeVisible()
    await expect(dialog).toContainText("OpenStreetMap")

    await dialog.getByRole("button", { name: "Close transaction location" }).click()
    await expect(dialog).toHaveCount(0)

    await locationRow.getByRole("button", { name: /View location/ }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
  })

  test("should vertically center row selection checkbox and category icon on desktop", async ({
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
    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
    await expect(row).toBeVisible()

    const checkbox = row.getByRole("checkbox", {
      name: `Select transaction ${transactionId}`,
    })
    await expect(checkbox).toBeVisible()

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

    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
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

    await page.goto(`/transactions/inbox?period=all&q=${encodeURIComponent(title)}`)
    const row = page.locator("div.surface-card").filter({ hasText: title }).first()
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
  })

})

test.describe("Deleted Transactions Page", () => {
  test("should have back link to transactions", async ({ page }) => {
    await page.goto("/transactions/deleted")
    const backLink = page.getByRole("link", { name: /back to transactions/i })
    await expect(backLink).toBeVisible()
  })

  test("should show empty state or deleted list", async ({ page }) => {
    await page.goto("/transactions/deleted")
    await page.waitForLoadState("networkidle")
    await expect(page.locator("main")).toContainText(
      /Restore|No deleted transactions/
    )
  })

  test("should restore a deleted transaction", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Expense")
    const title = `E2E Restore ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 999,
      category_id: categoryId,
      title,
      tags: [],
    })
    const deleteResponse = await request.delete(`/api/transactions/${transactionId}`, {
      headers: { "X-CSRF-Token": token },
    })
    expect(deleteResponse.ok()).toBeTruthy()

    await page.goto("/transactions/deleted")
    const row = page.locator("div.surface-card", { hasText: title }).first()
    await expect(row).toBeVisible()
    await row.getByRole("button", { name: "Restore" }).click()

    await page.goto(`/transactions?q=${encodeURIComponent(title)}`)
    await expect(page.locator("body")).toContainText(title)
  })

  test("should permanently delete a deleted transaction", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Expense")
    const title = `E2E Delete Forever ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 1234,
      category_id: categoryId,
      title,
      tags: [],
    })
    const deleteResponse = await request.delete(`/api/transactions/${transactionId}`, {
      headers: { "X-CSRF-Token": token },
    })
    expect(deleteResponse.ok()).toBeTruthy()

    await page.goto("/transactions/deleted")
    const row = page.locator("div.surface-card", { hasText: title }).first()
    await expect(row).toBeVisible()

    page.once("dialog", (dialog) => dialog.accept())
    const permanentDeleteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/transactions/${transactionId}/permanent`) &&
        response.request().method() === "DELETE" &&
        response.status() === 200
    )
    await row.getByRole("button", { name: "Delete forever" }).click()
    await permanentDeleteResponse

    await expect(row).toHaveCount(0)
    const detailResponse = await request.get(`/api/transactions/${transactionId}`)
    expect(detailResponse.status()).toBe(404)
  })

})
