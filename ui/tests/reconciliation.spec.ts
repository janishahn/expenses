import { expect, test } from "@playwright/test"

const emptyReconciliation = {
  summary: {
    row_count: 0,
    unresolved_count: 0,
    suggested_count: 0,
    matched_count: 0,
    reviewed_count: 0,
    bank_total_cents: 0,
    only_in_expenses_count: 0,
  },
  rows: [],
  only_in_expenses: [],
}

const previewPayload = {
  account_label: "StartKonto",
  rows: [
    {
      booking_date: "2026-05-06",
      value_date: "2026-05-06",
      amount_cents: -999,
      currency: "EUR",
      payee: "Amazon",
      booking_text: "Online-Zahlung",
      purpose: null,
      raw_description: "Online-Zahlung · Amazon",
      duplicate: false,
    },
  ],
  errors: [],
  new_count: 1,
  duplicate_count: 0,
}

test.describe("Reconciliation", () => {
  test("clears the import preview when upload inputs change", async ({ page }) => {
    await page.route("**/api/reconciliation", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyReconciliation),
      })
    })
    await page.route("**/api/reconciliation/commerzbank-csv/preview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(previewPayload),
      })
    })

    await page.goto("/reconciliation")
    await page.getByLabel("CSV file").setInputFiles({
      name: "first.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("first"),
    })
    await page.getByRole("button", { name: "Preview CSV" }).click()
    await expect(page.getByRole("button", { name: "Import rows" })).toBeVisible()

    await page.getByLabel("Account label").fill("SecondAccount")
    await expect(page.getByRole("button", { name: "Import rows" })).toHaveCount(0)

    await page.getByRole("button", { name: "Preview CSV" }).click()
    await expect(page.getByRole("button", { name: "Import rows" })).toBeVisible()

    await page.getByLabel("CSV file").setInputFiles({
      name: "second.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("second"),
    })
    await expect(page.getByRole("button", { name: "Import rows" })).toHaveCount(0)
  })
})
