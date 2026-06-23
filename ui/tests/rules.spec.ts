import { test, expect, type Locator } from "@playwright/test"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

async function readSwitchVisualState(toggle: Locator) {
  return toggle.evaluate((node) => {
    const thumb = node.querySelector<HTMLElement>("[data-slot='switch-thumb']")
    const switchStyle = window.getComputedStyle(node as HTMLElement)
    const thumbStyle = thumb ? window.getComputedStyle(thumb) : null
    return {
      state: node.getAttribute("data-state"),
      trackBackground: switchStyle.backgroundColor,
      trackBorder: switchStyle.borderColor,
      thumbBackground: thumbStyle?.backgroundColor ?? null,
      thumbTranslate: thumbStyle?.translate ?? null,
    }
  })
}

test.describe("Categorization Rules Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/rules")
  })

  test("should keep the inline editor as the desktop creation entry", async ({
    page,
  }) => {
    await expect(page.getByRole("button", { name: "Create rule" })).toBeHidden()
    await expect(page.getByText("Editor")).toBeVisible()
    const editorPosition = await page
      .locator("form", { has: page.getByRole("button", { name: "Save rule" }) })
      .evaluate((node) => getComputedStyle(node).position)
    expect(editorPosition).toBe("sticky")
  })

  test("should toggle rule enabled state via switch", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    await ensureCategory(request, token, "expense", "E2E Toggle")

    const ruleName = `E2E Toggle ${Date.now()}`
    await page.getByLabel("Name").fill(ruleName)
    await page.getByLabel("Title text").fill("toggle-test")
    await page.getByRole("button", { name: "Save rule" }).click()
    await expect(page.locator("body")).toContainText(ruleName)

    const ruleCard = page.locator("div.surface-card", { hasText: ruleName }).first()
    const toggle = ruleCard.getByRole("switch")
    await expect(toggle).toBeVisible()
    const deleteButton = ruleCard.getByRole("button", { name: "Delete" })
    await expect(deleteButton).toHaveClass(
      /btn-inline-danger/
    )
    await expect(deleteButton.locator("svg")).toBeVisible()

    const initialState = await toggle.getAttribute("aria-checked")
    await toggle.click()
    await expect(toggle).toHaveAttribute(
      "aria-checked",
      initialState === "true" ? "false" : "true"
    )
  })

  test("should keep editor toggle visually distinct across checked and unchecked states", async ({
    page,
  }) => {
    const editorToggle = page
      .locator("label", { hasText: "Apply this rule automatically" })
      .getByRole("switch")
    await expect(editorToggle).toBeVisible()
    await expect(editorToggle).toHaveAttribute("data-state", "checked")
    const checkedVisual = await readSwitchVisualState(editorToggle)

    await editorToggle.click()
    await expect(editorToggle).toHaveAttribute("data-state", "unchecked")
    await expect
      .poll(async () => (await readSwitchVisualState(editorToggle)).thumbTranslate)
      .not.toBe(checkedVisual.thumbTranslate)
    const uncheckedVisual = await readSwitchVisualState(editorToggle)

    expect(checkedVisual.trackBackground).not.toBe(uncheckedVisual.trackBackground)
    expect(checkedVisual.trackBorder).not.toBe(uncheckedVisual.trackBorder)
    expect(checkedVisual.thumbBackground).not.toBe(uncheckedVisual.thumbBackground)
    expect(checkedVisual.thumbTranslate).not.toBe(uncheckedVisual.thumbTranslate)
  })

  test("should create a rule and apply it to new transactions", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const uncategorizedId = await ensureCategory(
      request,
      token,
      "expense",
      "E2E Rule Source"
    )
    const targetCategoryId = await ensureCategory(
      request,
      token,
      "expense",
      "E2E Rule Target"
    )

    const ruleName = `E2E Rule ${Date.now()}`
    await page.getByLabel("Name").fill(ruleName)
    await page.getByLabel("Title text").fill("acme-stream")
    await page.getByLabel("Set category (optional)").selectOption(
      String(targetCategoryId)
    )
    await page.getByLabel("Add tags (comma-separated)").fill("streaming,auto")
    await page.getByRole("button", { name: "Preview matches" }).click()
    await page.getByRole("button", { name: "Save rule" }).click()

    await expect(page.locator("body")).toContainText(ruleName)

    const title = `acme-stream ${Date.now()}`
    const txnId = await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 2500,
      category_id: uncategorizedId,
      title,
      tags: [],
    })

    const response = await request.get(`/api/transactions/${txnId}`)
    expect(response.ok()).toBeTruthy()
    const payload = (await response.json()) as {
      category_id: number
      tags: string[]
    }
    expect(payload.category_id).toBe(targetCategoryId)
    expect(payload.tags).toContain("streaming")
  })
})
