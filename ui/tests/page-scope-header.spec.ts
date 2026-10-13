import { expect, test } from "./fixtures"

test.describe("Page scope headers", () => {
  test("aligns the desktop utility action with the centered page canvas", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 720 })
    for (const entry of [
      { path: "/", action: "Add transaction" },
      { path: "/categories", action: "Add category" },
      { path: "/tags", action: "Add tag" },
    ]) {
      await page.goto(entry.path)

      const canvas = page.locator(".app-content-frame")
      const action = page.getByTestId("app-shell-utility").getByRole("button", {
        name: entry.action,
      })
      const [canvasBox, actionBox] = await Promise.all([
        canvas.boundingBox(),
        action.boundingBox(),
      ])

      expect(canvasBox).not.toBeNull()
      expect(actionBox).not.toBeNull()
      expect(
        Math.abs(
          actionBox!.x + actionBox!.width - (canvasBox!.x + canvasBox!.width),
        ),
      ).toBeLessThanOrEqual(0.5)
    }
  })

  test("aligns quick periods with page titles when desktop space allows", async ({
    page,
  }) => {
    const pages = [
      { path: "/", title: "Dashboard", filters: true },
      { path: "/insights", title: "Insights", filters: true },
      { path: "/categories", title: "Categories", filters: false },
      { path: "/tags", title: "Tags", filters: false },
    ]

    for (const entry of pages) {
      await page.goto(entry.path)
      const header = page.locator("[data-page-scope-header]")
      const title = header.getByRole("heading", { name: entry.title })
      const period = header.getByRole("group", { name: "Period" })
      await expect(title).toBeVisible()
      await expect(period).toBeVisible()

      const [titleBox, periodBox] = await Promise.all([
        title.boundingBox(),
        period.boundingBox(),
      ])
      expect(titleBox).not.toBeNull()
      expect(periodBox).not.toBeNull()
      expect(Math.abs(titleBox!.y - periodBox!.y)).toBeLessThanOrEqual(8)
      expect(titleBox!.x).toBeLessThan(periodBox!.x)

      const filters = header.getByRole("button", { name: "Filters", exact: true })
      if (entry.filters) {
        await expect(filters).toBeVisible()
        const filterBox = await filters.boundingBox()
        expect(filterBox).not.toBeNull()
        expect(Math.abs(filterBox!.height - periodBox!.height)).toBeLessThanOrEqual(1)
      } else await expect(filters).toHaveCount(0)
    }
  })

  test("keeps the Transactions header within constrained desktop widths", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto("/transactions")
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible()
    await expect(page.getByRole("button", { name: "Add transaction" })).toBeVisible()

    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }))
    expect(layout.content).toBeLessThanOrEqual(layout.viewport)
  })
})
