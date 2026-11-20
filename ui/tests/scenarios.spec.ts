import type { APIRequestContext, Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createCategory, ensureCategory, getCsrfToken } from "./helpers"

function nextMonthDate(): Date {
  const value = new Date()
  value.setDate(1)
  value.setMonth(value.getMonth() + 1)
  return value
}

function monthValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function monthShort(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date)
}

async function createRule(
  request: APIRequestContext,
  type: "income" | "expense",
  name: string,
  amountCents: number,
  currency: "EUR" | "USD" = "EUR",
): Promise<void> {
  const token = await getCsrfToken(request)
  const categoryId = await ensureCategory(request, token, type, `E2E Scn ${type}`)
  const start = `${monthValue(nextMonthDate())}-01`
  const response = await request.post("/api/recurring", {
    headers: { "X-CSRF-Token": token },
    data: {
      name,
      type,
      currency_code: currency,
      amount_cents: amountCents,
      category_id: categoryId,
      anchor_date: start,
      interval_unit: "month",
      interval_count: 1,
      next_occurrence: start,
      end_date: null,
      auto_post: true,
      skip_weekends: false,
      month_day_policy: "snap_to_end",
    },
  })
  expect(response.ok()).toBeTruthy()
}

function adjustments(page: Page): Locator {
  return page.getByRole("region", { name: "Adjustments" })
}

async function openAdjustmentForm(page: Page, kind: string): Promise<Locator> {
  await expect(page.getByRole("menu")).toHaveCount(0)
  await adjustments(page).getByRole("button", { name: "Add", exact: true }).click()
  await page.getByRole("menuitem", { name: kind }).click()
  const form = adjustments(page).locator("form")
  await expect(form).toBeVisible()
  // The opened form takes focus from the Add menu.
  await expect(form.getByLabel("Adjustment")).toBeFocused()
  return form
}

function submit(form: Locator): Promise<void> {
  return form.getByRole("button", { name: "Add", exact: true }).click()
}

async function selectRule(form: Locator, ruleName: string): Promise<void> {
  const value = await form
    .getByLabel("Rule")
    .locator("option", { hasText: ruleName })
    .getAttribute("value")
  await form.getByLabel("Rule").selectOption(value!)
}

async function addOneTime(page: Page, name: string, amount: string): Promise<void> {
  const form = await openAdjustmentForm(page, "One-time event")
  await form.getByLabel("Name").fill(name)
  await form.getByLabel("Amount").fill(amount)
  await submit(form)
}

function removeButtons(page: Page): Locator {
  return adjustments(page).getByRole("button", { name: "Remove adjustment" })
}

