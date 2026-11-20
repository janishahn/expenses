import { expect, test, type Page } from "./fixtures"
import { getCsrfToken } from "./helpers"

async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(width.scroll).toBeLessThanOrEqual(width.client)
}

test.describe("Settings and administration (mobile)", () => {
  test("previews and imports a CSV file", async ({ page }) => {
    await page.goto("/settings/data")
    const csrfToken = await getCsrfToken(page.request)
    const csvCategory = `Mobile Import ${Date.now()}`
    const createCategoryResponse = await page.request.post("/api/categories", {
      headers: { "X-CSRF-Token": csrfToken },
      data: { name: csvCategory, type: "expense", order: 0 },
    })
    expect(createCategoryResponse.ok()).toBeTruthy()

    const csvTitle = `Mobile CSV ${Date.now()}`
    await page.getByLabel("CSV file").setInputFiles({
      name: "mobile-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Date,Type,IsReimbursement,Amount,Category,Title",
          `${new Date().toISOString().slice(0, 10)},expense,0,12.50,${csvCategory},${csvTitle}`,
        ].join("\n")
      ),
    })
    const previewRow = page.getByRole("list", { name: "Preview" }).getByRole("listitem", { name: csvTitle })
    await expect(previewRow).toContainText("12,50 €")
    await expectNoHorizontalOverflow(page)

    await page.getByRole("button", { name: "Import 1 transaction" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Imported 1 transaction." })).toBeVisible()
    const imported = await page.request.get(`/api/transactions?period=all&q=${encodeURIComponent(csvTitle)}`)
    expect(JSON.stringify(await imported.json())).toContain(csvTitle)
  })
})
