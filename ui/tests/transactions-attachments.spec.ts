import { expect, test } from "./fixtures"
import {
  createIngestTransaction,
  createTransaction,
  ensureCategory,
  getCsrfToken,
  stubOsmTiles,
  uploadAttachment,
} from "./helpers"

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pfdvK0AAAAASUVORK5CYII=",
  "base64"
)

const samplePdf = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9Db3VudCAxIC9LaWRzIFszIDAgUl0gPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCA+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgMTIwIFRkIChIZWxsbyBwZGYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDUKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNjIgMDAwMDAgbiAKMDAwMDAwMDExNyAwMDAwMCBuIAowMDAwMDAwMjI1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNSAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMzE5CiUlRU9G",
  "base64"
)


test.describe("Transaction attachments and location", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/transactions")
  })

  test("renders inline location and attachment modules on detail with usable actions", async ({
    page,
    request,
  }) => {
    await stubOsmTiles(page)

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
      .locator('[data-financial-surface="hero"]')
      .evaluate((summaryCard) => {
        const pageSection = summaryCard.parentElement
        if (!pageSection) {
          return null
        }
        return {
          summaryWidth: summaryCard.getBoundingClientRect().width,
          gridWidth: pageSection.getBoundingClientRect().width,
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
})
