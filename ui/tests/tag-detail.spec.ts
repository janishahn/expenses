import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

test.describe("Tag Detail Page", () => {
  test("should update and delete a tag", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const categoryId = await ensureCategory(request, token, "expense", "E2E Tag Detail")
    const originalName = `E2E Tag Detail ${Date.now()}`

    const createTagResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": token },
      data: { name: originalName, is_hidden_from_budget: false },
    })
    expect(createTagResponse.ok()).toBeTruthy()
    const createTagPayload = (await createTagResponse.json()) as { id: number }
    const tagId = createTagPayload.id

    await createTransaction(request, token, {
      date: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 4200,
      category_id: categoryId,
      title: `Tag detail seed ${Date.now()}`,
      tags: [originalName],
    })

    await page.goto(`/tags/${tagId}?period=all`)
    await expect(page.locator("main h1")).toContainText(originalName)
    const settings = page.getByTestId("tag-settings-inspector")
    await expect(settings).toContainText("Included in budgets")
    await expect(page.getByRole("dialog", { name: "Edit tag" })).toHaveCount(0)
    await expect(page.getByLabel("Name")).toHaveCount(0)

    await settings.getByRole("button", { name: "Edit" }).click()
    const editDialog = page.getByRole("dialog", { name: "Edit tag" })
    await expect(editDialog).toBeVisible()

    const budgetToggle = editDialog
      .locator("label", { hasText: "Exclude from budgets" })
      .getByRole("switch")
    await expect(budgetToggle).toBeVisible()
    const initialBudgetState = await budgetToggle.getAttribute("aria-checked")
    await budgetToggle.click()
    await expect(budgetToggle).toHaveAttribute(
      "aria-checked",
      initialBudgetState === "true" ? "false" : "true"
    )

    await editDialog
      .locator("label", { hasText: "Automatically add during a date range" })
      .getByRole("switch")
      .click()
    await editDialog.getByLabel("Start date").fill("2026-08-10")
    await editDialog.getByLabel("End date").fill("2026-08-17")

    const updatedName = `${originalName} Updated`
    await editDialog.getByLabel("Name").fill(updatedName)
    await editDialog.getByRole("button", { name: "Save" }).click()
    await expect(editDialog).toHaveCount(0)
    await expect(page.locator("main h1")).toContainText(updatedName)
    await expect(settings).toContainText("Excluded from budgets")
    await expect(settings).toContainText("10.08.2026–17.08.2026")

    await settings.getByRole("button", { name: "Edit" }).click()
    await expect(editDialog.getByLabel("Start date")).toHaveValue("2026-08-10")
    await expect(editDialog.getByLabel("End date")).toHaveValue("2026-08-17")

    page.once("dialog", (dialog) => dialog.accept())
    await editDialog.getByRole("button", { name: "Delete tag" }).click()
    await expect(page).toHaveURL("/tags")
    await expect(page.locator("body")).not.toContainText(updatedName)
  })
})
