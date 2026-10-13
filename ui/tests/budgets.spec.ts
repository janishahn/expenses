import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

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

async function createOverride(
  request: APIRequestContext,
  token: string,
  data: { category_id: number | null; amount_cents: number },
) {
  const [year, month] = localMonth().split("-").map(Number)
  const response = await request.post("/api/budgets/overrides", {
    headers: { "X-CSRF-Token": token },
    data: { year, month, ...data },
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
  test("shows the month workspace, month picker and the add budget dialog", async ({
    page,
  }) => {
    await page.goto("/budgets")
    await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible()
    const current = localMonth()
    await expect(
      page.getByRole("button", { name: `Month: ${monthName(current)}` }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Today" })).toBeDisabled()

    await page.getByRole("button", { name: `Month: ${monthName(current)}` }).click()
    await page.getByRole("button", { name: "Previous year" }).click()
    await page.getByRole("button", { name: "Mar", exact: true }).click()
    const target = `${Number(current.slice(0, 4)) - 1}-03`
    await expect(page).toHaveURL(new RegExp(`month=${target}`))
    await expect(
      page.getByRole("button", { name: `Month: ${monthName(target)}` }),
    ).toBeVisible()

    await page.getByRole("button", { name: "Today" }).click()
    await expect(
      page.getByRole("button", { name: `Month: ${monthName(current)}` }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Today" })).toBeDisabled()

    await addBudgetButton(page).click()
    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole("radiogroup", { name: "Budget period" }).getByRole("radio", {
        name: "Monthly",
      }),
    ).toBeChecked()
    await expect(dialog.getByRole("button", { name: "Add budget" })).toBeVisible()
    await expect(
      dialog.getByRole("button", { name: "Category All expense categories" }),
    ).toBeVisible()
  })

  test("shows an empty state for a month without budgets", async ({ page }) => {
    await page.goto("/budgets?month=2000-01")
    await expect(page.getByText("No budgets for January 2000")).toBeVisible()
    await expect(addBudgetButton(page)).toBeVisible()
  })

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

  test("applies a peek edit to only the selected month by default", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Month Adjustment ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 30_000,
      starts_on: `${localMonth()}-01`,
    })

    await page.goto("/budgets")
    await page.getByRole("listitem", { name: categoryName }).click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await expect(peek).toContainText(/300,00\s?€/)
    await peek.getByRole("button", { name: /^Amount/ }).click()
    const editor = page.getByRole("dialog", { name: "Edit amount" })
    await expect(
      editor.getByRole("radio", { name: `Only ${monthName(localMonth())}` }),
    ).toBeChecked()
    await editor.getByRole("textbox", { name: "Amount" }).fill("450.00")
    await editor.getByRole("button", { name: "Save" }).click()

    await expect(peek.getByRole("button", { name: /^Amount/ })).toContainText(
      /450,00\s?€.*usually 300,00\s?€/,
    )
    await expect(peek.getByText("Every month")).toBeVisible()
    const row = page.getByRole("listitem", { name: categoryName })
    await expect(row).toContainText("adjusted")
    await expect(row).toContainText(/450\s?€/)

    await page.getByRole("button", { name: "Next month" }).click()
    const nextRow = page.getByRole("listitem", { name: categoryName })
    await expect(nextRow).toContainText(/300\s?€/)
    await expect(nextRow).not.toContainText("adjusted")
  })

  test("applies a peek edit to the month and later months when chosen", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Later Adjustment ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 20_000,
      starts_on: `${localMonth()}-01`,
    })

    await page.goto("/budgets")
    await page.getByRole("listitem", { name: categoryName }).click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await peek.getByRole("button", { name: /^Amount/ }).click()
    const editor = page.getByRole("dialog", { name: "Edit amount" })
    await editor.getByRole("radio", { name: `${monthName(localMonth())} and later` }).click()
    await editor.getByRole("textbox", { name: "Amount" }).fill("260")
    await editor.getByRole("button", { name: "Save" }).click()
    await expect(peek.getByRole("button", { name: /^Amount/ })).toContainText(/260,00\s?€/)

    await page.getByRole("button", { name: "Next month" }).click()
    const nextRow = page.getByRole("listitem", { name: categoryName })
    await expect(nextRow).toContainText(/260\s?€/)
  })

  test("validates a new budget's amount, uniqueness and end month", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Duplicate Budget ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 10_000,
      starts_on: `${localMonth()}-01`,
    })

    await page.goto("/budgets")
    await addBudgetButton(page).click()
    const dialog = page.getByRole("dialog", { name: "Add budget" })
    await dialog.getByRole("button", { name: "Add budget" }).click()
    await expect(dialog.getByRole("alert")).toHaveText("Enter a valid amount.")

    await dialog.getByRole("textbox", { name: "Amount" }).fill("50")
    await chooseCategory(page, categoryName)
    await dialog.getByRole("button", { name: "Add budget" }).click()
    await expect(dialog.getByRole("alert")).toHaveText(
      `${categoryName} already has a monthly budget for this period. Edit that budget instead.`,
    )

    await dialog.getByRole("button", { name: /^Category / }).click()
    await page.getByRole("combobox", { name: "Category" }).fill("All expense")
    await page.getByRole("option", { name: "All expense categories" }).click()
    await dialog.getByRole("button", { name: "No end" }).click()
    await page
      .getByRole("dialog", { name: "Ends" })
      .getByLabel("Ends")
      .fill(localMonth(-3))
    await page.getByRole("dialog", { name: "Ends" }).getByRole("button", { name: "Done" }).click()
    await dialog.getByRole("button", { name: "Add budget" }).click()
    await expect(dialog.getByRole("alert")).toHaveText(
      "The end must not be before the start.",
    )
  })

  test("resets monthly overrides to the usual amount and removes one-month budgets", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Existing Budget ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    const oneOffName = `E2E Existing One-Off ${Date.now()}`
    const oneOffId = await createCategory(request, token, "expense", oneOffName)
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 50_000,
      starts_on: `${localMonth()}-01`,
    })
    await createOverride(request, token, { category_id: categoryId, amount_cents: 70_000 })
    await createOverride(request, token, { category_id: oneOffId, amount_cents: 22_000 })

    await page.goto("/budgets")
    let row = page.getByRole("listitem", { name: categoryName })
    await expect(row).toContainText("adjusted")
    await expect(row).toContainText(/700\s?€/)
    await row.click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await expect(peek.getByRole("button", { name: /^Amount/ })).toContainText(
      /700,00\s?€.*usually 500,00\s?€/,
    )
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: /^Reset to usual 500,00\s?€/ }).click()
    await expect(peek.getByRole("button", { name: /^Amount/ })).toContainText(/500,00\s?€/)
    row = page.getByRole("listitem", { name: categoryName })
    await expect(row).not.toContainText("adjusted")
    await expect(row).toContainText(/500\s?€/)

    await expect(page.getByRole("menu")).toHaveCount(0)
    const oneOffRow = page.getByRole("listitem", { name: oneOffName })
    await expect(oneOffRow).toContainText(/220\s?€/)
    await oneOffRow.click()
    const oneOffPeek = page.getByRole("complementary", { name: oneOffName })
    await expect(oneOffPeek.getByText(`Only ${monthName(localMonth())}`)).toBeVisible()
    await oneOffPeek.getByRole("button", { name: "More actions" }).click()
    await page
      .getByRole("menuitem", { name: `Remove ${monthName(localMonth())} budget` })
      .click()
    await expect(page.getByRole("listitem", { name: oneOffName })).toHaveCount(0)
  })

  test("removes a budget after confirming", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Remove Budget ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 15_000,
      starts_on: `${localMonth()}-01`,
    })

    await page.goto("/budgets")
    await page.getByRole("listitem", { name: categoryName }).click()
    const peek = page.getByRole("complementary", { name: categoryName })
    await peek.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Remove budget" }).click()
    const confirm = page.getByRole("dialog", {
      name: `Remove the ${categoryName} budget?`,
    })
    await confirm.getByRole("button", { name: "Remove" }).click()
    await expect(page.getByRole("listitem", { name: categoryName })).toHaveCount(0)
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

  test("does not assign a pace before a future budget month starts", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Future Budget ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 50_000,
      starts_on: "2099-12-01",
    })

    await page.goto("/budgets?month=2099-12")
    await expect(page.getByRole("listitem", { name: categoryName })).toBeVisible()
    await expect(page.getByText("Pacing starts in December 2099")).toBeVisible()
    await expect(page.getByText(/Over pace|On pace|On track/)).toHaveCount(0)
  })

  test("lists ended and future budgets on request", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Ended Budget ${Date.now()}`
    const categoryId = await createCategory(request, token, "expense", categoryName)
    await createTemplate(request, token, {
      frequency: "monthly",
      category_id: categoryId,
      amount_cents: 12_000,
      starts_on: `${localMonth(-6)}-01`,
      ends_on: `${localMonth(-3)}-28`,
    })

    await page.goto("/budgets")
    await expect(page.getByRole("listitem", { name: categoryName })).toHaveCount(0)
    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitemcheckbox", { name: /Show ended and future budgets/ }).click()
    await expect(page.getByRole("menu")).toBeHidden()
    await expect(page.getByText("Ended and future", { exact: true })).toBeVisible()
    await expect(page.getByRole("listitem", { name: categoryName })).toContainText(
      /120\s?€ per month/,
    )
  })

  test("shows pace details, top spending days and the overall pace table", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
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
  })
})
