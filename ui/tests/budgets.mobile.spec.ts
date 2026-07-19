import { expect, test } from "./fixtures"
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

  test("should open the recurring budget modal from the mobile page action", async ({
    page,
  }) => {
    await page.goto("/budgets?view=templates")
    const addAction = page.getByTestId("app-shell-mobile-add-action")
    await expect(addAction).toHaveAccessibleName("Add budget")
    await expect(addAction).toHaveText("Add budget")
    await addAction.click()

    const dialog = page.getByRole("dialog", { name: "Add recurring budget" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Save recurring budget" })).toBeVisible()
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
