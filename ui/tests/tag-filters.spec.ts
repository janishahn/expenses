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

  await createTransaction(isolated.request, isolated.csrfToken, {
    date: today,
    occurred_at: `${today}T10:00:00`,
    type: "expense",
    amount_cents: 9_000,
    category_id: category.id,
    title: `${marker} vacation`,
    tags: [vacationName],
  })
  await createTransaction(isolated.request, isolated.csrfToken, {
    date: today,
    occurred_at: `${today}T11:00:00`,
    type: "expense",
    amount_cents: 5_000,
    category_id: category.id,
    title: `${marker} project`,
    tags: [projectName],
  })
  await createTransaction(isolated.request, isolated.csrfToken, {
    date: today,
    occurred_at: `${today}T12:00:00`,
    type: "expense",
    amount_cents: 3_000,
    category_id: category.id,
    title: `${marker} regular`,
    tags: [],
  })

  await page.goto(
    `/transactions?period=this_month&tags=${tagIds[0]}&exclude_tags=${tagIds[1]}`,
  )
  await expect.poll(() => {
    const params = new URL(page.url()).searchParams
    return {
      excluded: params.get("exclude_tags"),
      hasIncluded: params.has("tags"),
    }
  }).toEqual({ excluded: String(tagIds[1]), hasIncluded: false })

  await page.goto(`/transactions?period=this_month&q=${encodeURIComponent(marker)}`)
  await page.getByRole("button", { name: "Tag", exact: true }).click()
  let filterPanel = page.getByRole("dialog", { name: "Tag filter" })
  for (const tagName of [vacationName, projectName]) {
    await expect(filterPanel.getByRole("checkbox", { name: tagName })).not.toBeChecked()
  }
  await filterPanel.getByRole("radio", { name: "Exclude" }).click()
  await expect(filterPanel.getByRole("radio", { name: "Exclude" })).toBeChecked()
  await filterPanel.getByRole("checkbox", { name: vacationName }).click()
  await filterPanel.getByRole("checkbox", { name: projectName }).click()
  await expect(filterPanel.getByRole("checkbox", { name: vacationName })).toBeChecked()
  await expect(filterPanel.getByRole("checkbox", { name: projectName })).toBeChecked()
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`))
  await page.keyboard.press("Escape")
  const list = page.getByRole("list", { name: "Transactions" })
  await expect(list.getByRole("listitem", { name: `${marker} vacation` })).toHaveCount(0)
  await expect(list.getByRole("listitem", { name: `${marker} project` })).toHaveCount(0)
  await expect(list.getByRole("listitem", { name: `${marker} regular` })).toBeVisible()
  await expect(page.getByRole("button", { name: "Excluding: 2 tags" })).toBeVisible()
  await page.getByRole("button", { name: "More actions" }).click()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "Export CSV" }).click()
  expect((await downloadPromise).url()).toMatch(
    new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`),
  )

  await page.getByRole("button", { name: "Excluding: 2 tags" }).click()
  filterPanel = page.getByRole("dialog", { name: "Tag filter" })
  await filterPanel.getByRole("radio", { name: "Only include" }).click()
  await expect(page).toHaveURL(new RegExp(`tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page).not.toHaveURL(/exclude_tags=/)
  await page.keyboard.press("Escape")
  await expect(list.getByRole("listitem", { name: `${marker} vacation` })).toBeVisible()
  await expect(list.getByRole("listitem", { name: `${marker} project` })).toBeVisible()
  await expect(list.getByRole("listitem", { name: `${marker} regular` })).toHaveCount(0)

  await page.goto("/?period=this_month")
  await page.getByRole("button", { name: "Filter", exact: true }).click()
  filterPanel = page.getByRole("dialog", { name: "Filter" })
  await filterPanel.getByRole("radio", { name: "Exclude" }).click()
  await filterPanel.getByRole("checkbox", { name: vacationName }).click()
  await filterPanel.getByRole("checkbox", { name: projectName }).click()
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`))
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Filter · 2" })).toBeVisible()
  const recent = page.getByRole("region", { name: "Recent" })
  await expect(recent.getByRole("listitem", { name: `${marker} regular` })).toBeVisible()
  await expect(recent.getByRole("listitem", { name: `${marker} vacation` })).toHaveCount(0)
  await expect(recent.getByRole("listitem", { name: `${marker} project` })).toHaveCount(0)

  // Chart drill-downs keep the tag scope.
  await page
    .getByRole("region", { name: "Spending by category" })
    .locator('[class*="_track_"] > span')
    .first()
    .click()
  await expect(page).toHaveURL(
    new RegExp(`/transactions\\?.*exclude_tags=${tagIds[0]}%2C${tagIds[1]}`),
  )

  await page.goto("/insights?period=this_month")
  await page.getByRole("button", { name: "Filter", exact: true }).click()
  filterPanel = page.getByRole("dialog", { name: "Filter" })
  await filterPanel.getByRole("checkbox", { name: vacationName }).click()
  await filterPanel.getByRole("checkbox", { name: projectName }).click()
  await expect(page).toHaveURL(new RegExp(`tags=${tagIds[0]}%2C${tagIds[1]}`))
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Filter · 2" })).toBeVisible()
  await expect(page.getByText("Spent", { exact: true }).first().locator("..")).toContainText("140,00 €")

  await isolated.request.dispose()
})
