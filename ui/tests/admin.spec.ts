import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

function adminSections(page: Page) {
  return page.getByRole("navigation", { name: "Admin sections" })
}

async function openSection(page: Page, name: string, path: string) {
  await adminSections(page).getByRole("link", { name, exact: true }).click()
  await expect(page).toHaveURL(path)
  await expect(adminSections(page).getByRole("link", { name, exact: true })).toHaveAttribute(
    "aria-current",
    "page"
  )
}

test.describe("Admin Page", () => {
  test.beforeEach(async ({ page }) => {
    await ensureElevatedAdmin(page)
  })

  test("previews and purges deleted transactions older than the chosen days", async ({
    page,
    backend,
  }) => {
    const csrfToken = await getCsrfToken(page.request)
    const categoryId = await createCategory(page.request, csrfToken, "expense", `Purge ${Date.now()}`)
    const title = `Purge me ${Date.now()}`
    const transactionId = await createTransaction(page.request, csrfToken, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 321,
      category_id: categoryId,
      title,
      tags: [],
    })
    const deleted = await page.request.delete(`/api/transactions/${transactionId}`, {
      headers: { "X-CSRF-Token": csrfToken },
    })
    expect(deleted.ok()).toBeTruthy()
    // The app cannot back-date a deletion, so age it in the worker's database.
    const aged = spawnSync(
      "uv",
      [
        "run",
        "python",
        "-c",
        "import sqlite3, sys; c = sqlite3.connect(sys.argv[1]); c.execute(\"UPDATE transactions SET deleted_at = datetime('now', '-60 days') WHERE id = ?\", (int(sys.argv[2]),)); c.commit()",
        join(backend.dataDir, "expenses.db"),
        String(transactionId),
      ],
      { cwd: repoRoot, encoding: "utf8" }
    )
    expect(aged.status, aged.stderr).toBe(0)

    await openSection(page, "Maintenance", "/admin/maintenance")
    const purgeCard = page.getByRole("region", { name: "Purge deleted transactions" })
    const days = purgeCard.getByLabel("Older than")
    const purge = purgeCard.getByRole("button", { name: "Purge", exact: true })

    await expect(days).toHaveValue("30")
    await expect(purgeCard).toContainText("1 transaction")
    await expect(purge).toBeEnabled()

    await days.fill("0")
    await expect(purgeCard.getByRole("alert")).toHaveText("Enter a whole number of days, at least 1.")
    await expect(purge).toBeDisabled()

    await days.fill("90")
    await expect(purgeCard).toContainText("0 transactions")
    await expect(purge).toBeDisabled()

    await days.fill("30")
    await expect(purgeCard).toContainText("1 transaction")
    await purge.click()
    const confirm = page.getByRole("dialog", { name: "Purge 1 deleted transaction?" })
    await expect(confirm).toContainText("Deleted more than 30 days ago.")
    await confirm.getByRole("button", { name: "Purge" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Purged 1 deleted transaction." })).toBeVisible()
    await expect(purgeCard).toContainText("0 transactions")
    await expect(purge).toBeDisabled()
  })
})
