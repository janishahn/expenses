import { expect, test } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

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

  test("opens the add budget dialog from the page header action", async ({ page }) => {
    await page.goto("/budgets")
    await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible()
    const addAction = page.getByRole("button", { name: "Add budget", exact: true }).first()
    await expect(addAction).toHaveText("Add")
    await addAction.click()

    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole("radiogroup", { name: "Budget period" }).getByRole("radio", {
        name: "Monthly",
      }),
    ).toBeChecked()
    await expect(dialog.getByRole("button", { name: "Add budget" })).toBeVisible()
    await assertNoHorizontalOverflow(page, "budgets-editor")
  })

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

  test("creates a monthly budget and adjusts only the selected month", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Mobile Budget ${Date.now()}`
    await createCategory(request, token, "expense", categoryName)

    await page.goto("/budgets")
    await page.getByRole("button", { name: "Add budget", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await dialog.getByRole("textbox", { name: "Amount" }).fill("210")
    await dialog.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("combobox", { name: "Category" }).fill(categoryName)
    await page.getByRole("option", { name: categoryName }).click()
    await dialog.getByRole("button", { name: "Add budget" }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole("listitem", { name: categoryName }).click()
    await expect(page).toHaveURL(/peek=month/)
    const peek = page.getByRole("complementary", { name: categoryName })
    await peek.getByRole("button", { name: /^Amount/ }).click()
    const editor = page.getByRole("dialog", { name: "Edit amount" })
    await expect(
      editor.getByRole("radio", { name: `Only ${monthName(localMonth())}` }),
    ).toBeChecked()
    await editor.getByRole("textbox", { name: "Amount" }).fill("340")
    await editor.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: /^Amount/ })).toContainText(
      /340,00\s?€.*usually 210,00\s?€/,
    )

    await peek.getByRole("button", { name: "Budgets" }).click()
    await expect(page).not.toHaveURL(/peek=/)
    await expect(page.getByRole("listitem", { name: categoryName })).toContainText("adjusted")
    await page.getByRole("button", { name: "Next month" }).click()
    const nextRow = page.getByRole("listitem", { name: categoryName })
    await expect(nextRow).toContainText(/210\s?€/)
    await expect(nextRow).not.toContainText("adjusted")
  })

  test("keeps the workspace and pace details within the viewport", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Mobile Burndown ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    const monthStart = `${localMonth()}-01`
    const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
    for (const [category, amount, endsOn] of [
      [categoryId, 250_000, null],
      [null, 400_000, `${localMonth()}-${monthEnd}`],
    ] as const) {
      const response = await request.post("/api/budgets/templates", {
        headers: { "X-CSRF-Token": token },
        data: {
          frequency: "monthly",
          category_id: category,
          amount_cents: amount,
          starts_on: monthStart,
          ends_on: endsOn,
        },
      })
      expect(response.ok()).toBeTruthy()
    }

    const longTitle = `MOBILEBURNDOWNOVERFLOW${"X".repeat(160)}`
    const now = new Date()
    await createTransaction(request, token, {
      date: `${localMonth()}-${String(now.getDate()).padStart(2, "0")}`,
      occurred_at: now.toISOString(),
      type: "expense",
      amount_cents: 72_500,
      category_id: categoryId,
      title: longTitle,
      tags: [],
    })

    await page.goto("/budgets")
    await assertNoHorizontalOverflow(page, "budgets-list")
    const card = page.getByRole("region", { name: "Overall pace" })
    await card.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
    await expect(card.getByRole("table", { name: "Overall pace by day" })).toBeVisible()
    await assertNoHorizontalOverflow(page, "budgets-pace-table")

    await page.getByRole("listitem", { name: categoryName }).click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await expect(peek.getByText("Allowance")).toBeVisible()
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Compare previous month" }).click()
    await expect(peek.getByRole("heading", { name: "Top spending days" })).toBeVisible()
    await expect(peek).toContainText("MOBILEBURNDOWNOVERFLOW")
    await assertNoHorizontalOverflow(page, "budgets-burndown-compare")
  })
})
