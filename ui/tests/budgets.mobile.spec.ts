import { expect, test } from "@playwright/test"
import { ensureCategory, getCsrfToken } from "./helpers"

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

  async function assertNoHorizontalOverflow(page: Parameters<typeof test>[0]["page"], label: string) {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

    if (scrollWidth > clientWidth) {
      const debug = await findOverflowingElements(page)
      console.log(
        `\n--- Overflow debug for ${label} ---\n` +
          `viewport: ${debug.viewportWidth}px, scroll: ${scrollWidth}px\n` +
          debug.overflowing
            .map(
              (entry) =>
                `  <${entry.tag}> scrollW=${entry.scrollWidth} clientW=${entry.clientWidth} class="${entry.className}" text="${entry.textSnippet}"`,
            )
            .join("\n"),
      )
    }

    expect(
      scrollWidth,
      `${label}: scrollWidth ${scrollWidth} exceeds clientWidth ${clientWidth}`,
    ).toBeLessThanOrEqual(clientWidth)
  }

  test("should jump to the recurring budget form from the mobile page action", async ({
    page,
  }) => {
    await page.goto("/budgets?view=templates")
    await expect(
      page.getByRole("button", { name: "Add recurring budget" })
    ).toBeVisible()

    const saveButton = page.getByRole("button", { name: "Save recurring budget" })
    const initialY = await saveButton.evaluate(
      (node) => node.getBoundingClientRect().top,
    )

    await page.getByRole("button", { name: "Add recurring budget" }).click()

    await expect.poll(async () => {
      return saveButton.evaluate((node) => node.getBoundingClientRect().top)
    }).toBeLessThan(initialY)
  })

  test("keeps expanded burndown and compare controls contained in the viewport", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Mobile Burndown")
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`
    const templateResponse = await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "monthly",
        category_id: categoryId,
        amount_cents: 250_000,
        starts_on: monthStart,
        ends_on: null,
      },
    })
    expect(templateResponse.ok()).toBeTruthy()

    const longTitle = `MOBILEBURNDOWNOVERFLOW${"X".repeat(160)}`
    const transactionResponse = await request.post("/api/transactions", {
      headers: { "X-CSRF-Token": token },
      data: {
        date: `${new Date().toISOString().slice(0, 7)}-15`,
        occurred_at: new Date().toISOString(),
        type: "expense",
        amount_cents: 72_500,
        category_id: categoryId,
        title: longTitle,
        tags: [],
      },
    })
    expect(transactionResponse.ok()).toBeTruthy()
    const transactionPayload = (await transactionResponse.json()) as { id: number }

    await page.goto("/budgets?view=month")
    const showChartButton = page.getByRole("button", { name: "Show chart" }).first()
    await expect(showChartButton).toBeVisible()
    await showChartButton.click()
    await expect(page.getByText("Daily allowance")).toBeVisible()

    const compareCheckbox = page.getByLabel("Compare previous month").first()
    await compareCheckbox.check()
    await expect(compareCheckbox).toBeChecked()
    await expect(page.getByText("Top spending days")).toBeVisible()
    await expect(page.locator("body")).toContainText("MOBILEBURNDOWNOVERFLOW")

    await expect(page.getByText("Daily allowance").first()).toBeVisible()
    await expect(page.getByText("Projected finish").first()).toBeVisible()
    await expect(page.getByText("Top spending days").first()).toBeVisible()
    await expect(compareCheckbox.locator("xpath=ancestor::label[1]")).toBeVisible()

    await assertNoHorizontalOverflow(page, "budgets-burndown-compare")

    const cleanupResponse = await request.delete(
      `/api/transactions/${transactionPayload.id}`,
      {
        headers: { "X-CSRF-Token": token },
      },
    )
    expect(cleanupResponse.ok()).toBeTruthy()
  })
})
