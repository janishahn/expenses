import { expect, test } from "./fixtures"

test.describe("Page scope headers", () => {
  test("keeps page actions inside the panel header at constrained desktop widths", async ({
    page,
  }) => {
    for (const width of [861, 1024]) {
      await page.setViewportSize({ width, height: 800 })
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

        // The header can remount its actions when the page data arrives; measure again until it settles.
        await expect(async () => {
          const [headerBox, titleBox, actionBox] = await Promise.all([
            header.boundingBox(),
            title.boundingBox(),
            action.boundingBox(),
          ])
          expect(headerBox).not.toBeNull()
          expect(titleBox).not.toBeNull()
          expect(actionBox).not.toBeNull()
          expect(actionBox!.x).toBeGreaterThanOrEqual(headerBox!.x)
          expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
            headerBox!.x + headerBox!.width,
          )
          expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(actionBox!.x)
          expect(
            Math.abs(
              titleBox!.y + titleBox!.height / 2 - (actionBox!.y + actionBox!.height / 2),
            ),
          ).toBeLessThanOrEqual(8)
        }).toPass()

        const layout = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        }))
        expect(layout.content, `${entry.path} at ${width}px`).toBeLessThanOrEqual(
          layout.viewport,
        )
      }
    }
  })
})
