import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Locator, type Page } from "./fixtures"
import { ensureElevatedAdmin } from "./auth-helpers"
import {
  createIngestTransaction,
  createTransaction,
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
const auditTheme = process.env.UI_POLISH_AUDIT_THEME === "dark" ? "dark" : "light"
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pfdvK0AAAAASUVORK5CYII=",
  "base64",
)

type ControlMeasurement = {
  label: string
  tag: string
  role: string | null
  tabIndex: number
  width: number
  height: number
}

type EffectiveTargetMeasurement = ControlMeasurement & {
  after: {
    content: string
    top: string
    right: string
    bottom: string
    left: string
  }
  generatedTarget: { width: number; height: number } | null
  enclosingLabel: { width: number; height: number } | null
  coarsePointer: boolean
}

async function measurement(label: string, locator: Locator): Promise<ControlMeasurement> {
  await expect(locator).toBeVisible()
  return locator.evaluate((element, controlLabel) => {
    const rect = element.getBoundingClientRect()
    return {
      label: controlLabel,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      tabIndex: (element as HTMLElement).tabIndex,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }, label)
}

async function effectiveTargetMeasurement(
  label: string,
  locator: Locator,
): Promise<EffectiveTargetMeasurement> {
  await expect(locator).toBeVisible()
  return locator.evaluate((element, controlLabel) => {
    const rect = element.getBoundingClientRect()
    const after = window.getComputedStyle(element, "::after")
    const number = (value: string) => {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const enclosingLabel = element.closest("label")?.getBoundingClientRect()
    const generatedTarget = after.content === "none"
      ? null
      : {
          width: Math.round(rect.width - number(after.left) - number(after.right)),
          height: Math.round(rect.height - number(after.top) - number(after.bottom)),
        }
    return {
      label: controlLabel,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      tabIndex: (element as HTMLElement).tabIndex,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      after: {
        content: after.content,
        top: after.top,
        right: after.right,
        bottom: after.bottom,
        left: after.left,
      },
      generatedTarget,
      enclosingLabel: enclosingLabel
        ? {
            width: Math.round(enclosingLabel.width),
            height: Math.round(enclosingLabel.height),
          }
        : null,
      coarsePointer: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
    }
  }, label)
}

function persist(name: string, payload: unknown) {
  if (!artifactDirectory) return
  mkdirSync(artifactDirectory, { recursive: true })
  writeFileSync(
    resolve(artifactDirectory, `${name}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
  )
}

async function capture(page: Page, name: string, fullPage = false) {
  if (!artifactDirectory) return
  mkdirSync(artifactDirectory, { recursive: true })
  await page.screenshot({
    path: resolve(artifactDirectory, name),
    fullPage,
  })
}

function expectDirectTouchTarget(control: ControlMeasurement) {
  expect(control.width, `${control.label} width`).toBeGreaterThanOrEqual(44)
  expect(control.height, `${control.label} height`).toBeGreaterThanOrEqual(44)
}

function expectEffectiveTouchTarget(control: EffectiveTargetMeasurement) {
  const width = Math.max(
    control.width,
    control.generatedTarget?.width ?? 0,
    control.enclosingLabel?.width ?? 0,
  )
  const height = Math.max(
    control.height,
    control.generatedTarget?.height ?? 0,
    control.enclosingLabel?.height ?? 0,
  )
  expect(width, `${control.label} effective width`).toBeGreaterThanOrEqual(44)
  expect(height, `${control.label} effective height`).toBeGreaterThanOrEqual(44)
}

async function useAuditTheme(page: Page) {
  await page.emulateMedia({ colorScheme: auditTheme, reducedMotion: "reduce" })
  await page.addInitScript(() => {
    window.localStorage.setItem("ew.theme.preference", theme)
  }, auditTheme)
}

test.describe("Mobile interaction audit evidence", () => {
  test("records Playwright full-page screenshot pointer-media behavior", async ({ page }) => {
    await useAuditTheme(page)
    await page.goto("/settings")
    const readInputMedia = (target: Page) =>
      target.evaluate(() => ({
        coarse: window.matchMedia("(hover: none) and (pointer: coarse)").matches,
        anyCoarse: window.matchMedia("(any-hover: none) and (any-pointer: coarse)").matches,
        maxTouchPoints: navigator.maxTouchPoints,
      }))
    const before = await readInputMedia(page)
    await capture(page, "pointer-media-full-page-probe.png", true)
    const after = await readInputMedia(page)
    await page.goto("/reports/builder")
    const reportAfter = await readInputMedia(page)
    const freshPage = await page.context().newPage()
    await freshPage.goto("/reports/builder")
    const freshPageAfter = await readInputMedia(freshPage)
    await freshPage.close()
    persist("pointer-media-full-page-probe", {
      before,
      after,
      reportAfter,
      freshPageAfter,
    })
  })

  test("measures populated compact actions and modal close controls", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page)
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    request = isolated.request
    const token = isolated.csrfToken
    const suffix = `${Date.now()}`
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      `Audit compact ${suffix}`,
    )
    const templateName = `Audit compact template ${suffix}`
    const templateResponse = await request.post("/api/templates", {
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
    expect(templateResponse.ok()).toBeTruthy()

    const controls: ControlMeasurement[] = []
    await page.goto("/transactions")
    controls.push(
      await measurement(
        "Mobile page menu trigger",
        page.getByRole("button", { name: "Open menu" }),
      ),
    )
    await page.goto("/assistant")
    controls.push(
      await measurement(
        "Assistant page menu trigger",
        page.getByRole("button", { name: "Open menu" }),
      ),
    )

    await page.goto("/categories")
    const categoryLibrary = page.getByTestId("category-library")
    controls.push(
      await measurement(
        "Category edit",
        categoryLibrary.getByRole("button", { name: `Edit Audit compact ${suffix}` }),
      ),
      await measurement(
        "Category archive",
        categoryLibrary.getByRole("button", { name: `Archive Audit compact ${suffix}` }),
      ),
    )

    await page.goto("/templates")
    const templateRow = page.getByTestId("template-row").filter({
      hasText: templateName,
    })
    controls.push(
      await measurement(
        "Template reorder",
        templateRow.getByRole("button", { name: `Reorder ${templateName}` }),
      ),
      await measurement(
        "Template edit",
        templateRow.getByRole("button", { name: `Edit ${templateName}` }),
      ),
      await measurement(
        "Template delete",
        templateRow.getByRole("button", { name: `Delete ${templateName}` }),
      ),
    )
    await page.getByRole("button", { name: "Add template" }).first().click()
    controls.push(
      await measurement(
        "Template editor close",
        page.getByRole("button", { name: "Close template editor" }),
      ),
    )
    await page.getByRole("button", { name: "Close template editor" }).click()

    const ruleName = `Audit compact rule ${suffix}`
    await page.goto("/rules")
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const addRuleDialog = page.getByRole("dialog", { name: "Add rule" })
    await addRuleDialog.getByLabel("Name").fill(ruleName)
    await addRuleDialog.getByLabel("Title text").fill(`compact-${suffix}`)
    await addRuleDialog.getByRole("button", { name: "Add rule" }).click()
    const ruleCard = page.getByTestId("automation-rule").filter({ hasText: ruleName })
    controls.push(
      await measurement(
        "Rule edit",
        ruleCard.getByRole("button", { name: `Edit ${ruleName}` }),
      ),
      await measurement(
        "Rule delete",
        ruleCard.getByRole("button", { name: `Delete ${ruleName}` }),
      ),
    )

    await page.goto("/scenarios")
    await page.getByLabel("Adjustment type").selectOption("one_time")
    await page.getByLabel("Name").fill(`Audit adjustment ${suffix}`)
    const nextMonth = new Date()
    nextMonth.setMonth(nextMonth.getMonth() + 1, 1)
    await page
      .getByRole("textbox", { name: "Month", exact: true })
      .fill(
        `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`,
      )
    await page.getByLabel("Amount").fill("12.34")
    await page.getByRole("button", { name: "Add adjustment" }).click()
    controls.push(
      await measurement(
        "Scenario adjustment delete",
        page.getByRole("button", { name: "Delete adjustment" }),
      ),
    )

    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 2_145,
      category_id: categoryId,
      title: `Audit mobile transaction ${suffix}`,
      tags: [],
    })
    await page.goto("/transactions?period=all")
    const transactionTitle = page.getByRole("heading", { name: "Transactions" })
    const moreActions = page.getByRole("button", { name: "More actions" })
    const [titleBox, moreBox] = await Promise.all([
      transactionTitle.boundingBox(),
      moreActions.boundingBox(),
    ])
    expect(titleBox).not.toBeNull()
    expect(moreBox).not.toBeNull()
    const transactionHeader = {
      title: titleBox,
      moreActions: moreBox,
      actionsShareTitleRow: moreBox!.y < titleBox!.y + titleBox!.height,
    }
    controls.push(await measurement("Transactions more actions", moreActions))
    await capture(page, "transactions-wrapped-heading-actions.png")
    await page.getByRole("button", { name: /^Filters/ }).click()
    controls.push(
      await measurement(
        "Transaction filter sheet close",
        page.getByRole("button", { name: "Close filters" }),
      ),
    )
    await page.getByRole("button", { name: "Close filters" }).click()
    const transactionRow = page.getByTestId(`transaction-row-${transactionId}`)
    const transactionCheckbox = transactionRow.getByRole("checkbox", {
      name: `Select transaction ${transactionId}`,
    })
    await transactionCheckbox.check()
    const transactionCheckboxLabel = await transactionCheckbox
      .locator("xpath=ancestor::label")
      .boundingBox()
    expect(
      transactionCheckboxLabel?.width,
      "Transactions row checkbox label width",
    ).toBeGreaterThanOrEqual(44)
    expect(
      transactionCheckboxLabel?.height,
      "Transactions row checkbox label height",
    ).toBeGreaterThanOrEqual(44)
    controls.push(
      await measurement(
        "Transactions clear selection",
        page.getByTestId("transactions-selection-controls").getByRole("button", {
          name: "Clear selection",
        }),
      ),
    )

    const attachmentName = `audit-receipt-${suffix}.png`
    await uploadAttachment(request, token, transactionId, {
      name: attachmentName,
      mimeType: "image/png",
      buffer: onePixelPng,
    })
    await page.goto(`/transactions/${transactionId}/edit`)
    controls.push(
      await measurement(
        "Transaction attachment download",
        page.getByRole("button", { name: `Download ${attachmentName}` }),
      ),
      await measurement(
        "Transaction attachment delete",
        page.getByRole("button", { name: `Delete ${attachmentName}` }),
      ),
    )
    await capture(page, "transaction-edit-attachment-actions.png", true)

    const categoriesResponse = await request.get("/api/categories?period=all")
    const categoriesPayload = (await categoriesResponse.json()) as {
      categories: Array<{ id: number; name: string; type: string; archived_at: string | null }>
    }
    let uncategorizedId = categoriesPayload.categories.find(
      (category) =>
        category.type === "expense" &&
        category.archived_at === null &&
        category.name.trim().toLowerCase() === "uncategorized",
    )?.id
    if (!uncategorizedId) {
      const uncategorizedResponse = await request.post("/api/categories", {
        headers: { "X-CSRF-Token": token },
        data: { name: "Uncategorized", type: "expense", order: 0 },
      })
      expect(uncategorizedResponse.ok()).toBeTruthy()
      uncategorizedId = ((await uncategorizedResponse.json()) as { id: number }).id
    }
    const uncategorizedTransactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 1_234,
      category_id: uncategorizedId,
      title: `Audit inbox transaction ${suffix}`,
      tags: [],
    })
    await page.goto("/transactions/inbox?period=all")
    const inboxCheckbox = page
      .getByTestId(`uncategorized-row-${uncategorizedTransactionId}`)
      .getByRole("checkbox", { name: `Select transaction ${uncategorizedTransactionId}` })
    controls.push(await measurement("Uncategorized row checkbox", inboxCheckbox))
    await capture(page, "uncategorized-row-checkbox.png", true)

    const insightsPage = await page.context().newPage()
    await useAuditTheme(insightsPage)
    await insightsPage.goto("/insights")
    expect(
      await insightsPage.evaluate(() =>
        window.matchMedia("(hover: none) and (pointer: coarse)").matches,
      ),
    ).toBe(true)
    await insightsPage.getByRole("button", { name: /^Filters/ }).click()
    controls.push(
      await measurement(
        "Insights filter sheet close",
        insightsPage.getByRole("button", { name: "Close filters" }),
      ),
    )

    controls
      .filter((control) => control.label !== "Uncategorized row checkbox")
      .forEach(expectDirectTouchTarget)
    const inboxLabel = await inboxCheckbox.locator("xpath=ancestor::label").boundingBox()
    expect(inboxLabel?.width, "Uncategorized row checkbox label width").toBeGreaterThanOrEqual(44)
    expect(inboxLabel?.height, "Uncategorized row checkbox label height").toBeGreaterThanOrEqual(44)
    persist("compact-action-measurements", {
      viewport: page.viewportSize(),
      controls,
      transactionHeader,
      transactionCheckboxLabel,
      inboxCheckboxLabel: inboxLabel,
    })
    await capture(insightsPage, "insights-filter-close.png")
    await insightsPage.close()
    await isolated.request.dispose()
  })

  test("distinguishes compact visual boxes from effective mobile targets", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page)
    const token = await getCsrfToken(request)
    const suffix = `${Date.now()}`
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      `Audit target ${suffix}`,
    )
    const tagName = `Audit target tag ${suffix}`
    const suggestionTagName = `Audit suggestion tag ${suffix}`
    const secondSuggestionTagName = `Audit second suggestion tag ${suffix}`
    const tagResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": token },
      data: { name: tagName, is_hidden_from_budget: false },
    })
    expect(tagResponse.ok()).toBeTruthy()
    const suggestionTagResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": token },
      data: { name: suggestionTagName, is_hidden_from_budget: false },
    })
    expect(suggestionTagResponse.ok()).toBeTruthy()
    const secondSuggestionTagResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": token },
      data: { name: secondSuggestionTagName, is_hidden_from_budget: false },
    })
    expect(secondSuggestionTagResponse.ok()).toBeTruthy()

    const transactionId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 5_432,
      category_id: categoryId,
      title: `Audit target transaction ${suffix}`,
      tags: [tagName],
    })
    const recurringResponse = await request.post("/api/recurring", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: `Audit target recurring ${suffix}`,
        type: "expense",
        amount_cents: 4200,
        currency_code: "EUR",
        category_id: categoryId,
        anchor_date: new Date().toISOString().slice(0, 10),
        interval_unit: "month",
        interval_count: 1,
        next_occurrence: new Date().toISOString().slice(0, 10),
        end_date: null,
        auto_post: false,
        skip_weekends: false,
        month_day_policy: "snap_to_end",
      },
    })
    expect(recurringResponse.ok()).toBeTruthy()

    const controls: EffectiveTargetMeasurement[] = []
    await page.goto("/settings")
    controls.push(
      await effectiveTargetMeasurement(
        "Theme segmented option",
        page.getByRole("group", { name: "Theme mode" }).getByRole("button", {
          name: "Light",
        }),
      ),
    )

    await page.goto("/transactions?period=this_month&type=expense")
    controls.push(
      await effectiveTargetMeasurement(
        "Active transaction type filter chip",
        page.getByRole("button", { name: "Remove Type: expense" }),
      ),
    )
    await capture(page, "active-filter-chip.png")

    await page.goto(`/transactions/${transactionId}/edit`)
    controls.push(
      await effectiveTargetMeasurement(
        "Selected tag removal chip",
        page.getByRole("button", { name: `Remove tag ${tagName}` }),
      ),
      await effectiveTargetMeasurement(
        "Tag suggestion add chip",
        page.getByRole("button", { name: `Add tag ${suggestionTagName}` }),
      ),
      await effectiveTargetMeasurement(
        "Second tag suggestion add chip",
        page.getByRole("button", { name: `Add tag ${secondSuggestionTagName}` }),
      ),
      await effectiveTargetMeasurement(
        "Transaction edit breadcrumb",
        page.locator(".page-breadcrumb"),
      ),
    )
    const suggestionChipLayout = await Promise.all(
      [suggestionTagName, secondSuggestionTagName].map((name) =>
        page.getByRole("button", { name: `Add tag ${name}` }).evaluate((element) => {
          const target = element.getBoundingClientRect()
          const visual = element.firstElementChild?.getBoundingClientRect()
          return {
            target: {
              left: target.left,
              top: target.top,
              right: target.right,
              bottom: target.bottom,
              width: target.width,
              height: target.height,
            },
            visual: visual
              ? { width: visual.width, height: visual.height }
              : null,
          }
        }),
      ),
    )
    const [firstSuggestion, secondSuggestion] = suggestionChipLayout
    const suggestionsOverlap = !(
      firstSuggestion.target.right <= secondSuggestion.target.left ||
      secondSuggestion.target.right <= firstSuggestion.target.left ||
      firstSuggestion.target.bottom <= secondSuggestion.target.top ||
      secondSuggestion.target.bottom <= firstSuggestion.target.top
    )
    expect(suggestionsOverlap, "expanded suggestion-chip targets overlap").toBe(false)
    expect(firstSuggestion.visual?.height, "compact suggestion visual height").toBeLessThan(44)

    await page.goto("/")
    controls.push(
      await effectiveTargetMeasurement(
        "Dashboard spending month link",
        page.getByTestId("dashboard-spending-band-month").first(),
      ),
      await effectiveTargetMeasurement(
        "Dashboard recent transactions View all",
        page.getByRole("link", { name: "View all" }),
      ),
    )

    await page.goto("/recurring")
    const recurringRow = page
      .getByTestId("recurring-commitment")
      .filter({ hasText: `Audit target recurring ${suffix}` })
    controls.push(
      await effectiveTargetMeasurement(
        "Recurring auto-post switch",
        recurringRow.getByRole("switch", {
          name: `Toggle auto-post for Audit target recurring ${suffix}`,
        }),
      ),
      await effectiveTargetMeasurement(
        "Recurring History link",
        recurringRow.getByRole("link", { name: "History" }),
      ),
    )

    await page.goto("/reports/builder")
    controls.push(
      await effectiveTargetMeasurement(
        "Report running-balance switch",
        page
          .locator("label", { hasText: "Show running balance" })
          .locator('[data-slot="switch"]'),
      ),
      await effectiveTargetMeasurement(
        "Report section checkbox",
        page
          .getByRole("heading", { name: "Report sections" })
          .locator("xpath=following-sibling::*[1]")
          .getByRole("checkbox")
          .first(),
      ),
      await effectiveTargetMeasurement(
        "Report category-mode All radio",
        page.getByRole("radio", { name: "All" }),
      ),
      await effectiveTargetMeasurement(
        "Report category-mode Selected radio",
        page.getByRole("radio", { name: "Selected" }),
      ),
      await effectiveTargetMeasurement(
        "Report Include cents switch",
        page.getByRole("switch", { name: "Include cents in tables" }),
      ),
    )
    await page.getByRole("radio", { name: "Selected" }).check()
    controls.push(
      await effectiveTargetMeasurement(
        "Report selected category checkbox",
        page
          .getByRole("heading", { name: "Categories" })
          .locator("xpath=following-sibling::*[2]")
          .getByRole("checkbox")
          .first(),
      ),
    )

    persist("mobile-effective-target-measurements", {
      viewport: page.viewportSize(),
      controls,
      suggestionChipLayout,
      suggestionsOverlap,
    })
    controls.forEach(expectEffectiveTouchTarget)
    await capture(page, "report-control-effective-targets.png", true)
    const recurringEvidencePage = await page.context().newPage()
    await useAuditTheme(recurringEvidencePage)
    await recurringEvidencePage.goto("/recurring")
    await capture(recurringEvidencePage, "recurring-effective-targets.png", true)
    await recurringEvidencePage.close()
  })

  test("records mobile drawer and modal focus behavior", async ({ page }) => {
    await useAuditTheme(page)
    await page.goto("/transactions")

    const activeElement = () =>
      page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null
        if (!element) return null
        return {
          tag: element.tagName.toLowerCase(),
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
          ariaLabel: element.getAttribute("aria-label"),
          testId: element.getAttribute("data-testid"),
          insideMenu: Boolean(element.closest('[aria-label="Application menu"]')),
          insideDialog: Boolean(element.closest('[role="dialog"]')),
          hiddenAncestor: Boolean(element.closest('[aria-hidden="true"]')),
        }
      })

    const menuTrigger = page.getByRole("button", { name: "Open menu" })
    await menuTrigger.focus()
    await menuTrigger.click()
    const menu = page.getByRole("complementary", { name: "Application menu" })
    await expect(menu).toBeVisible()
    const menuAfterOpen = await activeElement()
    const menuBodyOverflow = await page.evaluate(() => document.body.style.overflow)
    const menuTabSequence: Array<Awaited<ReturnType<typeof activeElement>>> = []
    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press("Tab")
      menuTabSequence.push(await activeElement())
    }
    await capture(page, "mobile-navigation-drawer-focus.png")
    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
    const menuAfterEscape = await activeElement()
    const overflowAfterMenuEscape = await page.evaluate(
      () => document.body.style.overflow,
    )

    await menuTrigger.click()
    await expect(menu).toBeVisible()
    const viewport = page.viewportSize()
    expect(viewport).not.toBeNull()
    await page.mouse.click(viewport!.width - 4, Math.round(viewport!.height / 2))
    await expect(menu).toBeHidden()
    const menuAfterBackdropDismiss = await activeElement()

    const addTrigger = page.getByRole("button", {
      name: "Add transaction",
      exact: true,
    })
    await addTrigger.focus()
    await addTrigger.click()
    const dialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(dialog).toBeVisible()
    const dialogAfterOpen = await activeElement()
    const dialogBodyOverflow = await page.evaluate(() => document.body.style.overflow)
    await capture(page, "mobile-add-transaction-dialog-focus.png")
    const dialogTabSequence: Array<Awaited<ReturnType<typeof activeElement>>> = []
    for (let index = 0; index < 24; index += 1) {
      await page.keyboard.press("Tab")
      dialogTabSequence.push(await activeElement())
    }
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    const dialogAfterEscape = await activeElement()
    const overflowAfterDialogEscape = await page.evaluate(
      () => document.body.style.overflow,
    )

    await page.goto("/categories")
    const categoryTrigger = page.getByRole("button", { name: "Add category" }).first()
    await categoryTrigger.focus()
    await categoryTrigger.click()
    const categoryDialog = page.getByRole("dialog", { name: "Add category" })
    await expect(categoryDialog).toBeVisible()
    const categoryDialogAfterOpen = await activeElement()
    await page.keyboard.press("Escape")
    await expect(categoryDialog).toBeHidden()
    const categoryDialogAfterEscape = await activeElement()

    await page.goto("/transactions")
    const filtersTrigger = page.getByRole("button", { name: /^Filters/ })
    await filtersTrigger.focus()
    await filtersTrigger.click()
    const filtersSheet = page.getByRole("dialog", { name: "Filter transactions" })
    await expect(filtersSheet).toBeVisible()
    const filtersSheetAfterOpen = await activeElement()
    await page.keyboard.press("Escape")
    await expect(filtersSheet).toBeHidden()
    const filtersSheetAfterEscape = await activeElement()

    const moreTrigger = page.getByRole("button", { name: "More actions" })
    await moreTrigger.focus()
    await moreTrigger.click()
    const moreMenu = page.getByRole("menu")
    await expect(moreMenu).toBeVisible()
    const moreMenuAfterOpen = await activeElement()
    const moreMenuItems = await moreMenu.getByRole("menuitem").allTextContents()
    await capture(page, "mobile-more-menu-focus.png")
    await page.keyboard.press("Escape")
    await expect(moreMenu).toBeHidden()
    const moreMenuAfterEscape = await activeElement()

    persist("mobile-overlay-focus-behavior", {
      viewport: page.viewportSize(),
      menu: {
        afterOpen: menuAfterOpen,
        bodyOverflow: menuBodyOverflow,
        tabSequence: menuTabSequence,
        leakedFocus: menuTabSequence.some((entry) => entry && !entry.insideMenu),
        afterEscape: menuAfterEscape,
        overflowAfterEscape: overflowAfterMenuEscape,
        afterBackdropDismiss: menuAfterBackdropDismiss,
      },
      dialog: {
        afterOpen: dialogAfterOpen,
        bodyOverflow: dialogBodyOverflow,
        tabSequence: dialogTabSequence,
        leakedFocus: dialogTabSequence.some((entry) => entry && !entry.insideDialog),
        afterEscape: dialogAfterEscape,
        overflowAfterEscape: overflowAfterDialogEscape,
      },
      controlledEditorDialog: {
        afterOpen: categoryDialogAfterOpen,
        afterEscape: categoryDialogAfterEscape,
      },
      controlledFilterSheet: {
        afterOpen: filtersSheetAfterOpen,
        afterEscape: filtersSheetAfterEscape,
      },
      moreMenu: {
        items: moreMenuItems,
        afterOpen: moreMenuAfterOpen,
        afterEscape: moreMenuAfterEscape,
      },
    })
  })

  test("measures dynamic form, navigation, and dialog targets", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page)
    const token = await getCsrfToken(request)
    const suffix = `${Date.now()}`
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      `Audit dynamic target ${suffix}`,
    )
    const templateName = `Audit dynamic template ${suffix}`
    const templateResponse = await request.post("/api/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        name: templateName,
        type: "expense",
        category_id: categoryId,
        default_amount_cents: null,
        title: null,
        tags: [],
      },
    })
    expect(templateResponse.ok()).toBeTruthy()

    const controls: EffectiveTargetMeasurement[] = []
    const ruleName = `Audit dynamic rule ${suffix}`
    await page.goto("/rules")
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const ruleDialog = page.getByRole("dialog", { name: "Add rule" })
    await ruleDialog.getByLabel("Name").fill(ruleName)
    await ruleDialog.getByLabel("Title text").fill(`dynamic-${suffix}`)
    controls.push(
      await effectiveTargetMeasurement(
        "Rule editor close",
        ruleDialog.getByRole("button", { name: "Close rule editor" }),
      ),
      await effectiveTargetMeasurement(
        "Rule editor enabled switch",
        ruleDialog.getByRole("switch"),
      ),
    )
    await ruleDialog.getByRole("button", { name: "Add rule" }).click()
    const ruleCard = page.getByTestId("automation-rule").filter({ hasText: ruleName })
    controls.push(
      await effectiveTargetMeasurement(
        "Rules library standalone enabled switch",
        ruleCard.getByRole("switch"),
      ),
    )

    await page.goto("/transactions")
    await page.getByRole("button", { name: "Add transaction", exact: true }).click()
    const addDialog = page.getByRole("dialog", { name: "Add transaction" })
    controls.push(
      await effectiveTargetMeasurement(
        "Global add transaction close",
        addDialog.getByRole("button", { name: "Close" }),
      ),
      await effectiveTargetMeasurement(
        "Global add transaction Manage templates",
        addDialog.getByRole("button", { name: "Manage" }),
      ),
    )
    await capture(page, "global-add-dynamic-targets.png")
    await page.keyboard.press("Escape")

    await stubOsmTiles(page)
    const locationTitle = `Audit dynamic location ${suffix}`
    await createIngestTransaction(request, {
      amount_cents: 1_234,
      title: locationTitle,
      date: new Date().toISOString().slice(0, 10),
      category: `Audit dynamic target ${suffix}`,
      latitude: 52.520008,
      longitude: 13.404954,
    })
    await page.goto(`/transactions?period=all&q=${encodeURIComponent(locationTitle)}`)
    await page.getByRole("button", { name: /View location/ }).click()
    const locationDialog = page.getByRole("dialog", { name: "Transaction location" })
    controls.push(
      await effectiveTargetMeasurement(
        "Transaction location dialog close",
        locationDialog.getByRole("button", { name: "Close transaction location" }),
      ),
      await effectiveTargetMeasurement(
        "Transaction location map zoom in",
        locationDialog.locator(".leaflet-control-zoom-in"),
      ),
      await effectiveTargetMeasurement(
        "Transaction location map zoom out",
        locationDialog.locator(".leaflet-control-zoom-out"),
      ),
      await effectiveTargetMeasurement(
        "Transaction location map OpenStreetMap attribution",
        locationDialog.getByRole("link", { name: "OpenStreetMap" }),
      ),
    )
    await capture(page, "transaction-location-dialog-target.png")
    await page.keyboard.press("Escape")

    await page.goto("/insights")
    await page.getByRole("tab", { name: "Net", exact: true }).click()
    const chartData = page.getByRole("button", { name: "View chart data" })
    controls.push(
      await effectiveTargetMeasurement("Insights chart-data action", chartData),
    )
    await capture(page, "insights-net-data-target.png", true)
    await chartData.click()
    const chartDataDialog = page.getByRole("dialog", { name: "Chart data" })
    const chartDataClose = chartDataDialog.getByRole("button", {
      name: "Close chart data",
    })
    const chartDataCategory = chartDataDialog
      .getByRole("button", { name: /^Open .* transactions$/ })
      .first()
    controls.push(
      await effectiveTargetMeasurement("Insights chart-data close", chartDataClose),
      await effectiveTargetMeasurement(
        "Insights chart-data category action",
        chartDataCategory,
      ),
    )
    await capture(page, "insights-net-data-controls.png", true)
    await chartDataClose.click()

    const recurringPage = await page.context().newPage()
    await useAuditTheme(recurringPage)
    await recurringPage.goto("/recurring")
    expect(
      await recurringPage.evaluate(() =>
        window.matchMedia("(hover: none) and (pointer: coarse)").matches,
      ),
    ).toBe(true)
    await recurringPage.getByRole("button", { name: "Add rule" }).click()
    const recurringDialog = recurringPage.getByRole("dialog", { name: "Add rule" })
    controls.push(
      await effectiveTargetMeasurement(
        "Recurring editor close",
        recurringDialog.getByRole("button", { name: "Close rule editor" }),
      ),
      await effectiveTargetMeasurement(
        "Recurring editor auto-post switch",
        recurringDialog.getByRole("switch", { name: "Post automatically" }),
      ),
      await effectiveTargetMeasurement(
        "Recurring editor skip-weekends checkbox",
        recurringDialog.getByRole("checkbox"),
      ),
    )

    persist("dynamic-mobile-target-measurements", {
      viewport: page.viewportSize(),
      controls,
    })
    controls.forEach(expectEffectiveTouchTarget)
    await recurringPage.close()
  })

  test("measures budget and SQLite-import conditional controls", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page)
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    request = isolated.request
    const token = isolated.csrfToken
    const suffix = `${Date.now()}`
    const categoryName = `Audit conditional budget ${suffix}`
    const categoryId = await ensureCategory(
      request,
      token,
      "expense",
      categoryName,
    )
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`
    const templateResponse = await request.post("/api/budgets/templates", {
      headers: { "X-CSRF-Token": token },
      data: {
        frequency: "monthly",
        category_id: categoryId,
        amount_cents: 50_000,
        starts_on: monthStart,
        ends_on: null,
      },
    })
    expect(templateResponse.ok()).toBeTruthy()

    const controls: EffectiveTargetMeasurement[] = []
    await page.goto("/budgets")
    const budgetCard = page
      .getByTestId("budget-plan-card")
      .filter({ hasText: categoryName })
    await budgetCard.getByRole("button", { name: "View details" }).click()
    controls.push(
      await effectiveTargetMeasurement(
        "Budget compare-previous-month checkbox",
        budgetCard.getByRole("checkbox", { name: "Compare previous month" }),
      ),
    )
    await budgetCard.getByRole("button", { name: "Edit", exact: true }).click()
    const budgetDialog = page.getByRole("dialog", { name: `Edit ${categoryName}` })
    controls.push(
      await effectiveTargetMeasurement(
        "Budget editor close",
        budgetDialog.getByRole("button", { name: "Close budget editor" }),
      ),
      await effectiveTargetMeasurement(
        "Budget selected-month-only radio",
        budgetDialog.getByRole("radio", { name: /Only / }),
      ),
      await effectiveTargetMeasurement(
        "Budget selected-and-future radio",
        budgetDialog.getByRole("radio", { name: /and future months/ }),
      ),
    )
    await capture(page, "budget-editor-conditional-targets.png")
    await page.keyboard.press("Escape")

    await ensureElevatedAdmin(page)
    await page.route("**/api/import/sqlite/preview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "audit-preview-token",
          preview: {
            transactions_count: 3,
            recurring_count: 1,
            min_transaction_date: "2026-01-01",
            max_transaction_date: "2026-08-16",
            non_midnight_transaction_times: 1,
            warnings: ["Audit-only deterministic preview warning."],
            mapping_rows: [
              {
                idx: 0,
                legacy_type: "expense",
                legacy_category: "Legacy groceries",
                transaction_count: 3,
                suggested_category_id: categoryId,
                suggested_category_name: categoryName,
              },
            ],
            recurring_rows: [
              {
                description: "Legacy rent",
                legacy_type: "expense",
                legacy_category: "Legacy groceries",
                amount_cents: 50_000,
                start_date: "2026-01-01",
                recurrence_type: "monthly",
                interval: 1,
                last_processed_date: "2026-07-01",
                computed_next_occurrence: "2026-08-01",
              },
            ],
          },
          categories: [
            { id: categoryId, name: categoryName, type: "expense" },
          ],
        }),
      })
    })
    await page.goto("/admin/import")
    await page.getByLabel("SQLite database file").setInputFiles({
      name: "audit-preview.db",
      mimeType: "application/vnd.sqlite3",
      buffer: Buffer.from("audit-only intercepted sqlite preview"),
    })
    await page.getByRole("button", { name: "Preview SQLite" }).click()
    await expect(page.getByText("Options")).toBeVisible()
    const optionCheckboxes = page
      .locator("div", { has: page.getByText("Options", { exact: true }) })
      .last()
      .getByRole("checkbox")
    const optionCount = await optionCheckboxes.count()
    expect(optionCount).toBe(4)
    for (let index = 0; index < optionCount; index += 1) {
      controls.push(
        await effectiveTargetMeasurement(
          `SQLite import option ${index + 1}`,
          optionCheckboxes.nth(index),
        ),
      )
    }
    await capture(page, "sqlite-import-options-targets.png", true)

    persist("conditional-mobile-target-measurements", {
      viewport: page.viewportSize(),
      controls,
      sqlitePreviewEvidence: "intercepted UI-state fixture; no commit attempted",
    })
    controls.forEach(expectEffectiveTouchTarget)
    await isolated.request.dispose()
  })

  test("measures the populated reimbursement allocation action", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page)
    const token = await getCsrfToken(request)
    const suffix = `${Date.now()}`
    const expenseCategoryId = await ensureCategory(
      request,
      token,
      "expense",
      `Audit reimbursement expense ${suffix}`,
    )
    const incomeCategoryId = await ensureCategory(
      request,
      token,
      "income",
      `Audit reimbursement income ${suffix}`,
    )
    const expenseId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 4_200,
      category_id: expenseCategoryId,
      title: `Audit reimbursed expense ${suffix}`,
      tags: [],
    })
    const reimbursementId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "income",
      amount_cents: 4_200,
      category_id: incomeCategoryId,
      title: `Audit reimbursement ${suffix}`,
      tags: [],
      is_reimbursement: true,
    })
    const allocationResponse = await request.post(
      `/api/reimbursements/${reimbursementId}/allocations`,
      {
        headers: { "X-CSRF-Token": token },
        data: {
          expense_transaction_id: expenseId,
          amount_cents: 4_200,
        },
      },
    )
    expect(allocationResponse.ok()).toBeTruthy()

    await page.goto(`/transactions/${reimbursementId}/edit`)
    const removeAllocation = page.getByRole("button", { name: "Remove allocation" })
    const control = await effectiveTargetMeasurement(
      "Reimbursement allocation remove",
      removeAllocation,
    )
    const overflow = await page.evaluate(() => {
      const clientWidth = document.documentElement.clientWidth
      const scrollWidth = document.documentElement.scrollWidth
      const elements = Array.from(document.body.querySelectorAll("*"))
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(
          ({ element, rect }) =>
            !element.closest(".sr-only") &&
            rect.width > 0 &&
            rect.right > clientWidth + 1,
        )
        .slice(0, 20)
        .map(({ element, rect }) => ({
          tag: element.tagName.toLowerCase(),
          className: element.getAttribute("class") ?? "",
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) ?? "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: (element as HTMLElement).scrollWidth,
          clientWidth: (element as HTMLElement).clientWidth,
        }))
      return { clientWidth, scrollWidth, elements }
    })
    await capture(page, "reimbursement-allocation-action.png", true)
    persist("reimbursement-allocation-target", {
      viewport: page.viewportSize(),
      control,
      overflow,
    })
    expectEffectiveTouchTarget(control)
    expect(overflow.scrollWidth, "long select expanded the document").toBeLessThanOrEqual(
      overflow.clientWidth,
    )
  })

  test("keeps long Net labels readable and full names available", async ({
    page,
    request,
  }) => {
    await useAuditTheme(page)
    await page.goto("/")
    const isolated = await loginAsIsolatedUser(page)
    request = isolated.request
    const token = isolated.csrfToken
    const suffix = String(Date.now()).slice(-4)
    const incomeName = `Audit income shared-prefix alpha ${suffix}`
    const expenseName = `Audit expense shared-prefix beta ${suffix}`
    const incomeCategoryId = await ensureCategory(
      request,
      token,
      "income",
      incomeName,
    )
    const expenseCategoryId = await ensureCategory(
      request,
      token,
      "expense",
      expenseName,
    )
    const categoriesResponse = await request.get("/api/categories?period=all")
    expect(categoriesResponse.ok()).toBeTruthy()
    const categories = (await categoriesResponse.json()) as {
      categories: Array<{ id: number; name: string }>
    }
    const incomeLabel = categories.categories.find(
      (category) => category.id === incomeCategoryId,
    )?.name
    const expenseLabel = categories.categories.find(
      (category) => category.id === expenseCategoryId,
    )?.name
    expect(incomeLabel).toBeTruthy()
    expect(expenseLabel).toBeTruthy()
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

    await page.goto("/insights?period=this_month&view=net")
    await page.waitForLoadState("networkidle")
    const chart = page.getByRole("group", { name: "Income and spending chart" })
    await expect(chart).toBeVisible()
    await expect(
      chart.locator(`[data-waterfall-step][aria-label^="${incomeLabel}:"]`),
    ).toBeVisible()
    await expect(
      chart.locator(`[data-waterfall-step][aria-label^="${expenseLabel}:"]`),
    ).toBeVisible()
    await chart.scrollIntoViewIfNeeded()
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    await capture(page, "net-long-labels.png", true)
    await page.getByRole("button", { name: "View chart data" }).click()
    const dataView = page.getByRole("dialog", { name: "Chart data" })
    await expect(dataView).toContainText(incomeLabel as string)
    await expect(dataView).toContainText(expenseLabel as string)
    await capture(page, "net-long-labels-data-view.png", true)
    const amountCells = dataView.locator("tbody td:nth-child(2), tbody td:nth-child(3)")
    const amountCellCount = await amountCells.count()
    expect(amountCellCount).toBeGreaterThan(0)
    for (let index = 0; index < amountCellCount; index += 1) {
      await expect(amountCells.nth(index)).toHaveCSS("white-space", "nowrap")
    }
    persist("net-long-labels", {
      viewport: page.viewportSize(),
      theme: auditTheme,
      incomeLabel,
      expenseLabel,
      geometry,
    })
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
    await isolated.request.dispose()
  })

  test("measures the visible assistant return-to-latest control", async ({ page }) => {
    await useAuditTheme(page)
    const longAnswer = Array.from(
      { length: 60 },
      (_, index) => `Audit spending detail ${index + 1}.`,
    ).join("\n\n")
    const body = [
      { type: "turn_started", turn_id: "audit-turn" },
      { type: "text_chunk", content: longAnswer },
      { type: "text_commit" },
      {
        type: "result",
        assistant_message: longAnswer,
        message_history: [],
      },
      { type: "done" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n")

    await page.route("**/api/ai/spending-chat/stream", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: `${body}\n`,
      })
    })
    await page.goto("/assistant")
    await page.getByTestId("spending-assistant-input").fill("Show the full audit")
    await page.getByTestId("spending-assistant-send").click()
    await expect(
      page
        .getByTestId("spending-assistant-thread")
        .getByText("Audit spending detail 60."),
    ).toBeAttached()
    const control = page.getByTestId("spending-assistant-scroll-bottom")
    await expect
      .poll(() =>
        control.evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeGreaterThanOrEqual(39)
    const measured = await measurement("Assistant return to latest", control)
    persist("assistant-scroll-latest-measurement", {
      viewport: page.viewportSize(),
      control: measured,
    })
    expectDirectTouchTarget(measured)
    await capture(page, "assistant-scroll-latest.png")
  })
})
