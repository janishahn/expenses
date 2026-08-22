import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

test.describe("Tag Detail Page", () => {
  test("updates, archives, restores, and deletes a tag", async ({ page, request }) => {
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
    await expect(page.getByTestId("donut-legend").first()).toBeVisible()
    const sparklines = page.locator("main path.recharts-line-curve")
    await expect(sparklines).toHaveCount(3)
    const expenseShape = await sparklines.nth(1).evaluate((path) => {
      const line = path as SVGPathElement
      const length = line.getTotalLength()
      const start = line.getPointAtLength(0)
      const middle = line.getPointAtLength(length / 2)
      const end = line.getPointAtLength(length)
      return {
        startToMiddle: Math.abs(start.y - middle.y),
        startToEnd: Math.abs(start.y - end.y),
      }
    })
    expect(expenseShape.startToMiddle).toBeLessThan(1)
    expect(expenseShape.startToEnd).toBeGreaterThan(10)
    const settings = page.getByTestId("tag-settings-inspector")
    await expect(settings).toContainText("Included in budgets")
    await expect(page.getByRole("dialog", { name: "Edit tag" })).toHaveCount(0)
    await expect(page.getByLabel("Name")).toHaveCount(0)

    const archiveAction = settings.getByRole("button", { name: "Archive" })
    const editAction = settings.getByRole("button", { name: "Edit tag" })
    await expect(archiveAction).toHaveText("")
    await expect(editAction).toHaveText("")
    const [archiveBox, editBox] = await Promise.all([
      archiveAction.boundingBox(),
      editAction.boundingBox(),
    ])
    expect(archiveBox).not.toBeNull()
    expect(editBox).not.toBeNull()
    expect(Math.abs(archiveBox!.y - editBox!.y)).toBeLessThanOrEqual(1)
    expect(
      await archiveAction.evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)")
    expect(
      await editAction.evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)")

    await editAction.click()
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

    const filterToggle = editDialog
      .locator("label", { hasText: "Hide from filter menus" })
      .getByRole("switch")
    await expect(filterToggle).toHaveAttribute("aria-checked", "false")
    await filterToggle.click()
    await expect(filterToggle).toHaveAttribute("aria-checked", "true")

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
    await expect(settings).toContainText("Hidden from filter menus")
    await expect(settings).toContainText("10.08.2026–17.08.2026")

    await archiveAction.click()
    await expect(page.locator("main")).toContainText("Archived")
    await expect(settings).toContainText("Lifecycle")
    await expect(settings).toContainText(/Archived \d{2}\.\d{2}\.\d{4}/)

    await page.goto("/tags?period=all")
    const archivedLibrary = page.getByTestId("archived-tag-library")
    await expect(archivedLibrary).toContainText(updatedName)
    await archivedLibrary.getByRole("link", { name: new RegExp(updatedName) }).click()
    await settings.getByRole("button", { name: "Restore" }).click()
    await expect(settings.getByRole("button", { name: "Archive" })).toBeVisible()
    await expect(settings).not.toContainText("Lifecycle")

    await settings.getByRole("button", { name: "Archive" }).click()
    await expect(settings.getByRole("button", { name: "Restore" })).toBeVisible()

    await settings.getByRole("button", { name: "Edit" }).click()
    await expect(editDialog.getByLabel("Start date")).toHaveValue("2026-08-10")
    await expect(editDialog.getByLabel("End date")).toHaveValue("2026-08-17")

    await editDialog.getByRole("button", { name: "Delete tag" }).click()
    await page
      .getByRole("dialog", { name: "Delete this tag?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click()
    await expect(page).toHaveURL("/tags")
    await expect(page.locator("body")).not.toContainText(updatedName)
  })
})
