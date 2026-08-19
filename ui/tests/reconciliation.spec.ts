import { expect, test } from "./fixtures"

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

const candidateOne = {
  id: 41,
  date: "2026-05-04",
  type: "expense",
  amount_cents: 1_200,
  signed_amount_cents: -1_200,
  title: "Cafe one",
  description: "Morning coffee",
  category: "Dining",
  date_delta_days: 2,
}

const candidateTwo = {
  id: 42,
  date: "2026-05-05",
  type: "expense",
  amount_cents: 1_200,
  signed_amount_cents: -1_200,
  title: "Cafe two",
  description: "Lunch coffee",
  category: "Dining",
  date_delta_days: 1,
}

const inboxRows = [
  {
    id: 1,
    account_label: "StartKonto",
    booking_date: "2026-05-06",
    value_date: "2026-05-05",
    amount_cents: -1_200,
    currency: "EUR",
    payee: "CAFE CENTRAL",
    booking_text: "Kartenzahlung",
    purpose: "Coffee",
    raw_description: "Kartenzahlung · CAFE CENTRAL",
    reviewed_at: null,
    status: "suggested",
    candidate_count: 1,
    candidates: [candidateTwo],
    suggested_transaction: candidateTwo,
  },
  {
    id: 2,
    account_label: "StartKonto",
    booking_date: "2026-05-06",
    value_date: "2026-05-05",
    amount_cents: -1_200,
    currency: "EUR",
    payee: "CAFE AM MARKT",
    booking_text: "Kartenzahlung",
    purpose: "Coffee",
    raw_description: "Kartenzahlung · CAFE AM MARKT",
    reviewed_at: null,
    status: "ambiguous",
    candidate_count: 2,
    candidates: [candidateTwo, candidateOne],
    suggested_transaction: null,
  },
  {
    id: 3,
    account_label: "StartKonto",
    booking_date: "2026-05-07",
    value_date: "2026-05-06",
    amount_cents: -1_395,
    currency: "EUR",
    payee: "AMAZON EU",
    booking_text: "Online-Zahlung",
    purpose: "ORDER 123",
    raw_description: "Online-Zahlung · AMAZON EU · ORDER 123",
    reviewed_at: null,
    status: "missing",
    candidate_count: 0,
    candidates: [],
    suggested_transaction: null,
  },
]

