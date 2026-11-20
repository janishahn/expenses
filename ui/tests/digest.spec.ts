import type { APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

async function post(request: APIRequestContext, token: string, url: string, data: object) {
  const response = await request.post(url, { headers: { "X-CSRF-Token": token }, data })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as { id: number }
}

async function expense(
  request: APIRequestContext,
  token: string,
  categoryId: number,
  date: string,
  amountCents: number,
  title: string,
) {
  await createTransaction(request, token, {
    date,
    occurred_at: `${date}T12:00:00`,
    type: "expense",
    amount_cents: amountCents,
    category_id: categoryId,
    title,
    tags: [],
  })
}

test.describe("Digest Page", () => {
  test("summarizes spending, budgets and unusual transactions of a week", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const groceries = `E2E Digest Groceries ${stamp}`
    const dining = `E2E Digest Dining ${stamp}`
    const groceriesId = await createCategory(request, token, "expense", groceries)
    const diningId = await createCategory(request, token, "expense", dining)
    const unusualTitle = `Digest big shop ${stamp}`
    // The week is 4-10 March 2019; one earlier groceries purchase sets its usual size.
    await expense(request, token, groceriesId, "2019-02-20", 1_000, `Digest usual ${stamp}`)
    await expense(request, token, groceriesId, "2019-03-05", 5_000, unusualTitle)
    await expense(request, token, diningId, "2019-03-06", 1_200, `Digest dinner ${stamp}`)
    await post(request, token, "/api/budgets/templates", {
      frequency: "monthly",
      category_id: groceriesId,
      amount_cents: 20_000,
      starts_on: "2019-03-01",
      ends_on: null,
    })

    await page.goto("/digest?week_of=2019-03-04")
    const metric = (label: string) => page.getByText(label, { exact: true }).locator("..")
    await expect(metric("Spent")).toContainText(/62,00\s?€/)
    await expect(metric("Spent")).toContainText("2 transactions")
    await expect(metric("vs last week")).toContainText(/\+\s?62,00\s?€/)
    await expect(metric("vs 4-week average")).toContainText(/\+\s?59,50\s?€/)
    await expect(metric("Budgets on pace")).toContainText("1 of 1")

    const week = page.getByRole("region", { name: "Week" })
    await week.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
    const table = week.getByRole("table", { name: "Spending this week by category" })
    await expect(table.getByRole("row", { name: new RegExp(groceries) })).toContainText(/50,00\s?€/)
    await expect(table.getByRole("row", { name: new RegExp(groceries) })).toContainText("81 %")
    await expect(table.getByRole("row", { name: new RegExp(dining) })).toContainText(/12,00\s?€/)

    const top = page.getByRole("list", { name: "Top categories" })
    await expect(top.getByRole("listitem", { name: groceries })).toContainText("avg")
    const budgets = page.getByRole("list", { name: "Budgets" })
    await expect(budgets.getByRole("listitem", { name: groceries })).toContainText(/150\s?€\s*left/)
    const unusual = page.getByRole("list", { name: "Unusual transactions" })
    await expect(unusual.getByRole("listitem", { name: unusualTitle })).toContainText(/50,00\s?€/)
    await expect(page.getByText("Nothing auto-posted this week.")).toBeVisible()
  })
})
