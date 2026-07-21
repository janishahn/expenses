import { test, expect } from "./fixtures"

test.describe("Report Builder Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reports/builder")
  })

  test("should show report sections toggles", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Report sections" })).toBeVisible()
  })

  test("should request pdf when generating", async ({ page }) => {
    await page.addInitScript(() => {
      window.open = () => {
        const current = window.location.href
        return {
          location: { href: current },
          close() {},
        } as unknown as Window
      }
    })

    let reportRequestSeen = false
    let payload: Record<string, unknown> | null = null
    await page.route("**/api/reports/pdf", async (route) => {
      reportRequestSeen = true
      payload = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": 'attachment; filename="expense_report_test.pdf"',
        },
        body: "%PDF-1.4\n%%EOF",
      })
    })

    await page.getByRole("button", { name: "Generate PDF Report" }).click()
    await expect.poll(() => reportRequestSeen).toBeTruthy()
    expect(payload).not.toBeNull()
    expect(payload?.sections).toEqual(
      expect.arrayContaining(["summary", "category_breakdown", "recent_transactions"])
    )
    expect(payload?.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload?.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test("forces oldest-first sorting when running balance is enabled", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.open = () => {
        const current = window.location.href
        return {
          location: { href: current },
          close() {},
        } as unknown as Window
      }
    })

    let payload: Record<string, unknown> | null = null
    await page.route("**/api/reports/pdf", async (route) => {
      payload = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": 'attachment; filename="expense_report_test.pdf"',
        },
        body: "%PDF-1.4\n%%EOF",
      })
    })

    const sortSelect = page.getByRole("combobox", { name: "Sort" })
    await sortSelect.selectOption("newest")
    const runningBalance = page
      .locator("label", { hasText: "Show running balance" })
      .getByRole("switch")
    await runningBalance.click()
    await page.getByRole("button", { name: "Generate PDF Report" }).click()

    await expect.poll(() => payload).not.toBeNull()
    expect(payload).not.toBeNull()
    expect(payload?.show_running_balance).toBe(true)
    expect(payload?.transactions_sort).toBe("oldest")
  })

  test("sends selected category and toggle options in pdf request payload", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.open = () => {
        const current = window.location.href
        return {
          location: { href: current },
          close() {},
        } as unknown as Window
      }
    })

    await page.route("**/api/categories", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: 11, name: "Salary", type: "income", archived_at: null },
            { id: 22, name: "Rent", type: "expense", archived_at: null },
            { id: 33, name: "Groceries", type: "expense", archived_at: null },
          ],
        }),
      })
    })

    let payload: Record<string, unknown> | null = null
    await page.route("**/api/reports/pdf", async (route) => {
      payload = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": 'attachment; filename="expense_report_test.pdf"',
        },
        body: "%PDF-1.4\n%%EOF",
      })
    })

    await page.goto("/reports/builder")
    await page.getByRole("radio", { name: "Selected", exact: true }).click()
    await page.getByRole("checkbox", { name: "Rent", exact: true }).click()
    const includeCents = page
      .locator("label", { hasText: "Include cents in tables" })
      .getByRole("switch")
    await includeCents.click()
    await page.getByRole("button", { name: "Generate PDF Report" }).click()

    await expect.poll(() => payload).not.toBeNull()
    expect(payload).not.toBeNull()
    expect(payload?.category_ids).toEqual([22])
    expect(payload?.include_cents).toBe(false)
  })

  test("shows latest generated PDF follow-up state", async ({ page }) => {
    await page.addInitScript(() => {
      window.open = () => {
        const current = window.location.href
        return {
          location: { href: current },
          close() {},
        } as unknown as Window
      }
    })

    await page.route("**/api/reports/pdf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": 'attachment; filename="expense_report_test.pdf"',
        },
        body: "%PDF-1.4\n%%EOF",
      })
    })

    await page.getByRole("button", { name: "Generate PDF Report" }).click()

    await expect(page.getByRole("link", { name: "Download latest PDF" })).toBeVisible()
    await expect(page.getByTestId("report-latest-pdf")).toContainText(
      "expense_report_test.pdf"
    )
  })

  test("should toggle running balance switch", async ({ page }) => {
    const toggle = page
      .locator("label", { hasText: "Show running balance" })
      .getByRole("switch")
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-checked", "false")
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-checked", "true")
  })

  test("should load without errors", async ({ page }) => {
    await expect(page.locator("text=Unable to load")).not.toBeVisible()
  })
})
