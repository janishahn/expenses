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

  test("opens on Health and lists every admin section", async ({ page }) => {
    await expect(page.locator("main h1")).toHaveText("Health")
    const server = adminSections(page).getByRole("group", { name: "Server" })
    await expect(server.getByRole("link")).toHaveText([
      "Health",
      "Maintenance",
      "Assistant usage",
      "Logs",
      "System",
    ])
    await expect(server.getByRole("link", { name: "Health" })).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("link", { name: "Back to app" })).toBeVisible()

    for (const label of ["CPU temperature", "Load", "Memory", "Disk"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }
    const status = page.getByRole("region", { name: "Status" })
    await expect(status.getByText("Server", { exact: true })).toBeVisible()
    await expect(status.getByText("Database", { exact: true })).toBeVisible()
    await expect(status.getByText("Free disk space")).toBeVisible()

    await page.goto("/admin/unknown-section")
    await expect(page).toHaveURL("/admin")
    await expect(page.locator("main h1")).toHaveText("Health")
  })

  test("shows the server system details and backup link", async ({ page }) => {
    await openSection(page, "System", "/admin/system")
    await expect(page.locator("main h1")).toHaveText("System")
    const system = page.getByRole("region", { name: "System" })
    for (const label of ["Version", "Environment", "Database", "Logs"]) {
      await expect(system.getByText(label, { exact: true }).first()).toBeVisible()
    }

    await openSection(page, "Maintenance", "/admin/maintenance")
    await expect(page.getByRole("link", { name: "Download database backup" })).toHaveAttribute(
      "href",
      "/api/admin/download-db"
    )
    await expect(page.getByRole("link", { name: "Download all users’ transactions as CSV" })).toHaveAttribute(
      "href",
      "/api/admin/export-csv"
    )
  })

  test("reports rebuild and catch-up outcomes without native dialogs", async ({ page }) => {
    const nativeDialogs: string[] = []
    page.on("dialog", async (dialog) => {
      nativeDialogs.push(dialog.message())
      await dialog.dismiss()
    })
    await openSection(page, "Maintenance", "/admin/maintenance")

    await page.getByRole("button", { name: "Rebuild", exact: true }).click()
    const confirm = page.getByRole("dialog", { name: "Rebuild monthly totals now?" })
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(confirm).toBeHidden()

    await page.getByRole("button", { name: "Rebuild", exact: true }).click()
    await confirm.getByRole("button", { name: "Rebuild" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Monthly totals rebuilt." })).toBeVisible()

    await page.getByRole("button", { name: "Run", exact: true }).click()
    await expect(page.getByRole("status").filter({ hasText: /^Catch-up ran\./ })).toBeVisible()

    expect(nativeDialogs).toEqual([])
  })

  test("shows rebuild failures beside the action", async ({ page }) => {
    await openSection(page, "Maintenance", "/admin/maintenance")
    await page.route("**/api/admin/rebuild-rollups", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Rollup storage is temporarily unavailable." }),
      })
    })

    await page.getByRole("button", { name: "Rebuild", exact: true }).click()
    await page
      .getByRole("dialog", { name: "Rebuild monthly totals now?" })
      .getByRole("button", { name: "Rebuild" })
      .click()

    await expect(page.getByRole("alert")).toHaveText("Rollup storage is temporarily unavailable.")
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

  test("requests structured error logs by default and each log type on demand", async ({ page }) => {
    const requests: URL[] = []
    await page.route("**/api/admin/logs?*", async (route) => {
      requests.push(new URL(route.request().url()))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [], next_cursor: null }),
      })
    })
    const lastRequest = () => requests[requests.length - 1]

    await openSection(page, "Logs", "/admin/logs")
    await expect.poll(() => lastRequest()?.searchParams.get("error_only")).toBe("true")
    expect(lastRequest().searchParams.get("q")).toBeNull()
    await expect(page.getByText("No matching log entries.")).toBeVisible()

    const types = page.getByRole("radiogroup", { name: "Log type" })
    await types.getByRole("radio", { name: "Ingest" }).click()
    await expect.poll(() => lastRequest()?.searchParams.get("path")).toBe("/api/ingest")
    await types.getByRole("radio", { name: "Imports" }).click()
    await expect.poll(() => lastRequest()?.searchParams.get("q")).toBe("import_")
    await types.getByRole("radio", { name: "Scheduler" }).click()
    await expect.poll(() => lastRequest()?.searchParams.get("q")).toBe("scheduler_")
    await types.getByRole("radio", { name: "All" }).click()
    await expect.poll(() => lastRequest()?.searchParams.get("error_only")).toBeNull()

    await page.getByLabel("Search logs").fill("request-abc")
    await expect.poll(() => lastRequest()?.searchParams.get("q")).toBe("request-abc")
  })

  test("opens a log entry's structured details and filters by search", async ({ page }) => {
    await openSection(page, "Logs", "/admin/logs")
    await page.getByRole("radiogroup", { name: "Log type" }).getByRole("radio", { name: "All" }).click()
    const entries = page.getByRole("list", { name: "Log entries" }).getByRole("listitem")
    const firstRow = entries.first()
    await expect(firstRow).toBeVisible()
    const name = (await firstRow.getAttribute("aria-label")) ?? ""
    const event = name.replace(/^\S+ /, "").replace(/ at .*$/, "")
    expect(event).not.toBe("")

    await firstRow.click()
    await expect(firstRow).toHaveAttribute("aria-current", "true")
    const peek = page.getByRole("complementary", { name: event, exact: true })
    await expect(peek).toBeVisible()
    await expect(peek.getByText("Logger", { exact: true })).toBeVisible()
    await expect(peek.getByText("Request ID", { exact: true })).toBeVisible()
    const payload = peek.getByLabel("Structured payload")
    await expect(payload).toBeVisible()
    await expect.poll(async () => JSON.parse(await payload.innerText()).event).toBe(event)

    await page.keyboard.press("Escape")
    await expect(peek).toBeHidden()

    await page.getByLabel("Search logs").fill(event)
    await expect(entries.first()).toBeVisible()
    await page.getByLabel("Search logs").fill("no-such-log-event-xyz")
    await expect(page.getByText("No matching log entries.")).toBeVisible()
    await expect(entries).toHaveCount(0)
  })

  test("pages back through older log entries", async ({ page }) => {
    const pageOne = Array.from({ length: 3 }, (_, index) => ({
      timestamp: `2026-10-12T10:0${index}:00`,
      level: "INFO",
      logger: "expenses",
      event: `paged_event_${index}`,
      request_id: `req-${index}`,
    }))
    const older = [
      {
        timestamp: "2026-10-11T09:00:00",
        level: "ERROR",
        logger: "expenses",
        event: "paged_older_event",
        request_id: "req-old",
      },
    ]
    await page.route("**/api/admin/logs?*", async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          cursor
            ? { entries: older, next_cursor: null }
            : { entries: pageOne, next_cursor: "page-two" }
        ),
      })
    })

    await openSection(page, "Logs", "/admin/logs")
    const entries = page.getByRole("list", { name: "Log entries" }).getByRole("listitem")
    await expect(entries).toHaveCount(3)
    await page.getByRole("button", { name: "Load older" }).click()
    await expect(entries).toHaveCount(1)
    await expect(entries.first()).toHaveAccessibleName(/^Error paged_older_event at /)
    await expect(page.getByRole("button", { name: "Load older" })).toHaveCount(0)
  })

  test("shows a critical server status from the backend validation override", async ({ page }) => {
    const csrfToken = await getCsrfToken(page.request)
    const setOverrideResponse = await page.request.post("/api/admin/system-health/validation-override", {
      headers: { "X-CSRF-Token": csrfToken },
      data: { profile: "critical" },
    })
    expect(setOverrideResponse.ok()).toBeTruthy()

    try {
      await page.reload()
      const status = page.getByRole("region", { name: "Status" })
      await expect(status).toContainText("Critical")
    } finally {
      await page.request.delete("/api/admin/system-health/validation-override", {
        headers: { "X-CSRF-Token": csrfToken },
      })
    }
  })

  test("renders assistant usage stats and switches the reporting period", async ({ page }) => {
    const requestedPeriods: string[] = []
    await page.route("**/api/ai/usage/summary?*", async (route) => {
      const period = new URL(route.request().url()).searchParams.get("period") ?? "week"
      requestedPeriods.push(period)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          feature: "spending_chat",
          period,
          started_at: period === "all" ? null : "2026-06-21T00:00:00",
          total_chats: period === "all" ? 42 : period === "month" ? 0 : 7,
          completed_chats: period === "all" ? 40 : 6,
          failed_chats: 1,
          cancelled_chats: 0,
          costed_chats: 5,
          input_tokens: 1000,
          output_tokens: 500,
          total_tokens: 1500,
          cached_input_tokens: 200,
          cache_write_tokens: 0,
          reasoning_tokens: 50,
          total_cost_decimal: "0.0123",
          average_cost_decimal: "0.0025",
          cost_unit: "usd",
          average_total_tokens: 214,
          p95_duration_ms: 4200,
        }),
      })
    })

    await openSection(page, "Assistant usage", "/admin/usage")
    await expect(page.locator("main h1")).toHaveText("Assistant usage")
    const period = page.getByRole("radiogroup", { name: "Assistant usage period" })
    await expect(period.getByRole("radio", { name: "Week" })).toBeChecked()

    const strip = page.locator("section").filter({ hasText: "Per chat" }).first()
    await expect(strip.getByText("$0.0123")).toBeVisible()
    await expect(strip.getByText("$0.0025 per chat")).toBeVisible()
    await expect(strip.getByText("6 completed · 1 failed")).toBeVisible()
    await expect(strip.getByText("1.500")).toBeVisible()
    await expect.poll(() => requestedPeriods.includes("week")).toBeTruthy()

    await period.getByRole("radio", { name: "Month" }).click()
    await expect(page.getByText("No assistant usage in this period.")).toBeVisible()

    await period.getByRole("radio", { name: "All time" }).click()
    await expect.poll(() => requestedPeriods.includes("all")).toBeTruthy()
    await expect(strip.getByText("40 completed · 1 failed")).toBeVisible()
    await expect(strip.getByText("42", { exact: true })).toBeVisible()
  })

  test("navigates to the SQLite importer and back to Maintenance", async ({ page }) => {
    await openSection(page, "Maintenance", "/admin/maintenance")
    await page.getByRole("link", { name: "Open legacy SQLite import" }).click()
    await expect(page).toHaveURL("/admin/import")
    await expect(page.locator("main h1")).toHaveText("Legacy SQLite import")
    await expect(adminSections(page).getByRole("link", { name: "Maintenance" })).toHaveAttribute(
      "aria-current",
      "page"
    )

    await page.getByRole("link", { name: "Maintenance" }).first().click()
    await expect(page).toHaveURL("/admin/maintenance")
    await expect(page.locator("main h1")).toHaveText("Maintenance")
  })
})
