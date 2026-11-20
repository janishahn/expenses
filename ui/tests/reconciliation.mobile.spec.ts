import { expect, test, type APIRequestContext, type Page } from "./fixtures"
import { createCategory, createTransaction, loginAsIsolatedUser } from "./helpers"

type Isolated = { request: APIRequestContext; csrfToken: string; categoryId: number }
type CsvRow = { date: string; payee: string; cents: number; purpose?: string }
type StoredRow = { id: number; payee: string | null }

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

async function fetchRows(user: Isolated, view: "open" | "resolved"): Promise<StoredRow[]> {
  const response = await user.request.get(`/api/reconciliation/bank-rows?view=${view}&limit=200`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { items: StoredRow[] }).items
}

const openList = (page: Page) => page.getByRole("list", { name: "Bank rows to review" })
const rowItem = (list: ReturnType<typeof openList>, payee: string) => list.getByRole("listitem", { name: payee, exact: true })
const toast = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ })

async function expectNoHorizontalOverflow(page: Page) {
  const body = page.locator("body")
  expect(await body.evaluate((element) => element.scrollWidth)).toBe(await body.evaluate((element) => element.clientWidth))
}

test.describe("Reconcile (mobile)", () => {
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
})
