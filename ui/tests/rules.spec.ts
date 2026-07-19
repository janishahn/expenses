import { test, expect, type Locator } from "./fixtures"
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

  test("should open the rule editor from the page action", async ({
    page,
  }) => {
    await expect(page.getByTestId("automation-rules-board")).toBeVisible()
    await expect(page.getByRole("dialog", { name: "Add rule" })).toBeHidden()
    await page.getByRole("button", { name: "Add rule" }).first().click()
    await expect(page.getByRole("dialog", { name: "Add rule" })).toBeVisible()
  })

  test("should toggle rule enabled state via switch", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    await ensureCategory(request, token, "expense", "E2E Toggle")

    const ruleName = `E2E Toggle ${Date.now()}`
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByLabel("Name").fill(ruleName)
    await dialog.getByLabel("Title text").fill("toggle-test")
    await dialog.getByRole("button", { name: "Add rule" }).click()
    await expect(page.locator("body")).toContainText(ruleName)

    const ruleCard = page.getByTestId("automation-rule").filter({ hasText: ruleName })
    const toggle = ruleCard.getByRole("switch")
    await expect(toggle).toBeVisible()
    const deleteButton = ruleCard.getByRole("button", { name: `Delete ${ruleName}` })
    await expect(deleteButton).toHaveClass(
      /btn-inline-danger/
    )
    await expect(deleteButton.locator("svg")).toBeVisible()
    await expect(ruleCard.locator("button").first()).toHaveAttribute("role", "switch")

    const initialState = await toggle.getAttribute("aria-checked")
    await toggle.click()
    await expect(toggle).toHaveAttribute(
      "aria-checked",
      initialState === "true" ? "false" : "true"
    )

    await ruleCard.getByRole("button", { name: `Edit ${ruleName}` }).click()
    const editDialog = page.getByRole("dialog", { name: "Edit rule" })
    await expect(editDialog.getByLabel("Name")).toHaveValue(ruleName)
    const updatedName = `${ruleName} Updated`
    await editDialog.getByLabel("Name").fill(updatedName)
    await editDialog.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByTestId("automation-rule").filter({ hasText: updatedName })).toBeVisible()
  })

  test("should keep editor toggle visually distinct across checked and unchecked states", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const editorToggle = page.getByRole("dialog", { name: "Add rule" })
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
    await page.getByRole("button", { name: "Add rule" }).first().click()
    const dialog = page.getByRole("dialog", { name: "Add rule" })
    await dialog.getByLabel("Name").fill(ruleName)
    await dialog.getByLabel("Title text").fill("acme-stream")
    await dialog.getByLabel("Set category (optional)").selectOption(
      String(targetCategoryId)
    )
    await dialog.getByLabel("Add tags (comma-separated)").fill("streaming,auto")
    await dialog.getByRole("button", { name: "Preview matches" }).click()
    await dialog.getByRole("button", { name: "Add rule" }).click()

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
