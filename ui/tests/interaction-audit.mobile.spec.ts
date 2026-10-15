import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Locator, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"
import {
  createIngestTransaction,
  createTransaction,
  createUncategorizedExpense,
  ensureCategory,
  getCsrfToken,
  loginAsIsolatedUser,
  stubOsmTiles,
  uploadAttachment,
} from "./helpers"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const artifactDirectory = process.env.UI_POLISH_AUDIT_ARTIFACT_DIR
  ? resolve(repoRoot, process.env.UI_POLISH_AUDIT_ARTIFACT_DIR)
  : null
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pfdvK0AAAAASUVORK5CYII=",
  "base64",
)
const TOUCH_TARGET = 44

// A control reaches the touch target size through its own box, a hit area drawn by a
// pseudo-element, or the label that wraps it.
async function effectiveTarget(locator: Locator) {
  await expect(locator).toBeVisible()
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const number = (value: string) => {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    // The used size of a rendered pseudo-element. Offsets would be wrong for inline elements,
    // whose containing block differs from their bounding box.
    const hitArea = (pseudo: "::before" | "::after") => {
      const style = window.getComputedStyle(element, pseudo)
      if (style.content === "none") return { width: 0, height: 0 }
      return { width: number(style.width), height: number(style.height) }
    }
    const before = hitArea("::before")
    const after = hitArea("::after")
    const label = element.closest("label")?.getBoundingClientRect()
    return {
      width: Math.round(Math.max(rect.width, before.width, after.width, label?.width ?? 0)),
      height: Math.round(Math.max(rect.height, before.height, after.height, label?.height ?? 0)),
    }
  })
}

async function expectTouchTargets(controls: Array<[label: string, locator: Locator]>) {
  for (const [label, locator] of controls) {
    const target = await effectiveTarget(locator)
    expect.soft(target.width, `${label} effective width`).toBeGreaterThanOrEqual(TOUCH_TARGET)
    expect.soft(target.height, `${label} effective height`).toBeGreaterThanOrEqual(TOUCH_TARGET)
  }
}

async function useAuditTheme(page: Page) {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
  await page.addInitScript(() => {
    window.localStorage.setItem("ew.theme.preference", "light")
  })
}

async function expectCoarsePointer(page: Page) {
  expect(
    await page.evaluate(() => window.matchMedia("(hover: none) and (pointer: coarse)").matches),
  ).toBe(true)
}