test.describe("Scenarios Page", () => {
  test("validates incomplete adjustment input for every adjustment kind", async ({ page }) => {
    await page.goto("/scenarios")
    const messages: Array<[string, string]> = [
      ["Remove a recurring rule", "Select a rule to remove."],
      ["Add a recurring rule", "Enter a valid name and amount."],
      ["Change a recurring rule", "Select a rule, month, and valid amount."],
      ["One-time event", "Enter a valid name, month, and amount."],
      ["Category estimate", "Select a category and valid monthly estimate."],
    ]
    for (const [kind, message] of messages) {
      const form = await openAdjustmentForm(page, kind)
      await submit(form)
      await expect(form).toContainText(message)
      await form.getByRole("button", { name: "Cancel" }).click()
      await expect(adjustments(page).locator("form")).toHaveCount(0)
    }
    await expect(adjustments(page).getByText("No adjustments")).toBeVisible()
  })

  test("adds a one-time event and shows the comparison chart, strip and impact list", async ({
    page,
  }) => {
    await page.goto("/scenarios")
    await expect(page.getByText("No changes")).toBeVisible()
    await addOneTime(page, "Vacation", "300.00")

    const month = monthShort(nextMonthDate())
    await expect(adjustments(page).getByRole("listitem")).toContainText(`Vacation in ${month}`)
    await expect(page.getByText(/^Baseline in /)).toBeVisible()
    await expect(page.getByText(/^Scenario in /)).toBeVisible()
    await expect(page.getByText("after 1 adjustment")).toBeVisible()
    await expect(page.getByText("No changes")).toHaveCount(0)

    const chart = page.getByRole("region", { name: "Balance" })
    await expect(chart.getByText("Scenario", { exact: true })).toBeVisible()
    await expect(chart.getByText("Baseline", { exact: true })).toBeVisible()
    await expect(chart.getByText("Difference", { exact: true })).toBeVisible()
    await chart.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
    const table = chart.getByRole("table", { name: "Scenario and baseline balance by month" })
    await expect(table.getByRole("columnheader")).toHaveText([
      "Month",
      "Scenario",
      "Baseline",
      "Difference",
    ])
    await expect(
      table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: month }) }),
    ).toContainText(/300,00\s?€/)
    await expect(
      table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Now" }) }),
    ).toContainText(/0,00\s?€/)

    const impact = page.getByRole("list", { name: "Impact by adjustment" })
    await expect(impact.getByRole("listitem")).toHaveCount(1)
    await expect(impact).toContainText(`Vacation in ${month}`)
    await expect(impact).toContainText(/300\s?€/)
  })

  test("adds a recurring rule adjustment", async ({ page }) => {
    await page.goto("/scenarios")
    const form = await openAdjustmentForm(page, "Add a recurring rule")
    await form.getByLabel("Name").fill("New gym")
    await form.getByLabel("Repeats").selectOption("weekly")
    await form.getByLabel("Amount").fill("12")
    await submit(form)
    await expect(adjustments(page).getByRole("listitem")).toContainText(
      /New gym at 12\s?€ per week/,
    )
    await expect(page.getByText("after 1 adjustment")).toBeVisible()
  })

  test("adds a remove-rule adjustment for an existing recurring rule", async ({
    page,
    request,
  }) => {
    const ruleName = `E2E Scenario Salary ${Date.now()}`
    await createRule(request, "income", ruleName, 200_000)

    await page.goto("/scenarios")
    const form = await openAdjustmentForm(page, "Remove a recurring rule")
    await selectRule(form, ruleName)
    await submit(form)
    await expect(adjustments(page).getByRole("listitem")).toContainText(`Cancel ${ruleName}`)
    await expect(
      page.getByRole("list", { name: "Impact by adjustment" }),
    ).toContainText(`Cancel ${ruleName}`)
    await expect(page.getByText("after 1 adjustment")).toBeVisible()
  })

  test("adds a change-rule adjustment from a chosen month", async ({ page, request }) => {
    const ruleName = `E2E Scenario Rent ${Date.now()}`
    await createRule(request, "expense", ruleName, 80_000)

    await page.goto("/scenarios")
    const form = await openAdjustmentForm(page, "Change a recurring rule")
    await selectRule(form, ruleName)
    await form.getByLabel("New amount").fill("950")
    await submit(form)
    await expect(adjustments(page).getByRole("listitem")).toContainText(
      new RegExp(`${ruleName} 950\\s?€ from ${monthShort(nextMonthDate())}`),
    )
    await expect(
      page.getByRole("list", { name: "Impact by adjustment" }),
    ).toContainText(ruleName)
  })

  test("shows and changes a dollar rule in dollars", async ({ page, request }) => {
    const ruleName = `E2E Scenario Hosting ${Date.now()}`
    await createRule(request, "expense", ruleName, 5_000, "USD")

    await page.goto("/scenarios")
    const form = await openAdjustmentForm(page, "Change a recurring rule")
    await expect(form.getByLabel("Rule").locator("option", { hasText: ruleName })).toHaveText(
      new RegExp(`${ruleName} \\(50,00\\s?\\$\\)`),
    )
    await selectRule(form, ruleName)
    const amount = form.getByLabel("New amount")
    await expect(amount.locator("xpath=following-sibling::span")).toHaveText("$")
    await amount.fill("60,00 €")
    await submit(form)
    await expect(form).toContainText("Enter the amount in USD.")
    await expect(adjustments(page).getByRole("listitem")).toHaveCount(0)

    await amount.fill("60")
    const calculated = page.waitForResponse(
      (response) => response.url().includes("/api/forecast/scenario") && response.request().method() === "POST",
    )
    await submit(form)
    expect((await calculated).ok()).toBeTruthy()
    await expect(adjustments(page).getByRole("listitem")).toContainText(
      new RegExp(`${ruleName} 60\\s?\\$ from`),
    )
    await expect(page.getByRole("list", { name: "Impact by adjustment" })).toContainText(ruleName)
  })

  test("rejects an amount with a thousands dot", async ({ page }) => {
    await page.goto("/scenarios")
    const form = await openAdjustmentForm(page, "One-time event")
    await form.getByLabel("Name").fill("Dotted amount")
    await form.getByLabel("Amount").fill("1.234")
    await submit(form)
    await expect(form).toContainText("Enter a valid name, month, and amount.")
    await expect(adjustments(page).getByRole("listitem")).toHaveCount(0)
  })

  test("adds a category estimate adjustment", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryName = `E2E Scenario Groceries ${Date.now()}`
    await createCategory(request, token, "expense", categoryName)

    await page.goto("/scenarios")
    const form = await openAdjustmentForm(page, "Category estimate")
    await form.getByLabel("Category").selectOption({ label: categoryName })
    await form.getByLabel("Per month").fill("80")
    await submit(form)
    await expect(adjustments(page).getByRole("listitem")).toContainText(
      new RegExp(`${categoryName} at 80\\s?€ per month`),
    )
  })

  test("totals several adjustments in the impact list", async ({ page }) => {
    await page.goto("/scenarios")
    await addOneTime(page, "First event", "100")
    await addOneTime(page, "Second event", "50")

    await expect(page.getByText("after 2 adjustments")).toBeVisible()
    await expect(adjustments(page).getByRole("listitem")).toHaveCount(2)
    const impact = page.getByRole("list", { name: "Impact by adjustment" })
    await expect(impact.getByRole("listitem")).toHaveCount(3)
    const total = impact.getByRole("listitem").last()
    await expect(total).toContainText("Total")
    await expect(total).toContainText(/150\s?€/)
  })

  test("returns to the baseline after removing the last adjustment", async ({ page }) => {
    await page.goto("/scenarios")
    await addOneTime(page, "Scenario delete event", "80.00")
    await expect(page.getByRole("list", { name: "Impact by adjustment" })).toBeVisible()
    await expect(page.getByText("after 1 adjustment")).toBeVisible()

    await removeButtons(page).click()

    await expect(adjustments(page).getByText("No adjustments")).toBeVisible()
    await expect(page.getByText("No changes")).toBeVisible()
    await expect(page.getByText("no adjustments", { exact: true })).toBeVisible()
    await expect(page.getByRole("list", { name: "Impact by adjustment" })).toHaveCount(0)
    const chart = page.getByRole("region", { name: "Balance" })
    await expect(chart.getByText("Difference", { exact: true })).toHaveCount(0)
    await chart.getByRole("button", { name: "Chart options" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).click()
    await expect(
      chart.getByRole("table", { name: "Scenario and baseline balance by month" }).getByRole("columnheader"),
    ).toHaveText(["Month", "Baseline"])
  })

  test("clears every adjustment from the more actions menu", async ({ page }) => {
    await page.goto("/scenarios")
    await page.getByRole("button", { name: "More actions" }).click()
    await expect(page.getByRole("menuitem", { name: "Clear all adjustments" })).toBeDisabled()
    await page.keyboard.press("Escape")

    await addOneTime(page, "Clear event one", "20")
    await addOneTime(page, "Clear event two", "30")
    await expect(removeButtons(page)).toHaveCount(2)

    await expect(page.getByRole("menu")).toHaveCount(0)
    await page.getByRole("button", { name: "More actions" }).click()
    await page.getByRole("menuitem", { name: "Clear all adjustments" }).click()
    await expect(adjustments(page).getByText("No adjustments")).toBeVisible()
    await expect(page.getByText("No changes")).toBeVisible()
  })

  test("reads the horizon and model from the URL and keeps adjustments when they change", async ({
    page,
  }) => {
    await page.goto("/scenarios?horizon=3&mode=recurring")
    await expect(page.getByRole("radiogroup", { name: "Scenario horizon" }).getByRole("radio", { name: "3 months" })).toBeChecked()
    await expect(page.getByRole("radiogroup", { name: "Scenario model" }).getByRole("radio", { name: "Recurring only" })).toBeChecked()

    await addOneTime(page, "Horizon event", "40")
    await expect(page.getByText("over 3 months")).toBeVisible()
    await page.getByRole("radio", { name: "12 months" }).click()
    await expect(page).toHaveURL(/horizon=12/)
    await expect(page).toHaveURL(/mode=recurring/)
    await expect(page.getByText("over 12 months")).toBeVisible()
    await expect(adjustments(page).getByRole("listitem")).toContainText("Horizon event")
    await expect(page.getByText("after 1 adjustment")).toBeVisible()
  })
})
