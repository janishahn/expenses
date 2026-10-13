import { expect, test } from "./fixtures"

test.describe("Page scope headers (mobile)", () => {
  test("keeps titles above one coherent scope row without overflow", async ({ page }) => {
    const pages = [
      { path: "/", title: "Dashboard", filter: true },
      { path: "/insights", title: "Insights", filter: true },
      { path: "/categories", title: "Categories", filter: false },
      { path: "/tags", title: "Tags", filter: false },
    ]

    for (const entry of pages) {
      await page.goto(entry.path)
      const main = page.getByRole("main")
      const title = main.getByRole("heading", { name: entry.title, level: 1 })
      const period = main.getByRole("group", { name: "Period" })
      await expect(title).toBeVisible()
      await expect(period).toBeVisible()

      const [titleBox, periodBox] = await Promise.all([
        title.boundingBox(),
        period.boundingBox(),
      ])
      expect(titleBox).not.toBeNull()
      expect(periodBox).not.toBeNull()
      expect(periodBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height)

      const filter = main.getByRole("button", { name: "Filter", exact: true })
      if (entry.filter) {
        await expect(filter).toBeVisible()
        const filterBox = await filter.boundingBox()
        expect(filterBox).not.toBeNull()
        expect(Math.abs(filterBox!.y - periodBox!.y)).toBeLessThanOrEqual(1)
        expect(Math.abs(filterBox!.height - periodBox!.height)).toBeLessThanOrEqual(1)
      } else {
        await expect(filter).toHaveCount(0)
      }

      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }))
      expect(layout.content, entry.path).toBeLessThanOrEqual(layout.viewport)
    }
  })

  test("keeps page actions on the title row inside the panel header without overflow", async ({
    page,
  }) => {
    for (const entry of [
      { path: "/transactions", title: "Transactions", action: "Add transaction" },
      { path: "/categories", title: "Categories", action: "Add category" },
      { path: "/tags", title: "Tags", action: "Add tag" },
      { path: "/budgets", title: "Budgets", action: "Add budget" },
    ]) {
      await page.goto(entry.path)
      const header = page.getByRole("main").locator("header").first()
      const title = header.getByRole("heading", { name: entry.title, level: 1 })
      const action = header.getByRole("button", { name: entry.action, exact: true })
      await expect(title).toBeVisible()
      await expect(action).toBeVisible()

      const [headerBox, titleBox, actionBox] = await Promise.all([
        header.boundingBox(),
        title.boundingBox(),
        action.boundingBox(),
      ])
      expect(headerBox).not.toBeNull()
      expect(titleBox).not.toBeNull()
      expect(actionBox).not.toBeNull()
      expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
        headerBox!.x + headerBox!.width,
      )
      expect(
        Math.abs(
          titleBox!.y + titleBox!.height / 2 - (actionBox!.y + actionBox!.height / 2),
        ),
      ).toBeLessThan(8)

      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }))
      expect(layout.content, entry.path).toBeLessThanOrEqual(layout.viewport)
    }
  })
})
