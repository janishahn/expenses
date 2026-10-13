import { expect, test, type APIRequestContext, type Locator, type Page } from "./fixtures"
import { createCategory, createTransaction, loginAsIsolatedUser, waitForEntrance } from "./helpers"

type Isolated = { request: APIRequestContext; csrfToken: string; categoryId: number }
type CsvRow = { date: string; payee: string; cents: number; purpose?: string }
type StoredRow = { id: number; payee: string | null }
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

function csvRow({ date, payee, cents, purpose = "Test purpose" }: CsvRow) {
  const [year, month, day] = date.split("-")
  const amount = `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, "0")}`
  return `${day}.${month}.${year};${day}.${month}.${year};Kartenzahlung;${payee};${amount};EUR;${purpose}`
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

async function expectSheet(page: Page, sheet: Locator) {
  await waitForEntrance(sheet)
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const box = (await sheet.boundingBox())!
  expect(box.width).toBeCloseTo(viewport.width, 0)
  expect(box.y + box.height).toBeCloseTo(viewport.height, 0)
}

async function expectNoHorizontalOverflow(page: Page) {
  const body = page.locator("body")
  expect(await body.evaluate((element) => element.scrollWidth)).toBe(await body.evaluate((element) => element.clientWidth))
}

test.describe("Reconcile (mobile)", () => {
  test("imports a statement from the Import button and lists the new rows", async ({ page }) => {
    await signIn(page)
    await page.goto("/reconciliation")
    await expect(page.getByText("Import a bank statement to check it against your transactions")).toBeVisible()

    await page.getByRole("button", { name: "Import statement" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Import statement" })
    await dialog.getByLabel("Account").selectOption({ label: "New account…" })
    await dialog.getByRole("textbox", { name: "Name" }).fill("StartKonto")
    await dialog.getByLabel("Commerzbank CSV file").setInputFiles(
      csvFile([
        csvRow({ date: "2026-05-06", payee: "Bakery Alpha", cents: -420 }),
        csvRow({ date: "2026-05-07", payee: "Kiosk Beta", cents: -1250 }),
      ]),
    )
    await expect(dialog).toContainText("2 · 6 – 7 May 2026")
    await dialog.getByRole("button", { name: "Import 2 rows" }).click()
    await expect(toast(page)).toContainText("Imported 2 rows")
    await expect(openList(page).getByRole("listitem")).toHaveCount(2)
    await expectNoHorizontalOverflow(page)
  })

  test("shows rows without inline actions and holds Match, Create and Ignore in the peek", async ({ page }) => {
    const user = await signIn(page)
    await addExpense(user, "Bakery run", "2026-05-05", 4738)
    await importRows(user, [{ date: "2026-05-06", payee: "BAKERY ALPHA", cents: -4738 }])
    await page.goto("/reconciliation")

    const row = rowItem(openList(page), "BAKERY ALPHA")
    await expect(row.getByRole("button")).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    await row.click()
    const peek = page.getByRole("complementary", { name: "BAKERY ALPHA" })
    await expect(peek.getByRole("radio", { name: "Bakery run" })).toBeChecked()
    await expect(peek.getByRole("button", { name: "Match", exact: true })).toBeEnabled()
    await expect(peek.getByRole("button", { name: "Create…" })).toBeVisible()
    await expect(peek.getByRole("button", { name: "Ignore" })).toBeVisible()
    await expect(openList(page)).toBeHidden()

    await peek.getByRole("button", { name: "Reconcile", exact: true }).click()
    await expect(peek).toBeHidden()
    await expect(row).toBeVisible()
    await expect(page).not.toHaveURL(/peek=/)

    await row.click()
    await peek.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("Matched with Bakery run")
    await expect(peek).toBeHidden()
    await expect(page.getByText("Nothing to review")).toBeVisible()
    expect(await fetchRows(user, "resolved")).toHaveLength(1)
  })

  test("matches every suggestion in the band", async ({ page }) => {
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
    await list.getByRole("button", { name: "Match all" }).click()
    await expect(toast(page)).toContainText("Matched 2 rows")
    await expect(list.getByRole("listitem")).toHaveCount(1)
    await expect(rowItem(list, "UNKNOWN SHOP")).toBeVisible()

    await toast(page).getByRole("button", { name: "Undo" }).click()
    await expect(list.getByRole("listitem")).toHaveCount(3)
  })

  test("chooses among several matches and sets the amount from the peek", async ({ page }) => {
    const user = await signIn(page)
    const id = await addExpense(user, "Dentist visit", "2026-05-01", 2500)
    await addExpense(user, "Cafe one", "2026-05-19", 3000)
    await addExpense(user, "Cafe two", "2026-05-20", 3000)
    await importRows(user, [
      { date: "2026-05-20", payee: "CAFE AM MARKT", cents: -3000 },
      { date: "2026-05-25", payee: "DENTAL PRACTICE", cents: -3300 },
    ])
    await page.goto("/reconciliation")

    const list = openList(page)
    await expect(rowItem(list, "CAFE AM MARKT")).toBeVisible()
    await rowItem(list, "CAFE AM MARKT").click()
    const peek = page.getByRole("complementary", { name: "CAFE AM MARKT" })
    await expect(peek.getByRole("button", { name: "Match", exact: true })).toBeDisabled()
    await peek.getByRole("radio", { name: "Cafe two" }).check()
    await peek.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("Matched with Cafe two")

    await rowItem(list, "DENTAL PRACTICE").click()
    const second = page.getByRole("complementary", { name: "DENTAL PRACTICE" })
    await second.getByRole("searchbox", { name: "Find a transaction" }).fill("Dentist")
    await second.getByRole("radio", { name: "Dentist visit" }).check()
    await expect(second.getByRole("switch", { name: "Set the amount to the bank amount" })).toBeChecked()
    await second.getByRole("button", { name: "Match", exact: true }).click()
    await expect(toast(page)).toContainText("Matched with Dentist visit")
    expect((await fetchTransaction(user, id)).amount_cents).toBe(3300)
  })

  test("ignores a row from the Ignore sheet in the peek", async ({ page }) => {
    const user = await signIn(page)
    await importRows(user, [
      { date: "2026-05-06", payee: "ATM CITY", cents: -5000 },
      { date: "2026-05-07", payee: "ODD CHARGE", cents: -777 },
    ])
    await page.goto("/reconciliation")

    const list = openList(page)
    await rowItem(list, "ATM CITY").click()
    await page.getByRole("complementary", { name: "ATM CITY" }).getByRole("button", { name: "Ignore" }).click()
    const sheet = page.getByRole("dialog", { name: "Ignore" })
    await expectSheet(page, sheet)
    await sheet.getByRole("menuitem", { name: "Transfer between my accounts" }).click()
    await expect(toast(page)).toContainText("Ignored · Transfer between my accounts")
    await expect(rowItem(list, "ATM CITY")).toBeHidden()

    await rowItem(list, "ODD CHARGE").click()
    await page.getByRole("complementary", { name: "ODD CHARGE" }).getByRole("button", { name: "Ignore" }).click()
    await page.getByRole("dialog", { name: "Ignore" }).getByRole("menuitem", { name: "Other reason…" }).click()
    const dialog = page.getByRole("dialog", { name: "Ignore ODD CHARGE" })
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Refunded next week")
    await dialog.getByRole("button", { name: "Ignore" }).click()
    await expect(toast(page)).toContainText("Ignored · Refunded next week")
    await expect(page.getByText("Nothing to review")).toBeVisible()
  })

  test("creates and matches a transaction from the sheet opened in the peek", async ({ page }) => {
    const user = await signIn(page)
    await importRows(user, [{ date: "2026-05-07", payee: "AMAZON EU", cents: -1395, purpose: "ORDER 123" }])
    await page.goto("/reconciliation")

    await rowItem(openList(page), "AMAZON EU").click()
    await page.getByRole("complementary", { name: "AMAZON EU" }).getByRole("button", { name: "Create…" }).click()
    const dialog = page.getByRole("dialog", { name: "Create transaction" })
    await expectSheet(page, dialog)
    await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("AMAZON EU")
    await dialog.getByRole("textbox", { name: "Title" }).fill("Desk lamp")
    await dialog.getByRole("button", { name: "Create and match" }).click()

    await expect(toast(page)).toContainText("Created Desk lamp")
    await expect(dialog).toBeHidden()
    await expect(page.getByText("Nothing to review")).toBeVisible()
    const response = await user.request.get("/api/transactions?period=all&q=Desk lamp")
    const created = ((await response.json()) as { items: StoredTransaction[] }).items.find((item) => item.title === "Desk lamp")
    expect(created).toBeDefined()
    expect((await fetchTransaction(user, created!.id)).amount_cents).toBe(1395)
  })

  test("shows resolved rows, filters them in the Outcome sheet and reopens a row", async ({ page }) => {
    const user = await signIn(page)
    await importRows(user, [
      { date: "2026-05-07", payee: "ATM CITY", cents: -5000 },
      { date: "2026-05-08", payee: "ODD CHARGE", cents: -777 },
    ])
    await resolveRow(user, await rowId(user, "open", "ATM CITY"), "ignore", { reason: "Cash withdrawal" })
    await resolveRow(user, await rowId(user, "open", "ODD CHARGE"), "create-transaction", {
      date: "2026-05-08",
      title: "Odd thing",
      category_id: user.categoryId,
      tag_ids: [],
    })
    await page.goto("/reconciliation?view=resolved")

    const list = resolvedList(page)
    await expect(list.getByRole("listitem")).toHaveCount(2)
    await page.getByRole("button", { name: "Outcome: All outcomes" }).click()
    const sheet = page.getByRole("dialog", { name: "Outcome" })
    await expectSheet(page, sheet)
    await sheet.getByRole("menuitemcheckbox", { name: "Ignored" }).click()
    await expect(list.getByRole("listitem")).toHaveCount(1)

    await rowItem(list, "ATM CITY").click()
    const peek = page.getByRole("complementary", { name: "ATM CITY" })
    await expect(peek).toContainText("Cash withdrawal")
    await peek.getByRole("button", { name: "Reopen" }).click()
    await expect(toast(page)).toContainText("Moved back to review")
    expect(await fetchRows(user, "open")).toHaveLength(1)
    await expectNoHorizontalOverflow(page)
  })
})
