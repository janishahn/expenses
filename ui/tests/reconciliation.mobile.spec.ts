import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

test("reconciles a CSV and creates an edited transaction on mobile", async ({ page }) => {
  const suffix = Date.now()
  const payee = `Mobile E2E ${suffix}`
  const content = [
    "Buchungstag;Wertstellung;Buchungstext;Auftraggeber / Begünstigter;Betrag;Währung;Verwendungszweck",
    `08.05.2026;07.05.2026;Kartenzahlung;${payee};-11,78;EUR;Raw mobile note`,
  ].join("\n")

  await page.goto("/reconciliation")
  await page.getByLabel("CSV file").setInputFiles({
    name: `mobile-${suffix}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(content, "latin1"),
  })
  await page.getByRole("button", { name: "Reconcile", exact: true }).click()
  await expect(page.getByText("1 imported · 0 duplicates skipped")).toBeVisible()

  const row = page.locator("article", { hasText: payee })
  await row.getByRole("button", { name: "Create new transaction" }).click()
  const dialog = page.getByRole("dialog", { name: "Create transaction" })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel("Title").fill(`Mobile lunch ${suffix}`)
  await dialog.getByLabel("Transaction date").fill("2026-05-06")
  await dialog.getByLabel("Description (optional)").fill("Lunch with friends")
  await dialog.getByRole("button", { name: "Create and match" }).click()

  await expect(dialog).toHaveCount(0)
  await expect(row).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Inbox cleared" })).toBeVisible()
  const body = page.locator("body")
  expect(await body.evaluate((element) => element.scrollWidth)).toBe(
    await body.evaluate((element) => element.clientWidth)
  )
})

test("chooses an ambiguous match through the real backend on mobile", async ({ page }) => {
  const suffix = Date.now()
  const csrfToken = await getCsrfToken(page.request)
  const categoryId = await ensureCategory(
    page.request,
    csrfToken,
    "expense",
    "Mobile reconciliation match"
  )
  const olderTransactionId = await createTransaction(page.request, csrfToken, {
    date: "2026-06-07",
    occurred_at: "2026-06-07T12:00:00",
    type: "expense",
    amount_cents: 8_421,
    category_id: categoryId,
    title: `Older mobile cafe ${suffix}`,
    tags: [],
  })
  await createTransaction(page.request, csrfToken, {
    date: "2026-06-08",
    occurred_at: "2026-06-08T12:00:00",
    type: "expense",
    amount_cents: 8_421,
    category_id: categoryId,
    title: `Newer mobile cafe ${suffix}`,
    tags: [],
  })
  const payee = `Mobile ambiguous cafe ${suffix}`
  const content = [
    "Buchungstag;Wertstellung;Buchungstext;Auftraggeber / Begünstigter;Betrag;Währung;Verwendungszweck",
    `09.06.2026;09.06.2026;Kartenzahlung;${payee};-84,21;EUR;Coffee`,
  ].join("\n")

  await page.goto("/reconciliation")
  await page.getByLabel("CSV file").setInputFiles({
    name: `mobile-match-${suffix}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(content, "latin1"),
  })
  await page.getByRole("button", { name: "Reconcile", exact: true }).click()

  const row = page.locator("article", { hasText: payee })
  await expect(row.getByText("2 possible matches")).toBeVisible()
  await row.getByRole("button", { name: "Mark reviewed" }).click()
  await expect(row).toHaveCount(0)
  await page.getByRole("button", { name: "Undo" }).click()
  await expect(row.getByText("2 possible matches")).toBeVisible()
  await row.getByRole("button", { name: "Choose match" }).click()
  const dialog = page.getByRole("dialog", { name: "Choose transaction" })
  const olderMatch = dialog.getByRole("radio", {
    name: new RegExp(`Older mobile cafe ${suffix}`),
  })
  await olderMatch.focus()
  await olderMatch.press("Space")
  await expect(olderMatch).toBeChecked()
  await dialog.getByRole("button", { name: "Match selected" }).click()

  await expect(dialog).toHaveCount(0)
  await expect(row).toHaveCount(0)
  const reconciliation = await page.request.get("/api/reconciliation")
  expect(reconciliation.ok()).toBeTruthy()
  const matchedRow = (await reconciliation.json()).rows.find(
    (item: { payee: string }) => item.payee === payee
  )
  expect(matchedRow).toMatchObject({
    status: "matched",
    suggested_transaction: { id: olderTransactionId },
  })
})
