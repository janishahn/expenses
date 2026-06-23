import { expect, test } from "@playwright/test"
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

    const budgetToggle = page
      .locator("label", { hasText: "Exclude from budgets" })
      .getByRole("switch")
    await expect(budgetToggle).toBeVisible()
    const initialBudgetState = await budgetToggle.getAttribute("aria-checked")
    await budgetToggle.click()
    await expect(budgetToggle).toHaveAttribute(
      "aria-checked",
      initialBudgetState === "true" ? "false" : "true"
    )

    const updatedName = `${originalName} Updated`
    await page.getByLabel("Name").fill(updatedName)
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.locator("main h1")).toContainText(updatedName)

    page.once("dialog", (dialog) => dialog.accept())
    await page.getByRole("button", { name: "Delete tag" }).click()
    await expect(page).toHaveURL("/tags")
    await expect(page.locator("body")).not.toContainText(updatedName)
  })
})