test.describe("Reconciliation", () => {
  test("shows focus on the visible CSV picker", async ({ page }) => {
    await page.route("**/api/reconciliation", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyReconciliation),
      })
    })

    await page.goto("/reconciliation")
    await page.getByLabel("CSV file").focus()
    const visiblePicker = page.locator('label.field[for="reconciliation-file"]')
    await expect(visiblePicker).toHaveCSS("outline-style", "solid")
    await expect(visiblePicker).toHaveCSS("outline-width", "2px")
  })

  test("reconciles the selected CSV without a second import step", async ({ page }) => {
    await page.route("**/api/reconciliation", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptyReconciliation),
      })
    })
    await page.route("**/api/reconciliation/commerzbank-csv/commit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ imported_count: 1, duplicate_count: 0 }),
      })
    })

    await page.goto("/reconciliation")
    await page.getByLabel("CSV file").setInputFiles({
      name: "statement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("statement"),
    })
    await page.getByRole("button", { name: "Reconcile", exact: true }).click()

    await expect(page.getByText("1 imported · 0 duplicates skipped")).toBeVisible()
    await expect(page.getByRole("button", { name: "Import rows" })).toHaveCount(0)
  })

  test("keeps all decisions in one inbox and edits new transactions in place", async ({ page }) => {
    let activeRows = [...inboxRows]
    let createPayload: Record<string, unknown> | null = null

    await page.route("**/api/reconciliation", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            row_count: 3,
            unresolved_count: 2,
            suggested_count: 1,
            matched_count: 0,
            reviewed_count: 0,
            bank_total_cents: -3_795,
            only_in_expenses_count: 0,
          },
          rows: activeRows,
          only_in_expenses: [],
        }),
      })
    })
    await page.route("**/api/categories?period=all", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { id: 7, name: "Shopping", type: "expense", icon: null, archived_at: null },
          ],
        }),
      })
    })
    await page.route("**/api/reconciliation/bank-rows/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname
      const rowId = Number(pathname.split("/")[4])
      if (pathname.endsWith("/reopen")) {
        const reopenedRow = inboxRows.find((row) => row.id === rowId)
        if (reopenedRow) activeRows = [...activeRows, reopenedRow]
      } else {
        activeRows = activeRows.filter((row) => row.id !== rowId)
      }
      if (pathname.endsWith("/create-transaction")) {
        createPayload = route.request().postDataJSON() as Record<string, unknown>
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", transaction_id: 99 }),
      })
    })

    await page.goto("/reconciliation")

    await expect(page.getByText("Review queue")).toHaveCount(0)
    await expect(page.getByText("Only in Expenses")).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "3 items to reconcile" })).toBeVisible()
    const suggestedRow = page.getByTestId("reconciliation-row-1")
    await expect(suggestedRow.getByText("Cafe two", { exact: true })).toBeVisible()
    await suggestedRow.getByRole("button", { name: "Match", exact: true }).click()
    await page.getByRole("button", { name: "Undo" }).click()
    await expect(suggestedRow).toBeVisible()
    await suggestedRow.getByRole("button", { name: "Match", exact: true }).click()
    await expect(suggestedRow).toHaveCount(0)

    await page.getByTestId("reconciliation-row-2").getByRole("button", { name: "Choose match" }).click()
    const matchDialog = page.getByRole("dialog", { name: "Choose transaction" })
    await matchDialog.getByRole("radio", { name: /Cafe one/ }).click()
    await matchDialog.getByRole("button", { name: "Match selected" }).click()
    await expect(page.getByTestId("reconciliation-row-2")).toHaveCount(0)

    await page
      .getByTestId("reconciliation-row-3")
      .getByRole("button", { name: "Create new transaction" })
      .click()
    const createDialog = page.getByRole("dialog", { name: "Create transaction" })
    await expect(createDialog.getByLabel("Title")).toHaveValue("AMAZON EU")
    await createDialog.getByLabel("Title").fill("USB-C cable")
    await createDialog.getByLabel("Transaction date").fill("2026-05-04")
    await createDialog.getByLabel("Category").selectOption({ label: "Shopping" })
    await createDialog.getByLabel("Description (optional)").fill("Travel charger cable")
    await createDialog.getByRole("button", { name: "Create and match" }).click()

    await expect(createDialog).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Inbox cleared" })).toBeVisible()
    expect(createPayload).toEqual({
      date: "2026-05-04",
      category_id: 7,
      title: "USB-C cable",
      description: "Travel charger cable",
    })
  })

  test("creates and matches an edited transaction through the real backend", async ({ page }) => {
    const suffix = Date.now()
    const payee = `Desktop E2E ${suffix}`
    const content = [
      "Buchungstag;Wertstellung;Buchungstext;Auftraggeber / Begünstigter;Betrag;Währung;Verwendungszweck",
      `06.05.2026;05.05.2026;Kartenzahlung;${payee};-91,37;EUR;Raw bank note`,
    ].join("\n")

    await page.goto("/reconciliation")
    await page.getByLabel("CSV file").setInputFiles({
      name: `desktop-${suffix}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(content, "latin1"),
    })
    await page.getByRole("button", { name: "Reconcile", exact: true }).click()
    await expect(page.getByText("1 imported · 0 duplicates skipped")).toBeVisible()

    const row = page.locator("article", { hasText: payee })
    await row.getByRole("button", { name: "Create new transaction" }).click()
    const dialog = page.getByRole("dialog", { name: "Create transaction" })
    await dialog.getByLabel("Title").fill(`Train ticket ${suffix}`)
    await dialog.getByLabel("Transaction date").fill("2026-05-03")
    await dialog.getByLabel("Description (optional)").fill("Weekend trip")
    await dialog.getByRole("button", { name: "Create and match" }).click()

    await expect(dialog).toHaveCount(0)
    await expect(row).toHaveCount(0)
    const transactions = await page.request.get("/api/transactions?period=all")
    expect(transactions.ok()).toBeTruthy()
    const created = (await transactions.json()).items.find(
      (item: { title: string }) => item.title === `Train ticket ${suffix}`
    )
    expect(created).toMatchObject({
      date: "2026-05-03",
      amount_cents: 9_137,
      description: "Weekend trip",
    })
  })
})
