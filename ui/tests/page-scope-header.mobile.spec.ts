import { expect, test } from "./fixtures"

test.describe("Page scope headers (mobile)", () => {
  test("keeps Canvas-first titles above one coherent scope row without overflow", async ({
    page,
  }) => {
    const pages = [
      { path: "/", title: "Dashboard", filters: true, quickPeriod: true },
      { path: "/transactions", title: "Transactions", filters: true, quickPeriod: false },
      { path: "/insights", title: "Insights", filters: true, quickPeriod: true },
      { path: "/categories", title: "Categories", filters: false, quickPeriod: true },
      { path: "/tags", title: "Tags", filters: false, quickPeriod: true },
    ]

    for (const entry of pages) {
      await page.goto(entry.path)
      const header = page.locator("[data-page-scope-header]")
      const title = header.getByRole("heading", { name: entry.title })
      const menu = header.getByRole("button", { name: "Open menu" })
      const period = header.getByRole("group", { name: "Period" })
      await expect(title).toBeVisible()
      await expect(menu).toBeVisible()

      const [titleBox, menuBox] = await Promise.all([
        title.boundingBox(),
        menu.boundingBox(),
      ])
      expect(titleBox).not.toBeNull()
      expect(menuBox).not.toBeNull()
      expect(titleBox!.x).toBeGreaterThan(menuBox!.x + menuBox!.width)
      expect(Math.abs(titleBox!.y + titleBox!.height / 2 - (menuBox!.y + menuBox!.height / 2)))
        .toBeLessThan(4)

      const filters = header.getByRole("button", { name: /^Filters/ })
      let controlsY: number
      let periodHeight: number | null = null
      if (entry.quickPeriod) {
        await expect(period).toBeVisible()
        const periodBox = await period.boundingBox()
        expect(periodBox).not.toBeNull()
        expect(periodBox!.y).toBeGreaterThan(titleBox!.y)
        controlsY = periodBox!.y
        periodHeight = periodBox!.height
      } else {
        await expect(period).toHaveCount(0)
        const moreActions = header.getByRole("button", { name: "More actions" })
        await expect(moreActions).toBeVisible()
        const moreActionsBox = await moreActions.boundingBox()
        expect(moreActionsBox).not.toBeNull()
        expect(
          Math.abs(
            titleBox!.y + titleBox!.height / 2
              - (moreActionsBox!.y + moreActionsBox!.height / 2),
          ),
        ).toBeLessThan(4)
        expect(moreActionsBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width)
        const search = header.getByRole("button", { name: "Search transactions" })
        const searchBox = await search.boundingBox()
        expect(searchBox).not.toBeNull()
        expect(searchBox!.y).toBeGreaterThan(titleBox!.y)
        controlsY = searchBox!.y
      }

      if (entry.filters) {
        await expect(filters).toBeVisible()
        const filterBox = await filters.boundingBox()
        expect(filterBox).not.toBeNull()
        expect(Math.abs(filterBox!.y - controlsY)).toBeLessThan(1)
        if (periodHeight !== null) {
          expect(Math.abs(filterBox!.height - periodHeight)).toBeLessThanOrEqual(1)
        }
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
})
