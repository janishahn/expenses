import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken, loginAsIsolatedUser } from "./helpers"

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" })

function localMonth(offset = 0): string {
  const value = new Date()
  value.setMonth(value.getMonth() + offset, 1)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`
}

function localDate(): string {
  const value = new Date()
  return `${localMonth()}-${String(value.getDate()).padStart(2, "0")}`
}

function monthName(month: string): string {
  const [year, index] = month.split("-").map(Number)
  return monthFormat.format(new Date(year, index - 1, 1))
}

async function createTemplate(
  request: APIRequestContext,
  token: string,
  data: {
    frequency: "monthly" | "yearly"
    category_id: number | null
    amount_cents: number
    starts_on: string
    ends_on?: string | null
  },
) {
  const response = await request.post("/api/budgets/templates", {
    headers: { "X-CSRF-Token": token },
    data: { ends_on: null, ...data },
  })
  expect(response.ok()).toBeTruthy()
}

// The empty state offers a second "Add budget" button below the header action.
function addBudgetButton(page: Page) {
  return page.getByRole("button", { name: "Add budget", exact: true }).first()
}

async function chooseCategory(page: Page, name: string) {
  await page.getByRole("button", { name: /^Category / }).click()
  await page.getByRole("combobox", { name: "Category" }).fill(name)
  await page.getByRole("option", { name }).click()
}

test.describe("Budgets Page", () => {
  test("creates a usual monthly budget that remains in the next month", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Monthly Budget ${Date.now()}`
    await createCategory(request, token, "expense", categoryName)

    await page.goto("/budgets")
    await addBudgetButton(page).click()
    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await dialog.getByRole("textbox", { name: "Amount" }).fill("321.00")
    await chooseCategory(page, categoryName)
    await dialog.getByRole("button", { name: "Add budget" }).click()
    await expect(dialog).toBeHidden()

    let row = page.getByRole("listitem", { name: categoryName })
    await expect(row).toContainText(/321\s?€/)
    await expect(row).toContainText("left")

    await page.getByRole("button", { name: "Next month" }).click()
    await expect(
      page.getByRole("button", { name: `Month: ${monthName(localMonth(1))}` }),
    ).toBeVisible()
    row = page.getByRole("listitem", { name: categoryName })
    await expect(row).toContainText(/321\s?€/)
    await expect(row).not.toContainText("adjusted")
  })

  test("shows yearly budgets and creates annual budgets in place", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const currentYear = new Date().getFullYear()
    const existingName = `E2E Existing Annual ${Date.now()}`
    const existingId = await createCategory(request, token, "expense", existingName)
    const categoryName = `E2E Annual Budget ${Date.now()}`
    await createCategory(request, token, "expense", categoryName)
    await createTemplate(request, token, {
      frequency: "yearly",
      category_id: existingId,
      amount_cents: 480_000,
      starts_on: `${currentYear}-01-01`,
    })

    await page.goto("/budgets")
    await expect(page.getByText(`Annual · ${currentYear}`)).toBeVisible()
    const existingRow = page.getByRole("listitem", { name: existingName })
    await expect(existingRow).toContainText(/4\.?\s?800\s?€/)

    await addBudgetButton(page).click()
    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await dialog.getByRole("radio", { name: "Annual" }).click()
    await dialog.getByRole("textbox", { name: "Amount" }).fill("6000")
    await chooseCategory(page, categoryName)
    await dialog.getByRole("button", { name: "Add budget" }).click()
    await expect(dialog).toBeHidden()

    const row = page.getByRole("listitem", { name: categoryName })
    await expect(row).toContainText(/6\.?\s?000\s?€/)
    await row.click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await expect(peek.getByText("Every year")).toBeVisible()
    await expect(peek.getByText("Left")).toBeVisible()
  })

  test("shows pace details, top spending days and the overall pace table", async ({ page }) => {
    // Overall pace sums all of the user's spending, so other tests' expenses must not count.
    await page.goto("/")
    const { request, csrfToken: token } = await loginAsIsolatedUser(page)
    const categoryName = `E2E Burndown ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    const title = `E2E Burndown Day ${Date.now()}`
    const monthEnd = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
    ).getDate()
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 40_000,
      starts_on: `${localMonth()}-01`,
    })
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: null,
      amount_cents: 100_000,
      starts_on: `${localMonth()}-01`,
      ends_on: `${localMonth()}-${monthEnd}`,
    })
    await createTransaction(request, token, {
      date: localDate(),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 50_000,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.goto("/budgets")
    const row = page.getByRole("listitem", { name: categoryName })
    await expect(row).toContainText(/500\s?€ of 400\s?€/)
    await expect(row).toContainText(/100\s?€ over/)

    await row.click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await expect(peek).toContainText(/500,00\s?€\s*of 400,00\s?€/)
    await expect(peek.getByText("Projected", { exact: true })).toBeVisible()
    await expect(peek.getByRole("heading", { name: "Pace" })).toBeVisible()
    await expect(peek.getByRole("heading", { name: "Top spending days" })).toBeVisible()
    await expect(peek.getByRole("list", { name: "Top spending days" })).toContainText(title)
    await expect(peek.getByRole("list", { name: "Top spending days" })).toContainText(
      /500,00\s?€/,
    )
    await peek.getByRole("button", { name: "Close" }).click()
    await expect(page).not.toHaveURL(/peek=/)

    const card = page.getByRole("region", { name: "Overall pace" })
    await card.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
    await expect(page.getByRole("menu")).toBeHidden()
    const table = card.getByRole("table", { name: "Overall pace by day" })
    await expect(table.getByRole("columnheader")).toHaveText(["Day", "Even pace", "Actual"])
    const today = String(new Date().getDate())
    await expect(
      table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: today, exact: true }) }),
    ).toContainText(/500,00\s?€/)

    await card.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Compare previous month" }).click()
    await expect(page.getByRole("menu")).toBeHidden()
    await expect(table.getByRole("columnheader", { name: "Previous month" })).toBeVisible()

    await card.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitem", { name: "Edit overall budget" }).click()
    await expect(page).toHaveURL(/peek=month%3Aoverall/)
    await expect(page.getByRole("complementary", { name: "Overall" })).toContainText(
      /500,00\s?€ of 1\s?000,00\s?€/,
    )
    await request.dispose()
  })
})
