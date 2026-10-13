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
  "base64",
)

test.describe("Transaction receipts and location", () => {
  test("uploads a receipt from the peek, previews it and removes it", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Receipt")
    const title = `E2E Receipt ${Date.now()}`
    const id = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T08:25:00",
      type: "expense",
      amount_cents: 3210,
      category_id: categoryId,
      title,
      tags: [],
    })
    const fileName = `receipt-${Date.now()}.png`

    await page.goto(`/transactions?q=${encodeURIComponent(title)}&peek=${id}`)
    const peek = page.getByRole("complementary", { name: title })
    const chooserPromise = page.waitForEvent("filechooser")
    await peek.getByRole("button", { name: "Drop a receipt or choose a file" }).click()
    const chooser = await chooserPromise
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/transactions/${id}/attachments`) &&
        response.request().method() === "POST" &&
        response.ok(),
    )
    await chooser.setFiles({ name: fileName, mimeType: "image/png", buffer: onePixelPng })
    await uploaded

    const preview = peek.getByRole("button", { name: `Open ${fileName}` })
    await expect(preview).toBeVisible()
    await expect(peek.getByText(fileName)).toBeVisible()

    // The list drops its markers while the peek is open.
    await page.keyboard.press("Escape")
    await expect(peek).toBeHidden()
    const row = page.getByRole("listitem", { name: title })
    await expect(row.getByRole("img", { name: "Receipt" })).toBeVisible()
    await row.click()

    await preview.click()
    const viewer = page.getByRole("dialog", { name: fileName })
    await expect(viewer).toBeVisible()
    await expect(viewer.getByRole("img", { name: fileName })).toBeVisible()
    await viewer.getByRole("button", { name: "Close" }).click()
    await expect(viewer).toBeHidden()

    await peek.getByRole("button", { name: "Receipt actions" }).click()
    await page.getByRole("menuitem", { name: "Remove" }).click()
    const prompt = page.getByRole("dialog", { name: "Remove this receipt?" })
    await prompt.getByRole("button", { name: "Cancel" }).click()
    await expect(preview).toBeVisible()

    await peek.getByRole("button", { name: "Receipt actions" }).click()
    await page.getByRole("menuitem", { name: "Remove" }).click()
    await page.getByRole("dialog", { name: "Remove this receipt?" }).getByRole("button", { name: "Remove" }).click()
    await expect(peek.getByRole("button", { name: "Drop a receipt or choose a file" })).toBeVisible()
    await expect(preview).toHaveCount(0)
    const detail = await request.get(`/api/transactions/${id}`)
    expect(((await detail.json()) as { attachments: unknown[] }).attachments).toHaveLength(0)
  })

  test("replaces a receipt when the transaction has the most attachments allowed", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Receipt")
    const title = `E2E Receipt full ${Date.now()}`
    const id = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T08:25:00",
      type: "expense",
      amount_cents: 3210,
      category_id: categoryId,
      title,
      tags: [],
    })
    for (let index = 0; index < 5; index += 1) {
      await uploadAttachment(request, token, id, { name: `full-${index}.png`, mimeType: "image/png", buffer: onePixelPng })
    }

    await page.goto(`/transactions?q=${encodeURIComponent(title)}&peek=${id}`)
    const peek = page.getByRole("complementary", { name: title })
    const shown = peek.getByRole("button", { name: /^Open full-\d\.png$/ })
    await expect(shown).toBeVisible()
    const replaced = ((await shown.getAttribute("aria-label")) ?? "").replace("Open ", "")
    await peek.getByRole("button", { name: "Receipt actions" }).click()
    const chooserPromise = page.waitForEvent("filechooser")
    await page.getByRole("menuitem", { name: "Replace" }).click()
    const chooser = await chooserPromise
    const uploaded = page.waitForResponse(
      (response) => response.url().includes(`/api/transactions/${id}/attachments`) && response.request().method() === "POST"
    )
    await chooser.setFiles({ name: "replacement.png", mimeType: "image/png", buffer: onePixelPng })

    expect((await uploaded).status()).toBe(200)
    await expect(peek.getByRole("button", { name: "replacement.png", exact: true })).toBeVisible()
    const detail = await request.get(`/api/transactions/${id}`)
    const names = ((await detail.json()) as { attachments: Array<{ original_filename: string }> }).attachments.map(
      (attachment) => attachment.original_filename
    )
    const kept = ["full-0.png", "full-1.png", "full-2.png", "full-3.png", "full-4.png"].filter((name) => name !== replaced)
    expect(names.sort()).toEqual([...kept, "replacement.png"])
  })

  test("shows the location map and existing receipt in the full view", async ({
    page,
    request,
  }) => {
    await stubOsmTiles(page)
    const token = await getCsrfToken(request)
    const title = `E2E Detail Modules ${Date.now()}`
    const id = await createIngestTransaction(request, {
      amount_cents: 1299,
      title,
      date: "2026-04-18",
      category: "Food",
      latitude: 52.520008,
      longitude: 13.404954,
    })
    const imageName = `receipt-${Date.now()}.png`
    await uploadAttachment(request, token, id, {
      name: imageName,
      mimeType: "image/png",
      buffer: onePixelPng,
    })

    await page.goto(`/transactions/${id}`)
    const main = page.getByRole("main")
    await expect(main.getByRole("heading", { name: "Location" })).toBeVisible()
    await expect(main.getByRole("group", { name: "Map at 52.520008, 13.404954" })).toBeVisible()
    await expect(main.getByText("52.520008, 13.404954")).toBeVisible()
    await expect(main.getByRole("heading", { name: "Receipts" })).toBeVisible()
    await expect(main.getByRole("button", { name: `Open ${imageName}` })).toBeVisible()
  })

  test("marks located rows in the list and shows the map in the peek", async ({
    page,
    request,
  }) => {
    await stubOsmTiles(page)
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E No Location")
    const stamp = Date.now()
    const marker = `locationx${stamp}x`
    const locatedId = await createIngestTransaction(request, {
      amount_cents: 1299,
      title: `${marker} located`,
      date: "2026-03-20",
      category: "Food",
      latitude: 52.520008,
      longitude: 13.404954,
    })
    await createTransaction(request, token, {
      date: "2026-03-20",
      occurred_at: "2026-03-20T12:00:00",
      type: "expense",
      amount_cents: 4321,
      category_id: categoryId,
      title: `${marker} plain`,
      tags: [],
    })

    await page.goto(`/transactions?q=${marker}`)
    const located = page.getByRole("listitem", { name: `${marker} located` })
    const plain = page.getByRole("listitem", { name: `${marker} plain` })
    await expect(located.getByRole("img", { name: "Location" })).toBeVisible()
    await expect(plain.getByRole("img", { name: "Location" })).toHaveCount(0)

    await located.click()
    await expect(page).toHaveURL(new RegExp(`peek=${locatedId}`))
    const peek = page.getByRole("complementary", { name: `${marker} located` })
    await expect(peek.getByRole("group", { name: "Map at 52.520008, 13.404954" })).toBeVisible()
    await expect(peek.getByText("OpenStreetMap")).toBeVisible()
  })

  test("omits the location map and receipts cleanly when absent", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Detail No Modules")
    const title = `E2E Detail No Modules ${Date.now()}`
    const id = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T08:25:00",
      type: "expense",
      amount_cents: 3210,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}&peek=${id}`)
    const peek = page.getByRole("complementary", { name: title })
    await expect(peek.getByRole("heading", { name: "Receipts" })).toBeVisible()
    await expect(peek.getByRole("button", { name: "Drop a receipt or choose a file" })).toBeVisible()
    await expect(peek.getByRole("heading", { name: "Location" })).toHaveCount(0)
    await expect(peek.getByRole("group", { name: /^Map at/ })).toHaveCount(0)
    await expect(peek.getByText("None", { exact: true })).toBeVisible()
  })
})
