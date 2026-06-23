import { expect, test } from "@playwright/test"
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

test.describe("Transactions Page (mobile)", () => {
  test("collapses filters and applies from the filter sheet", async ({ page }) => {
    await page.goto("/transactions")

    await expect(page.getByRole("button", { name: /Filters/ })).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Category", exact: true })).toHaveCount(0)

    await page.getByRole("button", { name: /Filters/ }).click()
    const filterDialog = page.getByRole("dialog", { name: "Transaction filters" })
    await expect(filterDialog).toBeVisible()
    await expect(
      filterDialog.getByRole("combobox", { name: "Category", exact: true })
    ).toBeVisible()

    await filterDialog.getByRole("button", { name: "Expense", exact: true }).click()
    await filterDialog.getByRole("button", { name: "Apply" }).click()
    await expect(page).toHaveURL(/type=expense/)
  })

  test("keeps mobile page actions beside the title and opens the menu onscreen", async ({
    page,
  }) => {
    await page.goto("/transactions")

    const title = page.getByRole("heading", { name: "Transactions" })
    const moreActions = page.getByRole("button", { name: "More actions" })
    await expect(title).toBeVisible()
    await expect(moreActions).toBeVisible()

    const layout = await page.evaluate(() => {
      const title = document.querySelector("main h1")
      const button = document.querySelector<HTMLButtonElement>(
        "button[aria-label='More actions']"
      )
      if (!title || !button) {
        return null
      }
      const titleRect = title.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      return {
        buttonCenterY: buttonRect.top + buttonRect.height / 2,
        buttonLeft: buttonRect.left,
        buttonRight: buttonRect.right,
        titleCenterY: titleRect.top + titleRect.height / 2,
        titleRight: titleRect.right,
        viewportWidth: window.innerWidth,
      }
    })

    expect(layout).not.toBeNull()
    if (!layout) {
      return
    }
    expect(Math.abs(layout.buttonCenterY - layout.titleCenterY)).toBeLessThan(10)
    expect(layout.buttonLeft).toBeGreaterThan(layout.titleRight)
    expect(layout.viewportWidth - layout.buttonRight).toBeLessThan(72)

    await moreActions.click()
    const menu = page.getByTestId("transactions-mobile-actions-menu")
    await expect(menu).toBeVisible()
    await expect(menu.getByRole("link", { name: "Inbox" })).toBeVisible()
    await expect(menu.getByRole("link", { name: "Trash" })).toBeVisible()
    await expect(menu.getByRole("button", { name: "Select" })).toBeVisible()

    const menuBox = await menu.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      }
    })

    expect(menuBox.left).toBeGreaterThanOrEqual(0)
    expect(menuBox.right).toBeLessThanOrEqual(menuBox.viewportWidth)
    expect(menuBox.bottom).toBeLessThanOrEqual(menuBox.viewportHeight)
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

    const summaryCard = page.locator("main .surface-card").first()
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
    const addFab = page.getByTestId("app-shell-mobile-add-fab")
    await expect(addFab).toBeVisible()

    const fabBox = await addFab.boundingBox()
    expect(fabBox).not.toBeNull()
    if (!fabBox) {
      return
    }

    const fabReceivesPointer = await page.evaluate(
      ({ x, y }) => {
        const target = document.elementFromPoint(x, y)
        return target instanceof Element
          ? target.closest('[data-testid="app-shell-mobile-add-fab"]') !== null
          : false
      },
      { x: fabBox.x + fabBox.width / 2, y: fabBox.y + fabBox.height / 2 }
    )
    expect(fabReceivesPointer).toBeTruthy()

    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
  })
})
