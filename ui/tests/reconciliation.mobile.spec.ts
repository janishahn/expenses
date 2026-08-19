import { expect, test } from "./fixtures"

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
