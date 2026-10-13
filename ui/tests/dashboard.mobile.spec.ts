import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createCategory, createTransaction, loginAsIsolatedUser } from "./helpers"

test.describe.configure({ mode: "parallel" })

// Explicit lookup keyed on the month number of a YYYY-MM key so expected
// labels never depend on the timezone of the process computing them.
const SHORT_MONTHS: Record<string, string> = {
  "01": "Jan",
  "02": "Feb",
  "03": "Mar",
  "04": "Apr",
  "05": "May",
  "06": "Jun",
  "07": "Jul",
  "08": "Aug",
  "09": "Sep",
  "10": "Oct",
  "11": "Nov",
  "12": "Dec",
}

function monthKey(offsetMonths: number): string {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`
}

function localToday(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-")
}

// Amounts group thousands with a narrow space, so tests write them with a dot.
function eur(text: string): RegExp {
  return new RegExp(text.replace("+", "\\+").replace(/\./g, "[\\s.]").replace(/ /g, "\\s"))
}

// The label text of a figure in the summary card, with its value and detail beneath.
function metric(page: Page, label: string) {
  return page.getByText(label, { exact: true }).first().locator("..")
}

async function showAsTable(page: Page, cardName: string) {
  const card = page.getByRole("region", { name: cardName })
  await card.getByRole("button", { name: "Chart options" }).tap()
  await page.getByRole("menuitemcheckbox", { name: "Show as table" }).tap()
  await expect(page.getByRole("menu")).toHaveCount(0)
  return card
}

async function expectNoHorizontalOverflow(page: Page) {
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth)
}

test.describe("Dashboard Page (mobile)", () => {
  test("shows balance, cash in, spent and net for the period and follows period changes", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const lastMonth = monthKey(-1)
    const salary = await createCategory(isolated.request, isolated.csrfToken, "income", "Salary")
    const rent = await createCategory(isolated.request, isolated.csrfToken, "expense", "Rent")
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${lastMonth}-10`,
      occurred_at: `${lastMonth}-10T09:00:00`,
      type: "income",
      amount_cents: 200_000,
      category_id: salary,
      title: "Salary payment",
      tags: [],
    })
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${lastMonth}-12`,
      occurred_at: `${lastMonth}-12T09:00:00`,
      type: "expense",
      amount_cents: 50_000,
      category_id: rent,
      title: "Rent payment",
      tags: [],
    })
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: `${monthKey(0)}-01`,
      occurred_at: `${monthKey(0)}-01T09:00:00`,
      type: "expense",
      amount_cents: 12_000,
      category_id: rent,
      title: "Groceries",
      tags: [],
    })
    await isolated.request.dispose()

    await page.goto("/?period=last_month")
    await expect(metric(page, "Cash in")).toContainText(eur("2.000,00 €"))
    await expect(metric(page, "Spent")).toContainText(eur("500,00 €"))
    await expect(metric(page, "Net")).toContainText(eur("+ 1.500,00 €"))
    await expect(metric(page, "Balance")).toContainText(eur("1.500,00 €"))

    await page.getByRole("button", { name: /^Period:/ }).tap()
    await page.getByRole("menuitemcheckbox", { name: "This month" }).tap()
    await expect(page).toHaveURL(/period=this_month/)
    await expect(metric(page, "Spent")).toContainText(eur("120,00 €"))
    await expect(metric(page, "Spent")).toContainText("vs previous")
    await expect(metric(page, "Balance")).toContainText(eur("1.380,00 €"))
    await expectNoHorizontalOverflow(page)
  })

  test("includes or excludes tags from the metrics in the Filter sheet", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const category = await createCategory(isolated.request, isolated.csrfToken, "expense", "Misc")
    const tagResponse = await isolated.request.post("/api/tags", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name: "Trip", is_hidden_from_budget: false },
    })
    expect(tagResponse.ok()).toBeTruthy()
    const tagId = ((await tagResponse.json()) as { id: number }).id
    for (const [title, cents, tags] of [
      ["Hotel", 9_000, ["Trip"]],
      ["Lunch", 3_000, []],
    ] as const) {
      await createTransaction(isolated.request, isolated.csrfToken, {
        date: today,
        occurred_at: `${today}T10:00:00`,
        type: "expense",
        amount_cents: cents,
        category_id: category,
        title,
        tags: [...tags],
      })
    }
    await isolated.request.dispose()

    await page.goto("/?period=this_month")
    await expect(metric(page, "Spent")).toContainText(eur("120,00 €"))

    await page.getByRole("button", { name: "Filter", exact: true }).tap()
    const sheet = page.getByRole("dialog", { name: "Filter" })
    await sheet.getByRole("checkbox", { name: "Trip" }).click()
    await expect(page).toHaveURL(new RegExp(`[?&]tags=${tagId}(?:&|$)`))
    await expect(metric(page, "Spent")).toContainText(eur("90,00 €"))

    await sheet.getByRole("radio", { name: "Exclude" }).tap()
    await expect(page).toHaveURL(new RegExp(`[?&]exclude_tags=${tagId}(?:&|$)`))
    await expect(page).not.toHaveURL(/[?&]tags=/)
    await expect(metric(page, "Spent")).toContainText(eur("30,00 €"))
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect(page.getByRole("button", { name: "Filter · 1" })).toBeVisible()
  })

  test("hides amounts in privacy mode, restores them, and remembers the choice after a reload", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const category = await createCategory(isolated.request, isolated.csrfToken, "expense", "Misc")
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T10:00:00`,
      type: "expense",
      amount_cents: 4_321,
      category_id: category,
      title: "Private purchase",
      tags: [],
    })
    await isolated.request.dispose()

    await page.goto("/?period=this_month")
    const recent = page.getByRole("region", { name: "Recent" })
    await expect(metric(page, "Spent")).toContainText(eur("43,21 €"))
    await expect(recent).toContainText(eur("43,21 €"))

    await page.getByRole("button", { name: "Hide amounts" }).tap()
    await expect(metric(page, "Spent")).toContainText("Hidden amount")
    await expect(recent.getByRole("listitem", { name: "Private purchase" })).toContainText("Hidden amount")

    await page.reload()
    await expect(page.getByRole("button", { name: "Show amounts" })).toBeVisible()
    await expect(metric(page, "Spent")).toContainText("Hidden amount")

    await page.getByRole("button", { name: "Show amounts" }).tap()
    await expect(metric(page, "Spent")).toContainText(eur("43,21 €"))
    await expect(page.getByRole("button", { name: "Hide amounts" })).toBeVisible()
  })

  test("lists the exact balance, spending and category share values as tables", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const salary = await createCategory(isolated.request, isolated.csrfToken, "income", "Salary")
    const rent = await createCategory(isolated.request, isolated.csrfToken, "expense", "Rent")
    // Early times keep both inside the balance history, which ends at the current time.
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T00:00:01`,
      type: "income",
      amount_cents: 123_456,
      category_id: salary,
      title: "Bonus",
      tags: [],
    })
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T00:00:02`,
      type: "expense",
      amount_cents: 23_456,
      category_id: rent,
      title: "Deposit",
      tags: [],
    })
    await isolated.request.dispose()

    await page.goto("/?period=this_month")

    const balance = await showAsTable(page, "Balance")
    await expect(
      balance.getByRole("table", { name: "Balance by month" }).getByRole("row", { name: /^Today/ }),
    ).toContainText(eur("1.000,00 €"))

    const spending = await showAsTable(page, "Spending by category")
    const spendingTable = spending.getByRole("table", { name: "Spending by category and month" })
    const currentMonth = `${SHORT_MONTHS[monthKey(0).slice(5)]} ${monthKey(0).slice(0, 4)}`
    await expect(spendingTable.getByRole("row", { name: new RegExp(`^${currentMonth}`) })).toContainText(
      eur("234,56 €"),
    )

    const share = await showAsTable(page, "Category share")
    const shareTable = share.getByRole("table", { name: "Category share" })
    await expect(shareTable.getByRole("row", { name: /^Rent/ })).toContainText(eur("234,56 €"))
    await expect(shareTable.getByRole("row", { name: /^Rent/ })).toContainText("100 %")
    await share.getByRole("radio", { name: "Income" }).tap()
    await expect(shareTable.getByRole("row", { name: /^Salary/ })).toContainText(eur("1.234,56 €"))
    await expectNoHorizontalOverflow(page)
  })

  test("hides a chart card from the dashboard and brings it back from the header menu", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    await isolated.request.dispose()
    await page.goto("/")

    const share = page.getByRole("region", { name: "Category share" })
    await share.getByRole("button", { name: "Chart options" }).tap()
    await page.getByRole("menuitem", { name: "Hide from dashboard" }).tap()
    await expect(share).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole("region", { name: "Spending by category" })).toBeVisible()
    await expect(share).toHaveCount(0)

    await page.getByRole("button", { name: "More actions" }).tap()
    await page.getByRole("menuitem", { name: "Show hidden cards (1)" }).tap()
    await expect(share).toBeVisible()
  })

  test("opens the transaction ledger when a spending band segment is tapped and returns with the breadcrumb", async ({
    page,
  }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const category = await createCategory(isolated.request, isolated.csrfToken, "expense", "Groceries")
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T10:00:00`,
      type: "expense",
      amount_cents: 7_500,
      category_id: category,
      title: "Weekly shop",
      tags: [],
    })
    await isolated.request.dispose()

    await page.goto("/?period=this_month")
    const spending = page.getByRole("region", { name: "Spending by category" })
    await spending.locator('[class*="_track_"] > span').first().tap()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*category=${category}.*from=dashboard`))
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" })
    await expect(breadcrumb).toContainText("Dashboard")
    await expect(breadcrumb).toContainText("Groceries")
    await expect(page.getByRole("listitem", { name: "Weekly shop" })).toBeVisible()

    await breadcrumb.getByRole("link", { name: "Dashboard" }).tap()
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible()
  })

  test("lists the seven newest transactions in Recent and opens one from a tap", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const category = await createCategory(isolated.request, isolated.csrfToken, "expense", "Misc")
    const ids: number[] = []
    for (let index = 1; index <= 8; index += 1) {
      ids.push(
        await createTransaction(isolated.request, isolated.csrfToken, {
          date: today,
          occurred_at: `${today}T0${index}:00:00`,
          type: "expense",
          amount_cents: index * 1_000,
          category_id: category,
          title: `Recent item ${index}`,
          tags: [],
        }),
      )
    }
    await isolated.request.dispose()

    await page.goto("/")
    const recent = page.getByRole("region", { name: "Recent" })
    await expect(recent.getByRole("listitem")).toHaveCount(7)
    await expect(recent.getByRole("listitem", { name: "Recent item 8" })).toBeVisible()
    await expect(recent.getByRole("listitem", { name: "Recent item 1" })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    await recent.getByRole("listitem", { name: "Recent item 5" }).tap()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*peek=${ids[4]}`))
    await expect(page.getByRole("complementary", { name: "Recent item 5" })).toBeVisible()
  })

  test("shows the overall budget in the summary and category budgets as left or over", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const monthStart = `${monthKey(0)}-01`
    const dining = await createCategory(isolated.request, isolated.csrfToken, "expense", "Dining out")
    const hobbies = await createCategory(isolated.request, isolated.csrfToken, "expense", "Hobbies")
    for (const [categoryId, amount] of [
      [null, 200_000],
      [dining, 10_000],
      [hobbies, 20_000],
    ] as const) {
      const response = await isolated.request.post("/api/budgets/templates", {
        headers: { "X-CSRF-Token": isolated.csrfToken },
        data: {
          frequency: "monthly",
          category_id: categoryId,
          amount_cents: amount,
          starts_on: monthStart,
          ends_on: null,
        },
      })
      expect(response.ok()).toBeTruthy()
    }
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T09:00:00`,
      type: "expense",
      amount_cents: 12_000,
      category_id: dining,
      title: "Dinner",
      tags: [],
    })
    await isolated.request.dispose()

    await page.goto("/?period=this_month")
    const overall = page.getByRole("group", { name: "Overall budget" })
    await expect(overall).toContainText(eur("120 € of 2.000 €"))
    await expect(overall).toContainText(eur("1.880 € left"))

    const budgets = page.getByRole("region", { name: "Budgets" })
    await expect(budgets.getByRole("listitem", { name: "Dining out" })).toContainText("20 € over")
    await expect(budgets.getByRole("listitem", { name: "Hobbies" })).toContainText("200 € left")
    await expectNoHorizontalOverflow(page)

    await budgets.getByRole("button", { name: "Open budgets" }).tap()
    await expect(page).toHaveURL(/\/budgets/)
  })

  test("lists a durable purchase with its days owned and opens its transaction", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const category = await createCategory(isolated.request, isolated.csrfToken, "expense", "Electronics")
    const title = "Noise-cancelling headphones"
    const transactionId = await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T09:00:00`,
      type: "expense",
      amount_cents: 120_000,
      category_id: category,
      title,
      tags: [],
    })
    const durable = await isolated.request.post(`/api/transactions/${transactionId}/durable`, {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { expected_lifespan_days: 730, acquired_on: today },
    })
    expect(durable.ok()).toBeTruthy()
    await isolated.request.dispose()

    await page.goto("/")
    const row = page.getByRole("region", { name: "Durable purchases" }).getByRole("listitem", { name: title })
    await expect(row).toContainText("0 of 730 days")

    await row.tap()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
  })

  test("keeps long titles and very large amounts inside the viewport", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    const today = localToday()
    const salary = await createCategory(isolated.request, isolated.csrfToken, "income", "Salary")
    const purchase = await createCategory(isolated.request, isolated.csrfToken, "expense", "Large purchase")
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T08:00:00`,
      type: "income",
      amount_cents: 610_000,
      category_id: salary,
      title: "Salary payment",
      tags: [],
    })
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T09:00:00`,
      type: "expense",
      amount_cents: 1_000_793_493,
      category_id: purchase,
      title:
        "This is a very long mobile transaction title with SupercalifragilisticexpialidociousStyleSegmentsThatShouldNeverStretchTheViewport",
      tags: [],
    })
    // A small overall budget makes the projected pace figures extreme too.
    const budget = await isolated.request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: {
        frequency: "monthly",
        category_id: null,
        amount_cents: 200_000,
        starts_on: `${monthKey(0)}-01`,
        ends_on: null,
      },
    })
    expect(budget.ok()).toBeTruthy()
    await isolated.request.dispose()

    await page.goto("/")
    await expect(metric(page, "Spent")).toContainText(eur("10.007.934,93 €"))
    await expectNoHorizontalOverflow(page)
  })

  test("shows empty states when there is nothing to chart", async ({ page }) => {
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    await isolated.request.dispose()

    await page.goto("/")
    await expect(page.getByRole("region", { name: "Spending by category" })).toContainText(
      "No spending in these months.",
    )
    await expect(page.getByRole("region", { name: "Category share" })).toContainText(
      "No spending in this period.",
    )
    await expect(page.getByRole("region", { name: "Recent" })).toContainText(
      "No transactions in this period",
    )
    await expect(page.getByRole("region", { name: "Budgets" })).toContainText(
      "No category budgets this month",
    )
    await expect(page.getByRole("region", { name: "Durable purchases" })).toContainText(
      "No durable purchases are being tracked",
    )
    await expectNoHorizontalOverflow(page)
  })
})
