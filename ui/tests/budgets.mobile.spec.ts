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

  test("opens the unified monthly-first editor from the mobile page action", async ({
    page,
  }) => {
    await page.goto("/budgets?view=year&year=2024")
    await expect(page).not.toHaveURL(/(?:view|year)=/)
    await expect(page.getByRole("heading", { name: "Monthly budgets" })).toBeVisible()
    await expect(page.getByRole("heading", { name: /Annual budgets/ })).toBeVisible()

    const addAction = page.getByTestId("app-shell-mobile-add-action")
    await expect(addAction).toHaveAccessibleName("Add budget")
    await addAction.click()

    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel("Repeats")).toHaveValue("monthly")
    await expect(dialog.getByRole("button", { name: "Save budget" })).toBeVisible()
    await assertNoHorizontalOverflow(page, "budgets-editor")
  })

  test("keeps the unified workspace and expanded details within the viewport", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Mobile Burndown ${Date.now()}`
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      categoryName,
    )
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

    await page.goto("/budgets")
    const row = page.getByTestId("budget-plan-card").filter({ hasText: categoryName })
    await row.getByRole("button", { name: "View details" }).click()
    await expect(row.getByText("Daily allowance")).toBeVisible()

    const compareCheckbox = row.getByLabel("Compare previous month")
    await compareCheckbox.check()
    await expect(compareCheckbox).toBeChecked()
    await expect(row.getByText("Top spending days")).toBeVisible()
    await expect(row).toContainText("MOBILEBURNDOWNOVERFLOW")
    await assertNoHorizontalOverflow(page, "budgets-burndown-compare")

    const cleanupResponse = await request.delete(
      `/api/transactions/${transactionPayload.id}`,
      { headers: { "X-CSRF-Token": token } },
    )
    expect(cleanupResponse.ok()).toBeTruthy()
  })
})
