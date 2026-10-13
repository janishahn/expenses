import { expect, test } from "./fixtures"

test.describe("Page scope headers (mobile)", () => {
  test("keeps Canvas-first titles above one coherent scope row without overflow", async ({
    page,
  }) => {
    const pages = [
      { path: "/", title: "Dashboard", filters: true, quickPeriod: true },
      { path: "/insights", title: "Insights", filters: true, quickPeriod: true },
      { path: "/categories", title: "Categories", filters: false, quickPeriod: true },
      { path: "/tags", title: "Tags", filters: false, quickPeriod: true },
    ]

    for (const entry of pages) {
      await page.goto(entry.path)
      const header = page.locator("[data-page-scope-header]")
      const title = header.getByRole("heading", { name: entry.title })
      const period = header.getByRole("group", { name: "Period" })
      await expect(title).toBeVisible()

      const titleBox = await title.boundingBox()
      expect(titleBox).not.toBeNull()

      const filters = header.getByRole("button", { name: /^Filters/ })
      await expect(period).toBeVisible()
      const periodBox = await period.boundingBox()
      expect(periodBox).not.toBeNull()
      expect(periodBox!.y).toBeGreaterThan(titleBox!.y)
      const controlsY = periodBox!.y
      const periodHeight = periodBox!.height

      if (entry.filters) {
        await expect(filters).toBeVisible()
        const filterBox = await filters.boundingBox()
        expect(filterBox).not.toBeNull()
        expect(Math.abs(filterBox!.y - controlsY)).toBeLessThan(1)
        expect(Math.abs(filterBox!.height - periodHeight)).toBeLessThanOrEqual(1)
      } else {
        await expect(filters).toHaveCount(0)
      }

      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }))
      expect(layout.content).toBeLessThanOrEqual(layout.viewport)
    }
  })

  test("keeps the Transactions header actions on the title row without overflow", async ({
    page,
  }) => {
    await page.goto("/transactions")
    const title = page.getByRole("heading", { name: "Transactions", level: 1 })
    const add = page.getByRole("button", { name: "Add transaction", exact: true })
    await expect(title).toBeVisible()
    await expect(add).toBeVisible()
    const [titleBox, addBox] = await Promise.all([title.boundingBox(), add.boundingBox()])
    expect(titleBox).not.toBeNull()
    expect(addBox).not.toBeNull()
    expect(
      Math.abs(titleBox!.y + titleBox!.height / 2 - (addBox!.y + addBox!.height / 2)),
    ).toBeLessThan(8)

    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    expect(layout.content).toBeLessThanOrEqual(layout.viewport)
  })
})
