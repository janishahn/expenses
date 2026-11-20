import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
)

test.describe("Transaction receipts", () => {
  test("reads the items of an uploaded receipt and reads them again", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Receipt")
    const title = `E2E Receipt items ${Date.now()}`
    const id = await createTransaction(request, token, {
      date: "2026-04-18",
      occurred_at: "2026-04-18T08:25:00",
      type: "expense",
      amount_cents: 1000,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto(`/transactions?q=${encodeURIComponent(title)}&peek=${id}`)
    const peek = page.getByRole("complementary", { name: title })
    const chooserPromise = page.waitForEvent("filechooser")
    await peek.getByRole("button", { name: "Drop a receipt or choose a file" }).click()
    await (await chooserPromise).setFiles({ name: "groceries.png", mimeType: "image/png", buffer: onePixelPng })

    // The stub reads every other image as the same grocery receipt, 6,18 € in all.
    const items = peek.getByRole("list", { name: "Receipt items" })
    await expect(items.getByRole("listitem")).toHaveCount(5)
    const item = (product: string) => items.getByRole("listitem").filter({ hasText: product })
    await expect(item("Eier")).toContainText("BIO EIER M 10ST")
    await expect(item("Eier")).toContainText("2,99 €")
    await expect(item("Milch")).toContainText("H-MILCH 3,5% · 2 × 1,19 €")
    await expect(item("Milch")).toContainText("2,38 €")
    await expect(item("Bananen")).toContainText("BANANEN · 0,532 kg × 1,99 €")
    await expect(item("Rabatt")).toContainText("− 0,50 €")
    await expect(peek.getByText("Items cover 6,18 € of 10,00 €")).toBeVisible()
    await expect(peek.getByText("Reading receipt…")).toHaveCount(0)

    // Later readings keep a renamed label's name, so the name stays findable as Bananen.
    const bananas = `Bananen ${Date.now()}`
    await item("Bananen").getByRole("button", { name: "Edit product of BANANEN" }).click()
    await expect(items.getByText("Used for BANANEN on all receipts, past and future.")).toBeVisible()
    await items.getByRole("textbox", { name: "product of BANANEN" }).fill(bananas)
    await page.keyboard.press("Enter")
    await expect(item(bananas)).toContainText("BANANEN · 0,532 kg × 1,99 €")
    await page.reload()
    await expect(item(bananas)).toBeVisible()

    await peek.getByRole("button", { name: "Receipt actions" }).click()
    const read = page.waitForResponse(
      (response) => response.url().endsWith("/items/read") && response.request().method() === "POST",
    )
    await page.getByRole("menuitem", { name: "Read again" }).click()
    expect((await read).status()).toBe(200)
    await expect(items.getByRole("listitem")).toHaveCount(5)
    await expect(item(bananas)).toBeVisible()
    await expect(peek.getByText("Reading receipt…")).toHaveCount(0)
  })

})
