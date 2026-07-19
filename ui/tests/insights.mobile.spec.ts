import { expect, test } from "./fixtures"

test.describe("Insights Page (mobile)", () => {
  test("keeps the view switch compact and renders single-month chart points", async ({
    page,
  }) => {
    await page.goto("/insights?period=this_month")

    const viewSwitcher = page.locator(".insights-view-switcher")
    await expect(viewSwitcher).toBeVisible()
    const switcherWidth = await viewSwitcher.evaluate(
      (node) => node.getBoundingClientRect().width,
    )
    expect(switcherWidth).toBeLessThan(260)

    const chartPanel = page
      .locator('[data-financial-surface="chart"]')
      .filter({ hasText: "Monthly income vs expenses" })
      .first()
    const canvas = chartPanel.locator("canvas")
    await expect(canvas).toBeVisible()

    await expect
      .poll(() =>
        canvas.evaluate((node) => {
          const chart = node as HTMLCanvasElement
          const context = chart.getContext("2d")
          if (!context) return 0
          const styles = getComputedStyle(document.documentElement)
          const colors = ["--semantic-green", "--semantic-red"].map((token) =>
            styles
              .getPropertyValue(token)
              .trim()
              .split(/\s+/)
              .map(Number),
          )
          const pixels = context.getImageData(0, 0, chart.width, chart.height).data
          let matches = 0
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index + 3] > 0 &&
              colors.some(
                ([red, green, blue]) =>
                  Math.abs(pixels[index] - red) < 12 &&
                  Math.abs(pixels[index + 1] - green) < 12 &&
                  Math.abs(pixels[index + 2] - blue) < 12,
              )
            ) {
              matches += 1
            }
          }
          return matches
        }),
      )
      .toBeGreaterThan(10)
  })
})
