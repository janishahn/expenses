import { expect, test, type Locator, type Page } from "./fixtures"
import {
  createTransaction,
  createUncategorizedExpense,
  ensureCategory,
  loginAsIsolatedUser,
  uploadAttachment,
} from "./helpers"

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
    } finally {
      await isolated.request.dispose()
    }
  })
})
