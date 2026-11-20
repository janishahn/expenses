import { expect, test, type APIRequestContext, type Page } from "./fixtures"
import { createCategory, createTransaction, loginAsIsolatedUser } from "./helpers"

type Isolated = { request: APIRequestContext; csrfToken: string; categoryId: number }
type CsvRow = { date: string; payee: string; cents: number; purpose?: string; currency?: string }
type StoredRow = { id: number; payee: string | null; resolution: string | null }
type StoredTransaction = {
  id: number
  title: string
  date: string
  amount_cents: number
  category_id: number | null
  description: string | null
}

const CSV_HEADER = "Buchungstag;Wertstellung;Buchungstext;Auftraggeber / Begünstigter;Betrag;Währung;Verwendungszweck"

function csvFile(rows: string[], name = "statement.csv") {
  return { name, mimeType: "text/csv", buffer: Buffer.from([CSV_HEADER, ...rows].join("\n"), "latin1") }
}

function csvRow({ date, payee, cents, purpose = "Test purpose", currency = "EUR" }: CsvRow) {
  const [year, month, day] = date.split("-")
  const amount = `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, "0")}`
  return `${day}.${month}.${year};${day}.${month}.${year};Kartenzahlung;${payee};${amount};${currency};${purpose}`
}

async function signIn(page: Page): Promise<Isolated> {
  await page.goto("/")
  const isolated = await loginAsIsolatedUser(page)
  const categoryId = await createCategory(isolated.request, isolated.csrfToken, "expense", "Dining")
  return { ...isolated, categoryId }
}

async function importRows(user: Isolated, rows: CsvRow[], account = "StartKonto") {
  const response = await user.request.post("/api/reconciliation/commerzbank-csv/commit", {
    headers: { "X-CSRF-Token": user.csrfToken },
    multipart: { account_label: account, file: csvFile(rows.map(csvRow)) },
  })
  expect(response.ok()).toBeTruthy()
}

async function addExpense(user: Isolated, title: string, date: string, cents: number) {
  return createTransaction(user.request, user.csrfToken, {
    date,
    occurred_at: `${date}T12:00:00`,
    type: "expense",
    amount_cents: cents,
    category_id: user.categoryId,
    title,
    tags: [],
  })
}

async function fetchTransaction(user: Isolated, id: number): Promise<StoredTransaction> {
  const response = await user.request.get(`/api/transactions/${id}`)
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as StoredTransaction
}

async function fetchRows(user: Isolated, view: "open" | "resolved"): Promise<StoredRow[]> {
  const response = await user.request.get(`/api/reconciliation/bank-rows?view=${view}&limit=200`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { items: StoredRow[] }).items
}

async function rowId(user: Isolated, view: "open" | "resolved", payee: string) {
  const row = (await fetchRows(user, view)).find((entry) => entry.payee === payee)
  expect(row).toBeDefined()
  return row!.id
}

async function resolveRow(
  user: Isolated,
  id: number,
  action: "accept-suggestion" | "ignore" | "create-transaction",
  body?: object,
) {
  const response = await user.request.post(`/api/reconciliation/bank-rows/${id}/${action}`, {
    headers: { "X-CSRF-Token": user.csrfToken },
    data: body,
  })
  expect(response.ok()).toBeTruthy()
}

const openList = (page: Page) => page.getByRole("list", { name: "Bank rows to review" })
const resolvedList = (page: Page) => page.getByRole("list", { name: "Resolved bank rows" })
const rowItem = (list: ReturnType<typeof openList>, payee: string) => list.getByRole("listitem", { name: payee, exact: true })
const toast = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ })

