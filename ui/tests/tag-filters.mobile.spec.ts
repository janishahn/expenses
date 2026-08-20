import { expect, test } from "./fixtures"
import { createTransaction, loginAsIsolatedUser } from "./helpers"

test("uses the unified multi-tag filter from each mobile sheet", async ({ page }) => {
  await page.goto("/")
  const isolated = await loginAsIsolatedUser(page)
  const stamp = Date.now()
  const marker = `Mobile tag scope ${stamp}`
  const vacationName = `Mobile vacation ${stamp}`
  const projectName = `Mobile project ${stamp}`
  const today = new Date().toISOString().slice(0, 10)
  const categoryResponse = await isolated.request.post("/api/categories", {
    headers: { "X-CSRF-Token": isolated.csrfToken },
    data: { name: marker, type: "expense", order: 0 },
  })
  expect(categoryResponse.ok()).toBeTruthy()
  const category = (await categoryResponse.json()) as { id: number }

  const tagIds: number[] = []
  for (const name of [vacationName, projectName]) {
    const response = await isolated.request.post("/api/tags", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name, is_hidden_from_budget: false },
    })
    expect(response.ok()).toBeTruthy()
    tagIds.push(((await response.json()) as { id: number }).id)
  }

  const taggedIDs = await Promise.all([
    createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T10:00:00`,
      type: "expense",
      amount_cents: 9_000,
      category_id: category.id,
      title: `${marker} vacation`,
      tags: [vacationName],
    }),
    createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T11:00:00`,
      type: "expense",
      amount_cents: 5_000,
      category_id: category.id,
      title: `${marker} project`,
      tags: [projectName],
    }),
  ])
  const regularID = await createTransaction(isolated.request, isolated.csrfToken, {
    date: today,
    occurred_at: `${today}T12:00:00`,
    type: "expense",
    amount_cents: 3_000,
    category_id: category.id,
    title: `${marker} regular`,
    tags: [],
  })

  await page.goto(`/transactions?period=this_month&q=${encodeURIComponent(marker)}`)
  await page.getByRole("button", { name: /Filters/ }).click()
  let sheet = page.getByRole("dialog", { name: "Filter transactions" })
  await sheet.getByRole("button", { name: "Exclude" }).click()
  await sheet.getByRole("checkbox", { name: vacationName }).check()
  await sheet.getByRole("checkbox", { name: projectName }).check()
  await sheet.getByRole("button", { name: "Apply" }).last().click()
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page.getByTestId(`transaction-row-${taggedIDs[0]}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${taggedIDs[1]}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${regularID}`)).toBeVisible()

  await page.goto("/?period=this_month")
  const dashboardTagTrigger = page.getByRole("button", {
    name: "Filter dashboard by tags",
  })
  await expect(dashboardTagTrigger).toBeVisible()
  const [tagTriggerBox, themeTriggerBox] = await Promise.all([
    dashboardTagTrigger.boundingBox(),
    page.locator('[data-testid="shell-theme-quick-toggle"]:visible').boundingBox(),
  ])
  expect(tagTriggerBox).not.toBeNull()
  expect(themeTriggerBox).not.toBeNull()
  expect(Math.abs(tagTriggerBox!.height - themeTriggerBox!.height)).toBeLessThan(0.01)
  expect(Math.abs(tagTriggerBox!.width - themeTriggerBox!.width)).toBeLessThan(0.01)

  await dashboardTagTrigger.click()
  sheet = page.getByRole("dialog", { name: "Filter dashboard by tags" })
  await sheet.getByRole("button", { name: "Exclude" }).click()
  await sheet.getByRole("checkbox", { name: vacationName }).check()
  await sheet.getByRole("button", { name: "Apply" }).click()
  await expect(page.getByRole("button", { name: `Remove excluded tag ${vacationName}` })).toBeVisible()
  await expect(page.getByTestId("dashboard-recent-list")).not.toContainText(`${marker} vacation`)

  await page.goto("/insights?period=this_month")
  await page.getByRole("button", { name: /^Filters/ }).click()
  sheet = page.getByRole("dialog", { name: "Insights filters" })
  await sheet.getByRole("checkbox", { name: vacationName }).check()
  await sheet.getByRole("checkbox", { name: projectName }).check()
  await sheet.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(new RegExp(`tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page.getByRole("button", { name: `Remove Only: ${vacationName}` })).toBeVisible()
  await expect(page.getByRole("button", { name: `Remove Only: ${projectName}` })).toBeVisible()

  await isolated.request.dispose()
})
