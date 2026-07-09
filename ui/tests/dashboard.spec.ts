import { test, expect } from "@playwright/test"
import {
  createTransaction,
  ensureCategory,
  getCsrfToken,
  mockDashboardApi,
} from "./helpers"

const dashboardKpiLayoutPayload = {
  period: { slug: "this_month", start: "2026-03-01", end: "2026-03-05" },
  filters: { type: null },
  kpis: { income: 2_656_470, expenses: 5_489_509, balance: -2_833_039 },
  sparklines: {
    income: "12,11,10,8,9,10,12,11,10,12",
    expenses: "5,4,5,6,5,8,4,3,7,6,3",
    balance: "9,9,8,7,6,6,5,5,4,4",
  },
  deltas: null,
  donut: {
    has_any_transactions: false,
  },
  recent: [],
  categories: [],
  budget_pace: {
    velocity_ratio: 2.43,
    projected_cents: 607600,
    budget_cents: 250000,
    sparkline: "0.8,0.8,2.6,1.8,1.6,1.5,1.45",
  },
}

test.describe("Dashboard Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
  })

  test("should display KPI cards", async ({ page }) => {
    await page.waitForLoadState("networkidle")
    await expect(page.getByRole("main").locator("text=€").nth(1)).toBeVisible()
  })

  test("defaults the dashboard to this month with a balance hero", async ({ page }) => {
    await mockDashboardApi(page, dashboardKpiLayoutPayload)
    await page.goto("/")

    await expect(page.getByRole("button", { name: "This month" })).toHaveClass(/ptab-active/)
    await expect(page.getByTestId("dashboard-balance-card")).toBeVisible()
    await expect(page.getByTestId("dashboard-secondary-kpi-card")).toHaveCount(2)
  })

  test("should have period navigation", async ({ page }) => {
    const periodText = page.locator("text=/This month|Last month|Custom/i")
    await expect(periodText.first()).toBeVisible()
  })

  test("should load without errors", async ({ page }) => {
    await expect(page.locator("text=Unable to load")).not.toBeVisible()
    await expect(page.getByTestId("app-loading-fallback")).toHaveCount(0, { timeout: 10000 })
  })

  test("should dismiss add transaction dialog on outside click (desktop)", async ({
    page,
  }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Add", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    await page.mouse.click(10, 10)
    await expect(dialog).toBeHidden()
  })

  test("should apply quick-add template in add sheet", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Template")
    const response = await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: `Coffee Template ${Date.now()}`,
        type: "expense",
        category_id: categoryId,
        default_amount_cents: 425,
        title: "Template title",
        tags: ["template"],
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/")
    await page.getByRole("button", { name: "Add", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Manage")).toBeVisible()

    const templateButton = dialog
      .locator("button")
      .filter({ hasText: /Coffee Template/ })
      .first()
    await templateButton.click()

    await expect(dialog.getByLabel("Amount")).toHaveValue("4.25")
    await expect(dialog.getByLabel("Title")).toHaveValue("Template title")
    await expect(
      dialog.getByRole("button", { name: "Remove tag template" })
    ).toBeVisible()
  })

  test("filters the add-sheet tag picker by search", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const marker = Date.now()
    const alphaTag = `alpha-${marker}`
    const betaTag = `beta-${marker}`
    for (const name of [alphaTag, betaTag]) {
      const tagResponse = await request.post("/api/tags", {
        headers: { "X-CSRF-Token": token },
        data: { name, is_hidden_from_budget: false },
      })
      expect(tagResponse.ok()).toBeTruthy()
    }

    await page.goto("/")
    await page.getByRole("button", { name: "Add", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()

    await expect(dialog.getByRole("button", { name: `Add tag ${alphaTag}` })).toBeVisible()
    await expect(dialog.getByRole("button", { name: `Add tag ${betaTag}` })).toBeVisible()

    await dialog.getByPlaceholder("Search tags").fill(alphaTag)
    await expect(dialog.getByRole("button", { name: `Add tag ${alphaTag}` })).toBeVisible()
    await expect(dialog.getByRole("button", { name: `Add tag ${betaTag}` })).toHaveCount(0)
  })

  test("hides archived categories in add sheet category options", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const archivedName = `E2E Archived Add ${Date.now()}`
    const activeName = `E2E Active Add ${Date.now()}`
    const activeResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: activeName,
        type: "expense",
        order: 0,
      },
    })
    expect(activeResponse.ok()).toBeTruthy()

    const archivedResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: archivedName,
        type: "expense",
        order: 1,
      },
    })
    expect(archivedResponse.ok()).toBeTruthy()
    const archivedCategory = (await archivedResponse.json()) as { id: number }
    const archiveResponse = await request.post(
      `/api/categories/${archivedCategory.id}/archive`,
      {
        headers: { "X-CSRF-Token": token },
      }
    )
    expect(archiveResponse.ok()).toBeTruthy()

    await page.goto("/")
    const categoriesResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/categories?period=all") &&
        response.request().method() === "GET" &&
        response.ok()
    )
    await page.getByRole("button", { name: "Add", exact: true }).first().click()
    await categoriesResponse
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()

    const categoryOptions = await dialog
      .getByLabel("Category")
      .locator("option")
      .allTextContents()
    expect(categoryOptions).toContain(activeName)
    expect(categoryOptions).not.toContain(archivedName)
  })

  test("preserves add-sheet field behavior, validation, and templates handoff", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Add Sheet")
    const response = await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: `Handoff Template ${Date.now()}`,
        type: "expense",
        category_id: categoryId,
        default_amount_cents: null,
        title: "Handoff title",
        tags: [],
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/")
    await page.getByRole("button", { name: "Add", exact: true }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()

    await expect(dialog.getByLabel("When")).toBeVisible()
    await expect(dialog.getByLabel("Amount")).toBeVisible()
    await expect(dialog.getByLabel("Category")).toBeVisible()
    await expect(dialog.getByLabel("Title")).toBeVisible()
    await expect(dialog.getByText("Tags", { exact: true })).toBeVisible()
    await expect(dialog.getByText("Templates", { exact: true })).toBeVisible()
    await expect(dialog.getByText("This is a reimbursement")).toHaveCount(0)

    await dialog.getByText("Income", { exact: true }).click()
    await expect(dialog.getByText("This is a reimbursement")).toBeVisible()
    await dialog.getByText("Expense", { exact: true }).click()
    await expect(dialog.getByText("This is a reimbursement")).toHaveCount(0)

    await dialog.getByLabel("Amount").fill("12.34")
    await dialog.getByLabel("Title").fill("   ")
    await dialog.locator("form").evaluate((form) => {
      if (form instanceof HTMLFormElement) {
        form.requestSubmit()
      }
    })
    await expect(dialog.getByText("Title is required")).toBeVisible()

    await dialog.getByRole("button", { name: "Manage", exact: true }).click()
    await expect(page).toHaveURL("/templates")
    await expect(page.getByRole("dialog", { name: "Add transaction" })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("")
  })

  test("should show durable purchases section when data exists", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Durable")
    const title = `E2E Durable ${Date.now()}`
    const txnId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 120_000,
      category_id: categoryId,
      title,
      tags: [],
    })

    const durableResponse = await request.post(`/api/transactions/${txnId}/durable`, {
      headers: { "X-CSRF-Token": token },
      data: {
        expected_lifespan_days: 730,
        acquired_on: new Date().toISOString().slice(0, 10),
      },
    })
    expect(durableResponse.ok()).toBeTruthy()

    await page.goto("/")
    await expect(page.getByText("Durable purchases")).toBeVisible()
    await expect(page.locator("body")).toContainText(title)
  })

  test("should show budget pace inside the balance card when overall budget exists", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const today = new Date().toISOString().slice(0, 10)
    const response = await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "monthly",
        category_id: null,
        amount_cents: 200_000,
        starts_on: `${today.slice(0, 7)}-01`,
        ends_on: null,
      },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto("/")
    const balanceCard = page.getByTestId("dashboard-balance-card")
    await expect(balanceCard.getByText("Budget pace", { exact: true })).toBeVisible()
    await expect(page.getByTestId("dashboard-balance-budget-pace")).toBeVisible()
  })

  test("keeps dashboard-origin detail/edit history coherent and preserves dashboard context", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", `E2E Dashboard Return ${Date.now()}`)
    const title = `E2E Dashboard Return Txn ${Date.now()}`
    const transactionId = await createTransaction(request, token, {
      date: "2026-03-15",
      occurred_at: "2026-03-15T11:45:00",
      type: "expense",
      amount_cents: 4321,
      category_id: categoryId,
      title,
      tags: [],
    })

    await page.addInitScript(() => {
      window.localStorage.setItem("ew.theme.preference", "light")
    })
    const dashboardUrl = "/?period=custom&start=2026-03-01&end=2026-03-31&type=expense"
    await page.goto(dashboardUrl)

    const rowLink = page.getByRole("link", { name: new RegExp(title) }).first()
    await expect(rowLink).toBeVisible()
    await rowLink.click()

    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")

    await page.locator(`a[href="/transactions/${transactionId}/edit"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    await page.locator(`a[href="/transactions/${transactionId}/edit"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/edit$`))

    await page.locator(`a[href="/transactions/${transactionId}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}$`))

    await page.getByRole("link", { name: "← Back" }).click()
    await expect(page).toHaveURL(dashboardUrl)
    await expect(
      page.evaluate(() => document.documentElement.dataset.theme)
    ).resolves.toBe("light")
  })

  test("should filter recent transactions by donut category selection", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const seed = Date.now()
    const focusName = `E2E Focus ${seed}`
    const nonFocusName = `E2E Non Focus ${seed}`
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const pad2 = (value: number) => String(value).padStart(2, "0")
    const dateInCurrentMonth = `${year}-${pad2(month + 1)}-01`
    const toCurrentMonthIso = (minutesAfterMonthStart: number) =>
      `${dateInCurrentMonth}T00:${pad2(minutesAfterMonthStart)}:00`

    const focusCategoryResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: { name: focusName, type: "expense", order: 0 },
    })
    expect(focusCategoryResponse.ok()).toBeTruthy()
    const focusCategory = (await focusCategoryResponse.json()) as { id: number }

    const nonFocusCategoryResponse = await request.post("/api/categories", {
      headers: { "X-CSRF-Token": token },
      data: { name: nonFocusName, type: "expense", order: 1 },
    })
    expect(nonFocusCategoryResponse.ok()).toBeTruthy()
    const nonFocusCategory = (await nonFocusCategoryResponse.json()) as { id: number }

    const focusNote = `E2E Focus Title ${seed}`
    const focusOccurredAt = toCurrentMonthIso(0)
    await createTransaction(request, token, {
      date: dateInCurrentMonth,
      occurred_at: focusOccurredAt,
      type: "expense",
      amount_cents: 1_000_000_000 + (seed % 1_000_000),
      category_id: focusCategory.id,
      title: focusNote,
      tags: [],
    })
    for (let i = 0; i < 11; i += 1) {
      await createTransaction(request, token, {
        date: dateInCurrentMonth,
        occurred_at: toCurrentMonthIso(i + 1),
        type: "expense",
        amount_cents: 10_000 + i,
        category_id: nonFocusCategory.id,
        title: `E2E Non Focus Txn ${seed}-${i}`,
        tags: [],
      })
    }

    await page.goto("/")
    await expect(page.locator("body")).not.toContainText(focusNote)

    const expensesChart = page
      .locator("div.surface-card")
      .filter({ has: page.getByRole("heading", { name: "Expenses" }) })
      .first()
    const focusLegendButton = expensesChart.getByRole("button", {
      name: new RegExp(focusName),
    })
    await expect(focusLegendButton).toBeVisible()
    await focusLegendButton.click()
    await expect(page).toHaveURL(new RegExp(`category=${focusCategory.id}`))
    await expect(page.locator("body")).toContainText(focusNote)

    await focusLegendButton.click()
    await expect(page).not.toHaveURL(/category=/)
  })
})
