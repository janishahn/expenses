import { expect, test } from "./fixtures"

test("previews and imports a real Commerzbank CSV on mobile", async ({ page }) => {
  const uniqueDay = String((Date.now() % 20) + 1).padStart(2, "0")
  const content = [
    "Buchungstag;Wertstellung;Buchungstext;Auftraggeber / Begünstigter;Betrag;Währung;Verwendungszweck",
    `${uniqueDay}.05.2026;${uniqueDay}.05.2026;Kartenzahlung;Mobile E2E;-11,78;EUR;Mobile reconciliation`,
  ].join("\n")

  await page.goto("/reconciliation")
  await page.getByLabel("CSV file").setInputFiles({
    name: `mobile-${Date.now()}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(content, "latin1"),
  })
  await page.getByRole("button", { name: "Preview CSV" }).click()
  await expect(page.getByText(/1 new row\(s\)/)).toBeVisible()
  await page.getByRole("button", { name: "Import rows" }).click()
  await expect(page.getByText(/Imported 1 new row\(s\)/)).toBeVisible()
  await expect(page.getByText("Statement rows")).toBeVisible()
})
