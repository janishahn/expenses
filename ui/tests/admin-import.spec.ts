import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

async function openImportPage(page: Page): Promise<void> {
  await ensureElevatedAdmin(page)
  await page.goto("/admin/import")
  await expect(page).toHaveURL("/admin/import")
  await expect(page.locator("main h1")).toHaveText("Legacy SQLite import")
}

// The importer reads the old single-user schema, so build a small one with Python's sqlite3.
function createLegacyDatabase(path: string, category: string): void {
  const script = [
    "import sqlite3, sys",
    "c = sqlite3.connect(sys.argv[1])",
    "c.execute('create table categories (id integer primary key, name text)')",
    "c.execute('create table transactions (id integer primary key, amount text, category text, description text, transaction_date text, transaction_type text)')",
    "c.execute('create table recurring_transactions (id integer primary key, amount text, category text, description text, start_date text, recurrence_type text, interval integer, transaction_type text, last_processed_date text)')",
    "c.execute(\"insert into transactions (amount, category, description, transaction_date, transaction_type) values ('12.50', ?, ?, '2024-03-01 12:30:00', 'expense')\", (sys.argv[2], sys.argv[3]))",
    "c.execute(\"insert into transactions (amount, category, description, transaction_date, transaction_type) values ('100.00', 'Legacy Pay', 'Legacy salary', '2024-03-02 00:00:00', 'income')\")",
    "c.execute(\"insert into recurring_transactions (amount, category, description, start_date, recurrence_type, interval, transaction_type, last_processed_date) values ('9.99', ?, 'Legacy streaming', '2024-01-05', 'monthly', 1, 'expense', '2024-03-05')\", (sys.argv[2],))",
    "c.commit()",
  ].join("\n")
  const created = spawnSync("uv", ["run", "python", "-c", script, path, category, `Legacy lunch ${category}`], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  expect(created.status, created.stderr).toBe(0)
}

test.describe("Admin Import Page", () => {
  test("shows validation error for non-db sqlite upload", async ({ page }) => {
    await openImportPage(page)

    await page.getByLabel("SQLite database file").setInputFiles({
      name: "legacy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not-a-db"),
    })
    await expect(page.getByRole("alert")).toContainText("Please upload a .db file")
    await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0)
  })

  test("previews a legacy database, maps its categories, and imports it", async ({ page }, testInfo) => {
    const category = `Legacy Food ${Date.now()}`
    const dbPath = testInfo.outputPath("legacy.db")
    createLegacyDatabase(dbPath, category)
    await openImportPage(page)

    await page.getByLabel("SQLite database file").setInputFiles(dbPath)

    const summary = page.locator("main").getByText("Transactions", { exact: true }).locator("xpath=..")
    await expect(summary).toContainText("2")
    await expect(summary).toContainText("1 with a time of day")
    const warnings = page.getByRole("region", { name: "Warnings" })
    await expect(warnings).toContainText("1 transaction(s) have a time-of-day")
    const options = page.getByRole("group", { name: "Options" })
    await expect(options.getByRole("checkbox", { name: "Import recurring rules" })).toBeChecked()
    await expect(options.getByRole("checkbox", { name: "Post imported rules automatically" })).not.toBeChecked()
    await expect(options.getByRole("checkbox", { name: "Add the time of day to titles" })).toBeChecked()

    const mapping = page.getByRole("list", { name: "Category mapping" })
    await expect(mapping.getByRole("listitem", { name: category })).toContainText("1 transaction")
    await expect(page.getByLabel(`Map ${category}`)).toHaveValue("create")
    await page.getByLabel("Map Legacy Pay").selectOption("discard")

    const rules = page.getByRole("list", { name: "Recurring rules" })
    await expect(rules).toContainText("Legacy streaming")
    await expect(rules).toContainText("9,99 €")

    await page.getByRole("button", { name: "Import", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: /^Imported\./ })).toBeVisible()
    await expect(page.getByText("Drop a .db file or choose one")).toBeVisible()

    const imported = await page.request.get(`/api/transactions?period=all&q=${encodeURIComponent(`Legacy lunch ${category}`)}`)
    expect((await imported.json()).items).toHaveLength(1)
    const salary = await page.request.get(`/api/transactions?period=all&q=${encodeURIComponent("Legacy salary")}`)
    expect((await salary.json()).items).toHaveLength(0)
  })
})