test.describe("Reconcile", () => {
  test("imports a statement after a preview and counts rows that were imported before", async ({ page }) => {
    await signIn(page)
    await page.goto("/reconciliation")
    await expect(page.getByText("Import a bank statement to check it against your transactions")).toBeVisible()

    await page.getByRole("button", { name: "Import statement" }).last().click()
    const dialog = page.getByRole("dialog", { name: "Import statement" })
    await dialog.getByLabel("Account").selectOption({ label: "New account…" })
    await dialog.getByRole("textbox", { name: "Name" }).fill("StartKonto")
    await dialog.getByLabel("Commerzbank CSV file").setInputFiles(
      csvFile([
        csvRow({ date: "2026-05-06", payee: "Bakery Alpha", cents: -420 }),
        csvRow({ date: "2026-05-07", payee: "Kiosk Beta", cents: -1250 }),
      ]),
    )
    await expect(dialog.getByText("Rows", { exact: true })).toBeVisible()
    await expect(dialog).toContainText("2 · 6 – 7 May 2026")
    await expect(dialog).toContainText("Bakery Alpha")
    await dialog.getByRole("button", { name: "Import 2 rows" }).click()
    await expect(toast(page)).toContainText("Imported 2 rows")
    await expect(rowItem(openList(page), "Bakery Alpha")).toBeVisible()
    await expect(page.getByRole("radio", { name: /^To review 2/ })).toBeChecked()
    await expect(page.getByText(/^Last import .* · StartKonto$/)).toBeVisible()

    await page.getByRole("button", { name: "Import statement" }).first().click()
    const second = page.getByRole("dialog", { name: "Import statement" })
    await expect(second.getByLabel("Account")).toHaveValue("StartKonto")
    await second.getByLabel("Commerzbank CSV file").setInputFiles(
      csvFile([
        csvRow({ date: "2026-05-06", payee: "Bakery Alpha", cents: -420 }),
        csvRow({ date: "2026-05-07", payee: "Kiosk Beta", cents: -1250 }),
        csvRow({ date: "2026-05-08", payee: "Pharmacy Gamma", cents: -899 }),
      ]),
    )
    await expect(second).toContainText("1 · 2 already imported")
    await second.getByRole("button", { name: "Import 1 row" }).click()
    await expect(toast(page)).toContainText("Imported 1 row · 2 already imported")
    await expect(openList(page).getByRole("listitem")).toHaveCount(3)
  })

  test("sets the amount to the bank amount when matching a transaction found by search, and Undo restores it", async ({
    page,
  }) => {
    const user = await signIn(page)
    const id = await addExpense(user, "Dentist visit", "2026-05-01", 2500)
    await importRows(user, [{ date: "2026-05-20", payee: "DENTAL PRACTICE", cents: -3000 }])
    await page.goto("/reconciliation")

    await rowItem(openList(page), "DENTAL PRACTICE").click()
    const peek = page.getByRole("complementary", { name: "DENTAL PRACTICE" })
    await expect(peek).toContainText("No transaction with")
    await peek.getByRole("searchbox", { name: "Find a transaction" }).fill("Dentist")
    await peek.getByRole("radio", { name: "Dentist visit" }).check()
    const setAmount = peek.getByRole("switch", { name: "Set the amount to the bank amount" })
    await expect(setAmount).toBeChecked()
    await peek.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("Matched with Dentist visit")
    expect((await fetchTransaction(user, id)).amount_cents).toBe(3000)

    await toast(page).getByRole("button", { name: "Undo" }).click()
    await expect(rowItem(openList(page), "DENTAL PRACTICE")).toBeVisible()
    await expect.poll(async () => (await fetchTransaction(user, id)).amount_cents).toBe(2500)
  })

  test("Undo keeps an amount edited after the match", async ({ page }) => {
    const user = await signIn(page)
    const id = await addExpense(user, "Physio visit", "2026-05-01", 4000)
    await importRows(user, [{ date: "2026-05-20", payee: "PHYSIO", cents: -4500 }])
    await page.goto("/reconciliation")

    await rowItem(openList(page), "PHYSIO").click()
    const peek = page.getByRole("complementary", { name: "PHYSIO" })
    await peek.getByRole("searchbox", { name: "Find a transaction" }).fill("Physio")
    await peek.getByRole("radio", { name: "Physio visit" }).check()
    await peek.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("Matched with Physio visit")
    // Another tab edits the amount while the Undo toast is up.
    const edited = await user.request.put(`/api/transactions/${id}`, {
      headers: { "X-CSRF-Token": user.csrfToken },
      data: {
        date: "2026-05-01",
        occurred_at: "2026-05-01T12:00:00",
        type: "expense",
        amount_cents: 4700,
        category_id: user.categoryId,
        title: "Physio visit",
        tags: [],
      },
    })
    expect(edited.ok()).toBeTruthy()

    await toast(page).getByRole("button", { name: "Undo" }).click()
    await expect(rowItem(openList(page), "PHYSIO")).toBeVisible()
    expect((await fetchTransaction(user, id)).amount_cents).toBe(4700)
  })

  test("creates and matches a transaction from a row with no match", async ({ page }) => {
    const user = await signIn(page)
    const groceries = await createCategory(user.request, user.csrfToken, "expense", "Groceries")
    await importRows(user, [{ date: "2026-05-07", payee: "AMAZON EU", cents: -1395, purpose: "ORDER 123" }])
    await page.goto("/reconciliation")

    const row = rowItem(openList(page), "AMAZON EU")
    await expect(row).toContainText("No transaction with this amount")
    await row.getByRole("button", { name: "Create…" }).click()
    const dialog = page.getByRole("dialog", { name: "Create transaction" })
    const title = dialog.getByRole("textbox", { name: "Title" })
    await expect(title).toHaveValue("AMAZON EU")
    await expect(dialog.getByRole("textbox", { name: "Notes" })).toHaveValue("ORDER 123")

    await title.fill("")
    await dialog.getByRole("button", { name: "Create and match" }).click()
    await expect(dialog.getByText("Enter a title.")).toBeVisible()
    await title.fill("Desk lamp")
    await dialog.getByRole("button", { name: "Category" }).click()
    await page.getByRole("option", { name: "Groceries" }).click()
    await dialog.getByRole("button", { name: /^Date/ }).click()
    await page.getByRole("dialog", { name: "Date" }).getByRole("textbox", { name: "Date" }).fill("2026-05-05")
    await page.getByRole("button", { name: "Done" }).click()
    await dialog.getByRole("button", { name: "Create and match" }).click()

    await expect(toast(page)).toContainText("Created Desk lamp")
    await expect(dialog).toBeHidden()
    await expect(page.getByText("Nothing to review")).toBeVisible()
    const response = await user.request.get("/api/transactions?period=all&q=Desk lamp")
    const created = ((await response.json()) as { items: StoredTransaction[] }).items.find((item) => item.title === "Desk lamp")
    expect(created).toBeDefined()
    const stored = await fetchTransaction(user, created!.id)
    expect(stored.amount_cents).toBe(1395)
    expect(stored.date).toBe("2026-05-05")
    expect(stored.category_id).toBe(groceries)
    expect(stored.description).toBe("ORDER 123")
  })

  for (const choice of [
    { button: "Move transaction to Trash", trashed: true, message: "Moved back to review · transaction moved to Trash" },
    { button: "Keep transaction", trashed: false, message: "Moved back to review" },
  ]) {
    test(`reopens a created row, chooses "${choice.button}" and undoes it`, async ({ page }) => {
      const user = await signIn(page)
      await importRows(user, [{ date: "2026-05-08", payee: "HARDWARE STORE", cents: -2599 }])
      await resolveRow(user, await rowId(user, "open", "HARDWARE STORE"), "create-transaction", {
        date: "2026-05-08",
        title: "Hammer",
        category_id: user.categoryId,
        tag_ids: [],
      })
      const created = await user.request.get("/api/transactions?period=all&q=Hammer")
      const createdId = ((await created.json()) as { items: StoredTransaction[] }).items[0].id
      await page.goto("/reconciliation?view=resolved")

      await rowItem(resolvedList(page), "HARDWARE STORE").click()
      await page.getByRole("complementary", { name: "HARDWARE STORE" }).getByRole("button", { name: "Reopen" }).click()
      const dialog = page.getByRole("dialog", { name: "Reopen this row?" })
      await expect(dialog).toContainText("Hammer")
      await dialog.getByRole("button", { name: choice.button }).click()
      await expect(toast(page)).toContainText(choice.message)
      await expect(dialog).toBeHidden()
      expect(await fetchRows(user, "open")).toHaveLength(1)
      const stored = await user.request.get(`/api/transactions/${createdId}`)
      expect(stored.status()).toBe(choice.trashed ? 404 : 200)

      await toast(page).getByRole("button", { name: "Undo" }).click()
      await expect.poll(async () => (await fetchRows(user, "resolved")).map((row) => row.resolution)).toEqual(["created"])
      expect((await user.request.get(`/api/transactions/${createdId}`)).status()).toBe(200)
    })
  }
})
