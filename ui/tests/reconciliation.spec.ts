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

  test("imports nothing from a file with invalid rows", async ({ page }) => {
    const user = await signIn(page)
    await page.goto("/reconciliation")
    await page.getByRole("button", { name: "Import statement" }).last().click()
    const dialog = page.getByRole("dialog", { name: "Import statement" })
    await dialog.getByLabel("Account").selectOption({ label: "New account…" })
    await dialog.getByRole("textbox", { name: "Name" }).fill("StartKonto")
    await dialog.getByLabel("Commerzbank CSV file").setInputFiles(
      csvFile([
        csvRow({ date: "2026-05-06", payee: "Valid Row", cents: -420 }),
        "not-a-date;;Kartenzahlung;Broken Row;-1,00;EUR;x",
      ]),
    )
    await expect(dialog.getByRole("button", { name: "Choose another file" })).toBeVisible()
    await expect(dialog.getByText("Rows", { exact: true })).toBeHidden()
    await expect(dialog.getByRole("button", { name: /^Import/ })).toBeHidden()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText("Import a bank statement to check it against your transactions")).toBeVisible()
    expect(await fetchRows(user, "open")).toHaveLength(0)
  })

  test("matches a suggestion from its row and undoes the match", async ({ page }) => {
    const user = await signIn(page)
    await addExpense(user, "Bakery run", "2026-05-05", 4738)
    await importRows(user, [{ date: "2026-05-06", payee: "BAKERY ALPHA", cents: -4738 }])
    await page.goto("/reconciliation")

    const list = openList(page)
    await expect(list.getByText("Suggested match")).toBeVisible()
    const row = rowItem(list, "BAKERY ALPHA")
    await expect(row).toContainText("Bakery run · 1 day earlier")
    await row.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("Matched with Bakery run")
    await expect(page.getByText("Nothing to review")).toBeVisible()
    expect(await fetchRows(user, "resolved")).toHaveLength(1)

    await toast(page).getByRole("button", { name: "Undo" }).click()
    await expect(rowItem(list, "BAKERY ALPHA")).toBeVisible()
    expect(await fetchRows(user, "resolved")).toHaveLength(0)
  })

  test("matches every suggestion in the band at once", async ({ page }) => {
    const user = await signIn(page)
    await addExpense(user, "Coffee beans", "2026-05-05", 1234)
    await addExpense(user, "Train ticket", "2026-05-05", 2750)
    await importRows(user, [
      { date: "2026-05-06", payee: "ROASTERY", cents: -1234 },
      { date: "2026-05-06", payee: "RAIL CO", cents: -2750 },
      { date: "2026-05-06", payee: "UNKNOWN SHOP", cents: -999 },
    ])
    await page.goto("/reconciliation")

    const list = openList(page)
    await expect(page.getByRole("radio", { name: /^To review 3/ })).toBeChecked()
    await list.getByRole("button", { name: "Match all" }).click()
    await expect(toast(page)).toContainText("Matched 2 rows")
    await expect(rowItem(list, "UNKNOWN SHOP")).toBeVisible()
    await expect(list.getByRole("listitem")).toHaveCount(1)
    await expect(list.getByRole("button", { name: "Match all" })).toBeHidden()

    await toast(page).getByRole("button", { name: "Undo" }).click()
    await expect(list.getByRole("listitem")).toHaveCount(3)
  })

  test("chooses one of several matching transactions in the peek", async ({ page }) => {
    const user = await signIn(page)
    await addExpense(user, "Cafe one", "2026-05-04", 1200)
    await addExpense(user, "Cafe two", "2026-05-05", 1200)
    await importRows(user, [{ date: "2026-05-06", payee: "CAFE AM MARKT", cents: -1200 }])
    await page.goto("/reconciliation")

    const row = rowItem(openList(page), "CAFE AM MARKT")
    await expect(row).toContainText("2 possible matches")
    await row.getByRole("button", { name: "Choose" }).click()
    const peek = page.getByRole("complementary", { name: "CAFE AM MARKT" })
    await expect(peek).toBeVisible()
    await expect(page).toHaveURL(/peek=\d+/)
    await expect(peek.getByRole("radio", { checked: true })).toHaveCount(0)
    await expect(peek.getByRole("button", { name: "Match", exact: true })).toBeDisabled()

    await peek.getByRole("radio", { name: "Cafe one" }).check()
    await peek.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("Matched with Cafe one")
    await expect(peek).toBeHidden()
    await expect(page.getByText("Nothing to review")).toBeVisible()
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

  test("shows a foreign statement amount in its currency and keeps the transaction amount", async ({ page }) => {
    const user = await signIn(page)
    await addExpense(user, "Hotel deposit", "2026-05-01", 9000)
    await importRows(user, [{ date: "2026-05-20", payee: "HOTEL NYC", cents: -12000, currency: "USD" }])
    await page.goto("/reconciliation")

    const row = rowItem(openList(page), "HOTEL NYC")
    await expect(row).toContainText("120,00 $")
    await row.click()
    const peek = page.getByRole("complementary", { name: "HOTEL NYC" })
    await peek.getByRole("searchbox", { name: "Find a transaction" }).fill("Hotel")
    await peek.getByRole("radio", { name: "Hotel deposit" }).check()
    await expect(peek.getByRole("switch", { name: "Set the amount to the bank amount" })).toHaveCount(0)
  })

  test("keeps the transaction amount when the amount switch is off", async ({ page }) => {
    const user = await signIn(page)
    const id = await addExpense(user, "Optician visit", "2026-05-01", 8000)
    await importRows(user, [{ date: "2026-05-20", payee: "OPTIK", cents: -7500 }])
    await page.goto("/reconciliation")

    await rowItem(openList(page), "OPTIK").click()
    const peek = page.getByRole("complementary", { name: "OPTIK" })
    await peek.getByRole("searchbox", { name: "Find a transaction" }).fill("Optician")
    await peek.getByRole("radio", { name: "Optician visit" }).check()
    await peek.getByRole("switch", { name: "Set the amount to the bank amount" }).uncheck()
    await peek.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("Matched with Optician visit")
    expect((await fetchTransaction(user, id)).amount_cents).toBe(8000)
  })

  test("ignores a row with a menu reason and with another reason", async ({ page }) => {
    const user = await signIn(page)
    await importRows(user, [
      { date: "2026-05-06", payee: "ATM CITY", cents: -5000 },
      { date: "2026-05-07", payee: "ODD CHARGE", cents: -777 },
    ])
    await page.goto("/reconciliation")

    const list = openList(page)
    await rowItem(list, "ATM CITY").getByRole("button", { name: "Ignore" }).click()
    await page.getByRole("menuitem", { name: "Cash withdrawal" }).click()
    await expect(toast(page)).toContainText("Ignored · Cash withdrawal")
    await expect(rowItem(list, "ATM CITY")).toBeHidden()

    await rowItem(list, "ODD CHARGE").getByRole("button", { name: "Ignore" }).click()
    await page.getByRole("menuitem", { name: "Other reason…" }).click()
    const dialog = page.getByRole("dialog", { name: "Ignore ODD CHARGE" })
    await expect(dialog.getByRole("button", { name: "Ignore" })).toBeDisabled()
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Refunded next week")
    await dialog.getByRole("button", { name: "Ignore" }).click()
    await expect(toast(page)).toContainText("Ignored · Refunded next week")
    await expect(dialog).toBeHidden()
    await expect(page.getByText("Nothing to review")).toBeVisible()

    await toast(page).getByRole("button", { name: "Undo" }).click()
    await expect(rowItem(list, "ODD CHARGE")).toBeVisible()
  })

  test("moves to the last page with rows when a later page empties", async ({ page }) => {
    const user = await signIn(page)
    await importRows(
      user,
      Array.from({ length: 51 }, (_, index) => ({
        date: `2026-04-${String((index % 28) + 1).padStart(2, "0")}`,
        payee: `SHOP ${index}`,
        cents: -(1000 + index),
      }))
    )
    await page.goto("/reconciliation?page=2")

    const ignoreButtons = openList(page).getByRole("button", { name: "Ignore" })
    await expect(ignoreButtons).toHaveCount(1)
    await ignoreButtons.click()
    await page.getByRole("menuitem", { name: "Cash withdrawal" }).click()

    await expect(page).toHaveURL(/page=1/)
    await expect(ignoreButtons).toHaveCount(50)
    await expect(page.getByText("Nothing to review")).toHaveCount(0)
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

  test("undoing a create moves the created transaction to Trash", async ({ page }) => {
    const user = await signIn(page)
    await importRows(user, [{ date: "2026-05-07", payee: "HARDWARE STORE", cents: -2599 }])
    await page.goto("/reconciliation")

    await rowItem(openList(page), "HARDWARE STORE").getByRole("button", { name: "Create…" }).click()
    await page.getByRole("dialog", { name: "Create transaction" }).getByRole("button", { name: "Create and match" }).click()
    await expect(toast(page)).toContainText("Created HARDWARE STORE")
    const resolved = await fetchRows(user, "resolved")
    expect(resolved).toHaveLength(1)

    await toast(page).getByRole("button", { name: "Undo" }).click()
    await expect(rowItem(openList(page), "HARDWARE STORE")).toBeVisible()
    const response = await user.request.get("/api/transactions?period=all&q=HARDWARE STORE")
    expect(((await response.json()) as { items: unknown[] }).items).toHaveLength(0)
  })

  test("lists resolved rows newest first, filters them by outcome and shows a row in the peek", async ({ page }) => {
    const user = await signIn(page)
    const matchedId = await addExpense(user, "Bookshop order", "2026-05-05", 1800)
    await importRows(user, [
      { date: "2026-05-06", payee: "BOOKSHOP", cents: -1800 },
      { date: "2026-05-07", payee: "ATM CITY", cents: -5000 },
      { date: "2026-05-08", payee: "HARDWARE STORE", cents: -2599 },
    ])
    await resolveRow(user, await rowId(user, "open", "BOOKSHOP"), "accept-suggestion")
    await resolveRow(user, await rowId(user, "open", "ATM CITY"), "ignore", { reason: "Cash withdrawal" })
    await resolveRow(user, await rowId(user, "open", "HARDWARE STORE"), "create-transaction", {
      date: "2026-05-08",
      title: "Hammer",
      category_id: user.categoryId,
      tag_ids: [],
    })
    await page.goto("/reconciliation")
    await expect(page.getByText("Nothing to review")).toBeVisible()

    await page.getByRole("radio", { name: "Resolved" }).click()
    const list = resolvedList(page)
    await expect(list.getByRole("listitem")).toHaveText([/HARDWARE STORE/, /ATM CITY/, /BOOKSHOP/])

    await page.getByRole("button", { name: "Outcome: All outcomes" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Ignored" }).click()
    await expect(list.getByRole("listitem")).toHaveCount(1)
    await rowItem(list, "ATM CITY").click()
    const ignoredPeek = page.getByRole("complementary", { name: "ATM CITY" })
    await expect(ignoredPeek).toContainText("Ignored")
    await expect(ignoredPeek).toContainText("Cash withdrawal")
    await ignoredPeek.getByRole("button", { name: "Close" }).click()

    await page.getByRole("button", { name: "Outcome: Ignored" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Matched" }).click()
    await expect(list.getByRole("listitem")).toHaveCount(1)
    await rowItem(list, "BOOKSHOP").click()
    const peek = page.getByRole("complementary", { name: "BOOKSHOP" })
    await expect(peek).toContainText("Matched")
    await peek.getByRole("link", { name: /Bookshop order/ }).click()
    await expect(page).toHaveURL(new RegExp(`/transactions/${matchedId}`))
  })

  test("reopens a matched row and the row returns to review", async ({ page }) => {
    const user = await signIn(page)
    await addExpense(user, "Bookshop order", "2026-05-05", 1800)
    await importRows(user, [{ date: "2026-05-06", payee: "BOOKSHOP", cents: -1800 }])
    await resolveRow(user, await rowId(user, "open", "BOOKSHOP"), "accept-suggestion")
    await page.goto("/reconciliation?view=resolved")

    await rowItem(resolvedList(page), "BOOKSHOP").click()
    await page.getByRole("complementary", { name: "BOOKSHOP" }).getByRole("button", { name: "Reopen" }).click()
    await expect(toast(page)).toContainText("Moved back to review")
    await expect(rowItem(resolvedList(page), "BOOKSHOP")).toBeHidden()
    expect(await fetchRows(user, "open")).toHaveLength(1)

    await toast(page).getByRole("button", { name: "Undo" }).click()
    await expect.poll(async () => (await fetchRows(user, "resolved")).length).toBe(1)
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

  test("filters rows by account", async ({ page }) => {
    const user = await signIn(page)
    await importRows(user, [{ date: "2026-05-06", payee: "SHOP ONE", cents: -111 }], "StartKonto")
    await importRows(user, [{ date: "2026-05-06", payee: "SHOP TWO", cents: -222 }], "Savings")
    await page.goto("/reconciliation")

    const list = openList(page)
    await expect(list.getByRole("listitem")).toHaveCount(2)
    await page.getByRole("button", { name: "All accounts" }).click()
    await page.getByRole("menuitemcheckbox", { name: "Savings" }).click()
    await expect(page.getByRole("menu")).toBeHidden()
    await expect(list.getByRole("listitem")).toHaveCount(1)
    await expect(rowItem(list, "SHOP TWO")).toBeVisible()
    await expect(page.getByRole("button", { name: "Savings" })).toBeVisible()
    await page.getByRole("button", { name: "Savings" }).click()
    await page.getByRole("menuitemcheckbox", { name: "All accounts" }).click()
    await expect(list.getByRole("listitem")).toHaveCount(2)
  })

  test("shows Nothing to review and opens the resolved rows from it", async ({ page }) => {
    const user = await signIn(page)
    await importRows(user, [{ date: "2026-05-07", payee: "ATM CITY", cents: -5000 }])
    await resolveRow(user, await rowId(user, "open", "ATM CITY"), "ignore", { reason: "Cash withdrawal" })
    await page.goto("/reconciliation")

    await expect(page.getByText("Nothing to review")).toBeVisible()
    await page.getByRole("button", { name: "Show resolved" }).click()
    await expect(page.getByRole("radio", { name: "Resolved" })).toBeChecked()
    await expect(rowItem(resolvedList(page), "ATM CITY")).toBeVisible()
  })

  test("keeps the row and shows the error when a match fails", async ({ page }) => {
    const user = await signIn(page)
    await addExpense(user, "Bakery run", "2026-05-05", 4738)
    await importRows(user, [{ date: "2026-05-06", payee: "BAKERY ALPHA", cents: -4738 }])
    await page.goto("/reconciliation")

    await page.route("**/api/reconciliation/bank-rows/*/accept-suggestion", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "The bank link is down." }) }),
    )
    const row = rowItem(openList(page), "BAKERY ALPHA")
    await row.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("The bank link is down.")
    await expect(row).toBeVisible()
    expect(await fetchRows(user, "resolved")).toHaveLength(0)
  })
})
