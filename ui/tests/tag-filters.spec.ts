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
  await page.getByRole("button", { name: /^Tags:/ }).click()
  await page.getByRole("menuitemradio", { name: "Exclude" }).click()
  await expect(page.getByRole("menuitemradio", { name: "Exclude" })).toHaveAttribute(
    "data-state",
    "checked",
  )
  await expect(page.getByRole("menuitemcheckbox", { name: vacationName })).toBeVisible()
  await page.getByRole("menuitemcheckbox", { name: vacationName }).click()
  await page.getByRole("menuitemcheckbox", { name: projectName }).click()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page.getByTestId(`transaction-row-${vacationID}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${projectID}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${regularID}`)).toBeVisible()
  await expect(page.getByRole("button", { name: `Remove excluded tag ${vacationName}` })).toBeVisible()
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`),
  )

  await page.getByRole("button", { name: /^Tags:/ }).click()
  await page.getByRole("menuitemradio", { name: "Only include" }).click()
  await expect(page.getByRole("menuitemcheckbox", { name: vacationName })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(new RegExp(`tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page.getByTestId(`transaction-row-${vacationID}`)).toBeVisible()
  await expect(page.getByTestId(`transaction-row-${projectID}`)).toBeVisible()
  await expect(page.getByTestId(`transaction-row-${regularID}`)).toHaveCount(0)

  await page.goto("/?period=this_month")
  const dashboardTagTrigger = page.getByRole("button", {
    name: "Filter dashboard by tags",
  })
  const [tagTriggerBox, addTransactionBox, periodGroupBox] = await Promise.all([
    dashboardTagTrigger.boundingBox(),
    page.getByRole("button", { name: "Add transaction" }).boundingBox(),
    page.getByRole("group", { name: "Period" }).boundingBox(),
  ])
  expect(tagTriggerBox).not.toBeNull()
  expect(addTransactionBox).not.toBeNull()
  expect(periodGroupBox).not.toBeNull()
  expect(Math.abs(tagTriggerBox!.height - addTransactionBox!.height)).toBeLessThan(0.01)
  expect(Math.abs(periodGroupBox!.height - tagTriggerBox!.height)).toBeLessThanOrEqual(4)

  await dashboardTagTrigger.click()
  await page.getByRole("menuitemradio", { name: "Exclude" }).click()
  await expect(page.getByRole("menuitemcheckbox", { name: vacationName })).toBeVisible()
  await page.getByRole("menuitemcheckbox", { name: vacationName }).click()
  await page.getByRole("menuitemcheckbox", { name: projectName }).click()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page.getByRole("button", { name: "Tag filter: Excluding 2 tags" })).toBeVisible()
  await expect(page.getByTestId("dashboard-recent-list")).toContainText(`${marker} regular`)
  await expect(page.getByTestId("dashboard-recent-list")).not.toContainText(`${marker} vacation`)
  await expect(page.getByText("Balance and budgets stay actual.")).toBeVisible()

  await page.goto(`/insights?period=this_month&tags=${tagIds.join(",")}`)
  await expect(page.getByRole("button", { name: `Remove included tag ${vacationName}` })).toBeVisible()
  await expect(page.getByRole("button", { name: `Remove included tag ${projectName}` })).toBeVisible()
  await expect(page.getByText(/budget figures stay based on all activity/)).toBeVisible()

  await isolated.request.dispose()
})
