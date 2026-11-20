import { expect, test } from "./fixtures"

test.describe("Budgets Page Mobile", () => {
  async function findOverflowingElements(page: Parameters<typeof test>[0]["page"]) {
    return page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const results: Array<{
        tag: string
        className: string
        scrollWidth: number
        clientWidth: number
        textSnippet: string
      }> = []
      for (const el of document.querySelectorAll("*")) {
        if (el.scrollWidth > vw) {
          results.push({
            tag: el.tagName.toLowerCase(),
            className: el.className.toString().slice(0, 160),
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            textSnippet: (el.textContent || "").slice(0, 60),
          })
        }
      }
      return { viewportWidth: vw, overflowing: results }
    })
  }

  async function assertNoHorizontalOverflow(
    page: Parameters<typeof test>[0]["page"],
    label: string,
  ) {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    let message = `${label}: scrollWidth ${scrollWidth} exceeds clientWidth ${clientWidth}`
    if (scrollWidth > clientWidth) {
      const debug = await findOverflowingElements(page)
      message +=
        `\nviewport: ${debug.viewportWidth}px, scroll: ${scrollWidth}px\n` +
        debug.overflowing
          .map(
            (entry) =>
              `  <${entry.tag}> scrollW=${entry.scrollWidth} clientW=${entry.clientWidth} class="${entry.className}" text="${entry.textSnippet}"`,
          )
          .join("\n")
    }

    expect(scrollWidth, message).toBeLessThanOrEqual(clientWidth)
  }

  function localMonth(offset = 0): string {
    const value = new Date()
    value.setMonth(value.getMonth() + offset, 1)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`
  }

  function monthName(month: string): string {
    const [year, index] = month.split("-").map(Number)
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
      new Date(year, index - 1, 1),
    )
  }

  test("keeps month navigation within the viewport without overlapping its controls", async ({
    page,
  }) => {
    await page.goto("/budgets")
    const group = page.getByRole("group", { name: "Month" })
    const current = localMonth()
    const month = page.getByRole("button", { name: `Month: ${monthName(current)}` })
    await expect(group).toBeVisible()

    const [groupBox, labelBox, previousBox, nextBox] = await Promise.all([
      group.boundingBox(),
      month.boundingBox(),
      page.getByRole("button", { name: "Previous month" }).boundingBox(),
      page.getByRole("button", { name: "Next month" }).boundingBox(),
    ])
    const viewport = page.viewportSize()
    expect(groupBox).not.toBeNull()
    expect(labelBox).not.toBeNull()
    expect(previousBox).not.toBeNull()
    expect(nextBox).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(groupBox!.x).toBeGreaterThanOrEqual(0)
    expect(groupBox!.x + groupBox!.width).toBeLessThanOrEqual(viewport!.width)
    expect(previousBox!.x + previousBox!.width).toBeLessThanOrEqual(labelBox!.x)
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(nextBox!.x)

    await page.getByRole("button", { name: "Next month" }).click()
    await expect(
      page.getByRole("button", { name: `Month: ${monthName(localMonth(1))}` }),
    ).toBeVisible()
    await page.getByRole("button", { name: /^Month: / }).click()
    await expect(page.getByRole("dialog", { name: "Choose month" })).toBeVisible()
    await page.getByRole("button", { name: "Next year" }).click()
    await page.getByRole("button", { name: "Jun", exact: true }).click()
    const target = `${Number(localMonth(1).slice(0, 4)) + 1}-06`
    await expect(page).toHaveURL(new RegExp(`month=${target}`))
    await expect(
      page.getByRole("button", { name: `Month: ${monthName(target)}` }),
    ).toBeVisible()
    await assertNoHorizontalOverflow(page, "budget-period-navigation")
  })
})
