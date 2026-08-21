import { expect, test } from "./fixtures"
import { createTransaction, loginAsIsolatedUser } from "./helpers"

test("uses one multi-tag include or exclude filter across desktop data surfaces", async ({
  page,
}) => {
  await page.goto("/")
  const isolated = await loginAsIsolatedUser(page)
  const stamp = Date.now()
  const marker = `Tag scope ${stamp}`
  const vacationName = `Vacation ${stamp}`
  const projectName = `Project ${stamp}`
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

  const vacationID = await createTransaction(isolated.request, isolated.csrfToken, {
    date: today,
    occurred_at: `${today}T10:00:00`,
    type: "expense",
    amount_cents: 9_000,
    category_id: category.id,
    title: `${marker} vacation`,
    tags: [vacationName],
  })
  const projectID = await createTransaction(isolated.request, isolated.csrfToken, {
    date: today,
    occurred_at: `${today}T11:00:00`,
    type: "expense",
    amount_cents: 5_000,
    category_id: category.id,
    title: `${marker} project`,
    tags: [projectName],
  })
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
  await page.getByRole("button", { name: "Filters", exact: true }).click()
  let filterPanel = page.getByRole("dialog", { name: "Filter transactions" })
  for (const tagName of [vacationName, projectName]) {
    const checkbox = filterPanel.getByRole("checkbox", { name: tagName })
    await expect(checkbox).not.toBeChecked()
    expect(
      await checkbox.evaluate((element) => {
        const style = getComputedStyle(element)
        return (
          parseFloat(style.borderTopWidth) > 0 &&
          style.borderTopStyle !== "none" &&
          style.borderTopColor !== "transparent" &&
          style.borderTopColor !== "rgba(0, 0, 0, 0)"
        )
      }),
    ).toBe(true)
  }
  await filterPanel.getByRole("button", { name: "Exclude" }).click()
  await expect(filterPanel.getByRole("button", { name: "Exclude" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await filterPanel.getByRole("checkbox", { name: vacationName }).check()
  await filterPanel.getByRole("checkbox", { name: projectName }).check()
  await filterPanel.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page.getByTestId(`transaction-row-${vacationID}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${projectID}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${regularID}`)).toBeVisible()
  await expect(page.getByRole("button", { name: "Remove Excluding: 2 tags" })).toBeVisible()
  await page.getByRole("button", { name: "More actions" }).click()
  await expect(page.getByRole("menuitem", { name: "Export CSV" })).toHaveAttribute(
    "href",
    new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`),
  )
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: /^Filters/ }).click()
  filterPanel = page.getByRole("dialog", { name: "Filter transactions" })
  await filterPanel.getByRole("button", { name: "Only include" }).click()
  await filterPanel.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(new RegExp(`tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page.getByTestId(`transaction-row-${vacationID}`)).toBeVisible()
  await expect(page.getByTestId(`transaction-row-${projectID}`)).toBeVisible()
  await expect(page.getByTestId(`transaction-row-${regularID}`)).toHaveCount(0)

  await page.goto("/?period=this_month")
  const dashboardFilterTrigger = page.getByRole("button", {
    name: "Filters",
    exact: true,
  })
  const [filterTriggerBox, periodGroupBox] = await Promise.all([
    dashboardFilterTrigger.boundingBox(),
    page.getByRole("group", { name: "Period" }).boundingBox(),
  ])
  expect(filterTriggerBox).not.toBeNull()
  expect(periodGroupBox).not.toBeNull()
  expect(Math.abs(periodGroupBox!.height - filterTriggerBox!.height)).toBeLessThanOrEqual(1)

  await dashboardFilterTrigger.click()
  filterPanel = page.getByRole("dialog", { name: "Dashboard filters" })
  await filterPanel.getByRole("button", { name: "Exclude" }).click()
  await filterPanel.getByRole("checkbox", { name: vacationName }).check()
  await filterPanel.getByRole("checkbox", { name: projectName }).check()
  await filterPanel.getByRole("button", { name: "Apply" }).click()
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Remove Excluding: 2 tags" })).toBeVisible()
  await expect(page.getByTestId("dashboard-recent-list")).toContainText(`${marker} regular`)
  await expect(page.getByTestId("dashboard-recent-list")).not.toContainText(`${marker} vacation`)
  await expect(page.getByText(/Balance and budgets stay/)).toHaveCount(0)

  await page.goto(`/insights?period=this_month&tags=${tagIds.join(",")}`)
  await expect(page.getByRole("button", { name: "Remove Only: 2 tags" })).toBeVisible()
  await expect(page.getByText(/budget figures stay based on all activity/)).toHaveCount(0)

  await isolated.request.dispose()
})