async function capture(page: Page, name: string, fullPage = false) {
  if (!artifactDirectory) return
  mkdirSync(artifactDirectory, { recursive: true })
  await page.screenshot({ path: resolve(artifactDirectory, name), fullPage })
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

test.describe("Mobile interaction audit", () => {
  test("navigation, header actions, and view-row controls reach 44px", async ({ page }) => {
    await useAuditTheme(page)
    await page.goto("/transactions")
    await expectCoarsePointer(page)
    const tabs = page.getByRole("navigation", { name: "Tabs" })
    const header = page.getByRole("main").locator("header")
    await expectTouchTargets([
      ["Dashboard tab", tabs.getByRole("link", { name: "Dashboard" })],
      ["Transactions tab", tabs.getByRole("link", { name: "Transactions" })],
      ["Budgets tab", tabs.getByRole("link", { name: "Budgets" })],
      ["Insights tab", tabs.getByRole("link", { name: "Insights" })],
      ["More tab", tabs.getByRole("button", { name: "More" })],
      ["Transactions Search", header.getByRole("button", { name: "Search", exact: true })],
      ["Transactions Add", header.getByRole("button", { name: "Add transaction", exact: true })],
      ["Transactions More actions", header.getByRole("button", { name: "More actions" })],
      ["Transactions Filter", page.getByRole("button", { name: /^Filter/ })],
      ["Transactions period", page.getByRole("button", { name: /^Period:/ })],
    ])
    await capture(page, "transactions-header-targets.png")

    await page.goto("/")
    await expectTouchTargets([
      ["Dashboard privacy toggle", page.getByRole("button", { name: /amounts$/ })],
      ["Dashboard previous month", page.getByRole("button", { name: "Previous month" })],
      ["Dashboard period", page.getByRole("button", { name: /^Period:/ })],
      ["Dashboard Filter", page.getByRole("button", { name: "Filter", exact: true })],
      [
        "Dashboard spending chart options",
        page
          .getByRole("region", { name: "Spending by category" })
          .getByRole("button", { name: "Chart options" }),
      ],
      [
        "Dashboard recent Open transactions",
        page.getByRole("region", { name: "Recent" }).getByRole("button", { name: "Open transactions" }),
      ],
    ])

    await page.goto("/insights")
    await expectTouchTargets([
      ["Insights Filter", page.getByRole("button", { name: "Filter", exact: true })],
      [
        "Insights By month chart options",
        page.getByRole("region", { name: "By month" }).getByRole("button", { name: "Chart options" }),
      ],
    ])
    await capture(page, "insights-filter-pill.png")
  })

  test("list rows, selection controls, and receipt actions reach 44px", async ({ page }) => {
    await useAuditTheme(page)
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    try {
      const request = isolated.request
      const token = isolated.csrfToken
      const suffix = `${Date.now()}`
      const categoryName = `Audit compact ${suffix}`
      const categoryId = await ensureCategory(request, token, "expense", categoryName)
      const templateName = `Audit compact template ${suffix}`
      const template = await request.post("/api/templates", {
        headers: { "X-CSRF-Token": token },
        data: {
          name: templateName,
          type: "expense",
          category_id: categoryId,
          default_amount_cents: 425,
          title: null,
          tags: [],
        },
      })
      expect(template.ok()).toBeTruthy()
      const title = `Audit mobile transaction ${suffix}`
      const transactionId = await createTransaction(request, token, {
        date: today(),
        occurred_at: new Date().toISOString(),
        type: "expense",
        amount_cents: 2_145,
        category_id: categoryId,
        title,
        tags: [],
      })
      const attachmentName = `audit-receipt-${suffix}.png`
      await uploadAttachment(request, token, transactionId, {
        name: attachmentName,
        mimeType: "image/png",
        buffer: onePixelPng,
      })

      await page.goto("/categories")
      await expectCoarsePointer(page)
      await expectTouchTargets([["Category row", page.getByRole("listitem", { name: categoryName })]])

      await page.goto("/templates")
      await expectTouchTargets([
        ["Template row", page.getByRole("listitem", { name: templateName })],
        ["Template reorder handle", page.getByRole("button", { name: `Reorder ${templateName}` })],
      ])

      await page.goto(`/transactions?period=all&q=${encodeURIComponent(title)}`)
      const row = page.getByRole("listitem", { name: title })
      await expectTouchTargets([["Transaction row", row]])
      await page.getByRole("main").locator("header").getByRole("button", { name: "More actions" }).tap()
      await page.getByRole("menuitem", { name: "Select" }).tap()
      await row.tap()
      await expect(row.getByRole("checkbox", { name: `Select ${title}` })).toBeChecked()
      await expectTouchTargets([
        ["Selectable transaction row", row],
        [
          "Clear selection",
          page.getByRole("toolbar", { name: "Selected rows" }).getByRole("button", { name: "Clear selection" }),
        ],
      ])

      const inboxTitle = `Audit inbox transaction ${suffix}`
      await createUncategorizedExpense(request, token, inboxTitle)
      await page.goto("/transactions/inbox?period=all")
      await page.getByRole("main").locator("header").getByRole("button", { name: "More actions" }).tap()
      await page.getByRole("menuitem", { name: "Select" }).tap()
      const inboxRow = page.getByRole("listitem", { name: inboxTitle })
      await expectTouchTargets([
        ["Uncategorized row", inboxRow],
        ["Uncategorized row checkbox", inboxRow.getByRole("checkbox", { name: `Select ${inboxTitle}` })],
      ])
      await capture(page, "uncategorized-row-checkbox.png", true)

      await page.goto(`/transactions/${transactionId}`)
      await expectTouchTargets([
        ["Receipt actions", page.getByRole("button", { name: "Receipt actions" })],
        ["Receipt preview", page.getByRole("button", { name: `Open ${attachmentName}` })],
        ["Add tag", page.getByRole("button", { name: "Add tag" })],
        [
          "Breadcrumb Transactions link",
          page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Transactions" }),
        ],
      ])
      await capture(page, "transaction-detail-targets.png", true)
    } finally {
      await isolated.request.dispose()
    }
  })

  test("dialog close buttons, switches, and checkboxes reach 44px", async ({ page, request }) => {
    await useAuditTheme(page)
    const token = await getCsrfToken(request)
    const suffix = `${Date.now()}`
    await ensureCategory(request, token, "expense", `Audit dialog target ${suffix}`)

    await page.goto("/transactions")
    await expectCoarsePointer(page)
    await page.getByRole("button", { name: "Add transaction", exact: true }).tap()
    const addDialog = page.getByRole("dialog", { name: "Add transaction" })
    await expectTouchTargets([
      ["Add transaction Close", addDialog.getByRole("button", { name: "Close" })],
    ])
    await capture(page, "add-transaction-dialog-targets.png")
    await page.keyboard.press("Escape")

    await page.goto("/rules")
    await page.getByRole("main").locator("header").getByRole("button", { name: "Add rule" }).tap()
    const ruleDialog = page.getByRole("dialog", { name: "Add rule" })
    await expectTouchTargets([["Rule editor Close", ruleDialog.getByRole("button", { name: "Close" })]])
    await page.keyboard.press("Escape")

    await page.goto("/recurring")
    await page.getByRole("main").locator("header").getByRole("button", { name: "Add rule" }).tap()
    const recurringDialog = page.getByRole("dialog", { name: "Add rule" })
    await expectTouchTargets([
      ["Recurring editor Close", recurringDialog.getByRole("button", { name: "Close" })],
    ])
    await page.keyboard.press("Escape")

    await page.goto("/settings/appearance")
    await expectTouchTargets([
      [
        "Theme option Light",
        page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Light" }),
      ],
    ])

    await page.goto("/reports/builder")
    await expectTouchTargets([
      ["Report Running balance switch", page.getByRole("switch", { name: "Running balance" })],
      ["Report Cents in tables switch", page.getByRole("switch", { name: "Cents in tables" })],
      ["Report section checkbox", page.getByRole("group", { name: "Sections" }).getByRole("checkbox").first()],
    ])
    await capture(page, "report-builder-targets.png", true)
  })

  test("peek actions, budget editor choices, and import options reach 44px", async ({ page }) => {
    await useAuditTheme(page)
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    try {
      const request = isolated.request
      const token = isolated.csrfToken
      const suffix = `${Date.now()}`
      const categoryName = `Audit conditional budget ${suffix}`
      const categoryId = await ensureCategory(request, token, "expense", categoryName)
      const budget = await request.post("/api/budgets/templates", {
        headers: { "X-CSRF-Token": token },
        data: {
          frequency: "monthly",
          category_id: categoryId,
          amount_cents: 50_000,
          starts_on: `${today().slice(0, 7)}-01`,
          ends_on: null,
        },
      })
      expect(budget.ok()).toBeTruthy()

      await page.goto("/budgets")
      await expectCoarsePointer(page)
      await page.getByRole("listitem", { name: categoryName }).tap()
      const peek = page.getByRole("complementary", { name: categoryName })
      const peekActions = peek.getByRole("button", { name: "More actions" })
      await expectTouchTargets([["Budget peek More actions", peekActions]])
      await peekActions.tap()
      const compare = page.getByRole("menuitemcheckbox", { name: "Compare previous month" })
      await expectTouchTargets([["Budget Compare previous month item", compare]])
      await compare.tap()
      await expect(compare).toBeHidden()
      await peek.getByRole("button", { name: /^Amount/ }).tap()
      const editor = page.getByRole("dialog", { name: "Edit amount" })
      await expectTouchTargets([
        ["Budget only-this-month radio", editor.getByRole("radio", { name: /^Only / })],
        ["Budget and-later radio", editor.getByRole("radio", { name: /and later$/ })],
      ])
      await capture(page, "budget-editor-targets.png")
      await page.keyboard.press("Escape")
    } finally {
      await isolated.request.dispose()
    }

    await ensureElevatedAdmin(page)
    const legacy = test.info().outputPath("legacy.db")
    const script = [
      "import sqlite3, sys",
      "c = sqlite3.connect(sys.argv[1])",
      "c.execute('create table categories (id integer primary key, name text)')",
      "c.execute('create table transactions (id integer primary key, amount text, category text, description text, transaction_date text, transaction_type text)')",
      "c.execute('create table recurring_transactions (id integer primary key, amount text, category text, description text, start_date text, recurrence_type text, interval integer, transaction_type text, last_processed_date text)')",
      "c.execute(\"insert into transactions (amount, category, description, transaction_date, transaction_type) values ('12.50', 'Legacy Food', 'Legacy lunch', '2024-03-01 12:30:00', 'expense')\")",
      "c.execute(\"insert into recurring_transactions (amount, category, description, start_date, recurrence_type, interval, transaction_type, last_processed_date) values ('9.99', 'Legacy Food', 'Legacy streaming', '2024-01-05', 'monthly', 1, 'expense', '2024-03-05')\")",
      "c.commit()",
    ].join("\n")
    const created = spawnSync("uv", ["run", "python", "-c", script, legacy], {
      cwd: repoRoot,
      encoding: "utf8",
    })
    expect(created.status, created.stderr).toBe(0)
    await page.goto("/admin/import")
    await page.getByLabel("SQLite database file").setInputFiles(legacy)
    const options = page.getByRole("group", { name: "Options" })
    await expect(options).toBeVisible()
    const checkboxes = options.getByRole("checkbox")
    expect(await checkboxes.count()).toBe(4)
    for (let index = 0; index < 4; index += 1) {
      await expectTouchTargets([[`SQLite import option ${index + 1}`, checkboxes.nth(index)]])
    }
    await capture(page, "sqlite-import-options-targets.png", true)
  })

  test("map attribution and the reimbursement allocation action reach 44px without overflow", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page)
    const token = await getCsrfToken(request)
    const suffix = `${Date.now()}`
    const expenseCategory = `Audit reimbursement expense ${suffix}`
    const expenseCategoryId = await ensureCategory(request, token, "expense", expenseCategory)
    const incomeCategoryId = await ensureCategory(request, token, "income", `Audit reimbursement income ${suffix}`)
    const expenseId = await createTransaction(request, token, {
      date: today(),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 4_200,
      category_id: expenseCategoryId,
      title: `Audit reimbursed expense ${suffix}`,
      tags: [],
    })
    const reimbursementId = await createTransaction(request, token, {
      date: today(),
      occurred_at: new Date().toISOString(),
      type: "income",
      amount_cents: 4_200,
      category_id: incomeCategoryId,
      title: `Audit reimbursement ${suffix}`,
      tags: [],
      is_reimbursement: true,
    })
    const allocation = await request.post(`/api/reimbursements/${reimbursementId}/allocations`, {
      headers: { "X-CSRF-Token": token },
      data: { expense_transaction_id: expenseId, amount_cents: 4_200 },
    })
    expect(allocation.ok()).toBeTruthy()

    await page.goto(`/transactions/${reimbursementId}`)
    await expectCoarsePointer(page)
    await expectTouchTargets([
      ["Reimbursement allocation remove", page.getByRole("button", { name: "Remove allocation" })],
    ])
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(geometry.scrollWidth, "allocation controls expanded the document").toBeLessThanOrEqual(
      geometry.clientWidth,
    )
    await capture(page, "reimbursement-allocation-action.png", true)

    await stubOsmTiles(page)
    const locationTitle = `Audit location ${suffix}`
    await createIngestTransaction(request, {
      amount_cents: 1_234,
      title: locationTitle,
      date: today(),
      category: expenseCategory,
      latitude: 52.520008,
      longitude: 13.404954,
    })
    await page.goto(`/transactions?period=all&q=${encodeURIComponent(locationTitle)}`)
    await page.getByRole("listitem", { name: locationTitle }).tap()
    await expectTouchTargets([
      [
        "Location map OpenStreetMap attribution",
        page.getByRole("group", { name: /^Map at / }).getByRole("link", { name: "OpenStreetMap" }),
      ],
    ])

    await page.goto("/insights")
    const byMonth = page.getByRole("region", { name: "By month" })
    await byMonth.getByRole("button", { name: "Chart options" }).tap()
    await page.getByRole("menuitemcheckbox", { name: "Show as table" }).tap()
    await expect(
      byMonth.getByRole("table", { name: "Amounts by month" }).getByRole("link").first(),
    ).toBeVisible()
  })

  test("long Insights category names stay readable with full names in the data view", async ({
    page,
  }) => {
    await useAuditTheme(page)
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    try {
      const request = isolated.request
      const token = isolated.csrfToken
      const suffix = String(Date.now()).slice(-4)
      const incomeName = `Audit income shared-prefix alpha ${suffix}`
      const expenseName = `Audit expense shared-prefix beta ${suffix}`
      const incomeCategoryId = await ensureCategory(request, token, "income", incomeName)
      const expenseCategoryId = await ensureCategory(request, token, "expense", expenseName)
      const occurredAt = new Date().toISOString()
      await createTransaction(request, token, {
        date: occurredAt.slice(0, 10),
        occurred_at: occurredAt,
        type: "income",
        amount_cents: 300_000,
        category_id: incomeCategoryId,
        title: `Audit Net income ${suffix}`,
        tags: [],
      })
      await createTransaction(request, token, {
        date: occurredAt.slice(0, 10),
        occurred_at: occurredAt,
        type: "expense",
        amount_cents: 125_000,
        category_id: expenseCategoryId,
        title: `Audit Net expense ${suffix}`,
        tags: [],
      })

      await page.goto("/insights?period=this_month")
      await page.waitForLoadState("networkidle")
      const byMonth = page.getByRole("region", { name: "By month" })
      await byMonth.scrollIntoViewIfNeeded()
      await byMonth.getByRole("button", { name: "Chart options" }).tap()
      await page.getByRole("menuitemcheckbox", { name: "Show as table" }).tap()
      const table = byMonth.getByRole("table", { name: "Amounts by month" })
      await expect(table.getByRole("row", { name: new RegExp(expenseName) })).toBeVisible()
      await byMonth.getByRole("radio", { name: "Income" }).tap()
      await expect(table.getByRole("row", { name: new RegExp(incomeName) })).toBeVisible()
      const amountCells = table.locator("tbody td")
      expect(await amountCells.count()).toBeGreaterThan(0)
      for (let index = 0; index < (await amountCells.count()); index += 1) {
        await expect(amountCells.nth(index)).toHaveCSS("white-space", "nowrap")
      }
      const geometry = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
      await capture(page, "insights-long-labels.png", true)
    } finally {
      await isolated.request.dispose()
    }
  })

  test("assistant Send and Scroll to latest reach 44px", async ({ page }) => {
    await useAuditTheme(page)
    const longAnswer = Array.from(
      { length: 60 },
      (_, index) => `Audit spending detail ${index + 1}.`,
    ).join("\n\n")
    const body = [
      { type: "turn_started", turn_id: "audit-turn" },
      { type: "text_chunk", content: longAnswer },
      { type: "text_commit" },
      { type: "result", assistant_message: longAnswer, message_history: [] },
      { type: "done" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n")
    await page.route("**/api/ai/spending-chat/stream", (route) =>
      route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${body}\n` }),
    )
    await page.goto("/assistant")
    const input = page.getByRole("textbox", { name: "Message the spending assistant" })
    await input.click()
    await input.fill("Show the full audit")
    const send = page.getByRole("button", { name: "Send" })
    await expectTouchTargets([["Assistant Send", send]])
    await send.click()
    await expect(
      page.getByRole("log", { name: "Conversation" }).getByText("Audit spending detail 60."),
    ).toBeAttached()
    await expectTouchTargets([
      ["Assistant Scroll to latest", page.getByRole("button", { name: "Scroll to latest message" })],
    ])
    await capture(page, "assistant-scroll-latest.png")
  })
})
