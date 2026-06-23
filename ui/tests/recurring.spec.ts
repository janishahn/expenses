import { test, expect } from "@playwright/test"
import { ensureCategory, getCsrfToken } from "./helpers"

test.describe("Recurring Rules Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/recurring")
  })

  test("should keep the inline editor as the desktop creation entry", async ({
    page,
  }) => {
    await expect(page.getByRole("button", { name: "Add rule" })).toBeHidden()
    await expect(page.getByText("Editor")).toBeVisible()
    const editorPosition = await page
      .locator("form", { has: page.getByRole("button", { name: "Save rule" }) })
      .evaluate((node) => getComputedStyle(node).position)
    expect(editorPosition).toBe("sticky")
  })

  test("should show stats section when rules exist", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Stats")
    const ruleName = `E2E Stats ${Date.now()}`
    const createResponse = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: ruleName,
        type: "expense",
        amount_cents: 100,
        currency_code: "EUR",
        category_id: categoryId,
        anchor_date: new Date().toISOString().slice(0, 10),
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: new Date().toISOString().slice(0, 10),
        end_date: null,
        auto_post: false,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(createResponse.ok()).toBeTruthy()

    const rulesResponse = await request.get("/api/recurring")
    expect(rulesResponse.ok()).toBeTruthy()
    const rulesPayload = (await rulesResponse.json()) as {
      rules: Array<{ name: string | null }>
    }
    expect(rulesPayload.rules.some((rule) => rule.name === ruleName)).toBeTruthy()

    await page.reload()
    await expect(page.locator("body")).toContainText(ruleName)
    await expect(page.getByText("Monthly expenses", { exact: true })).toBeVisible()
    await expect(page.getByText("Coverage ratio", { exact: true })).toBeVisible()
  })

  test("should toggle auto_post via switch in editor form", async ({ page }) => {
    const editorToggle = page
      .locator("div", { hasText: "Post automatically" })
      .getByRole("switch")
      .first()
    await expect(editorToggle).toBeVisible()

    const initial = await editorToggle.getAttribute("aria-checked")
    await editorToggle.click()
    await expect(editorToggle).toHaveAttribute(
      "aria-checked",
      initial === "true" ? "false" : "true"
    )
  })

  test("should create and open history for a recurring rule", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Recurring")
    const ruleName = `E2E Recurring ${Date.now()}`
    const today = new Date().toISOString().slice(0, 10)

    await page.getByLabel("Name").fill(ruleName)
    await page.locator('label:has-text("Amount") input').fill("42.00")
    await page.getByLabel("Category").selectOption(String(categoryId))
    await page.getByLabel("Start date").fill(today)
    await page.getByRole("button", { name: "Save rule" }).click()

    await expect(page.locator("body")).toContainText(ruleName)
    const ruleCard = page.locator("div.surface-card", { hasText: ruleName }).first()
    const deleteButton = ruleCard.getByRole("button", { name: "Delete" }).first()
    await expect(deleteButton).toHaveClass(
      /btn-inline-danger/
    )
    await expect(deleteButton.locator("svg")).toBeVisible()
    const rulesResponse = await request.get("/api/recurring")
    expect(rulesResponse.ok()).toBeTruthy()
    const rulesPayload = (await rulesResponse.json()) as {
      rules: Array<{ id: number; name: string | null }>
    }
    const created = rulesPayload.rules.find((rule) => rule.name === ruleName)
    expect(created).toBeTruthy()

    await page.goto(`/recurring/${created!.id}/occurrences`)
    await expect(page.locator("main h1")).toContainText(ruleName)
  })

  test("should require confirmation before deleting a recurring rule", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Delete")
    const ruleName = `E2E Delete ${Date.now()}`
    const today = new Date().toISOString().slice(0, 10)

    const createResponse = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: ruleName,
        type: "expense",
        currency_code: "EUR",
        amount_cents: 4200,
        category_id: categoryId,
        anchor_date: today,
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: today,
        end_date: null,
        auto_post: true,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(createResponse.ok()).toBeTruthy()

    await page.reload()
    const rulesPanel = page.locator("div.surface-card").filter({
      has: page.getByRole("heading", { name: "Rules" }),
    })
    const row = rulesPanel.locator("div.divide-y > div").filter({ hasText: ruleName }).first()
    const deleteButton = row.getByRole("button", { name: "Delete" }).first()
    await row.scrollIntoViewIfNeeded()

    let firstMessage = ""
    page.once("dialog", async (dialog) => {
      firstMessage = dialog.message()
      await dialog.dismiss()
    })
    await deleteButton.click()
    await expect.poll(() => firstMessage).toContain(
      `Delete recurring rule "${ruleName}"?`
    )
    await expect(row).toContainText(ruleName)

    page.once("dialog", async (dialog) => {
      await dialog.accept()
    })
    await deleteButton.click()
    await expect(page.locator("body")).not.toContainText(ruleName)
  })

  test("should cancel a rule from audit evaluate flow", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Cancel")
    const ruleName = `E2E Cancel ${Date.now()}`
    const today = new Date().toISOString().slice(0, 10)

    const createResponse = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: ruleName,
        type: "expense",
        currency_code: "EUR",
        amount_cents: 999,
        category_id: categoryId,
        anchor_date: today,
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: today,
        end_date: null,
        auto_post: true,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(createResponse.ok()).toBeTruthy()

    await page.goto("/recurring?view=audit")
    await expect(page.locator("body")).toContainText(ruleName)

    const row = page.locator("tr", { hasText: ruleName }).first()
    await row.getByRole("button", { name: "Evaluate" }).click()
    await expect(page.locator("body")).toContainText(
      new RegExp(`Canceling ${ruleName} saves you`)
    )

    await page.getByRole("button", { name: "I canceled it" }).click()
    await expect(page.locator("body")).not.toContainText(ruleName)
  })

  test("should show audit view with evaluate flow", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Audit")
    const ruleName = `E2E Audit ${Date.now()}`
    const today = new Date().toISOString().slice(0, 10)

    const createResponse = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: ruleName,
        type: "expense",
        currency_code: "EUR",
        amount_cents: 1399,
        category_id: categoryId,
        anchor_date: today,
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: today,
        end_date: null,
        auto_post: true,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(createResponse.ok()).toBeTruthy()

    await page.goto("/recurring?view=audit")
    await expect(page.getByText("Subscription Audit")).toBeVisible()
    await expect(page.locator("body")).toContainText(ruleName)

    const row = page.locator("tr", { hasText: ruleName }).first()
    await row.getByRole("button", { name: "Evaluate" }).click()
    await expect(page.locator("body")).toContainText(
      new RegExp(`Canceling ${ruleName} saves you`)
    )
    await page.getByRole("button", { name: "Keep it" }).click()
  })
})
