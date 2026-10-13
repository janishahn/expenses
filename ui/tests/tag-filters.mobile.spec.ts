import { expect, test } from "./fixtures"
import {
  createTransaction,
  getCsrfToken,
  loginAsIsolatedUser,
} from "./helpers"

test("keeps archived and hidden filter visibility independent on mobile", async ({
  page,
  request,
}) => {
  const token = await getCsrfToken(request)
  const stamp = Date.now()
  const archivedName = `Mobile archived vacation ${stamp}`
  const hiddenName = `Mobile hidden filter tag ${stamp}`
  const archivedResponse = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name: archivedName, is_hidden_from_budget: false },
  })
  const archivedId = ((await archivedResponse.json()) as { id: number }).id
  const hiddenResponse = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: {
      name: hiddenName,
      is_hidden_from_budget: false,
      is_hidden_from_filters: true,
    },
  })
  const hiddenId = ((await hiddenResponse.json()) as { id: number }).id
  const archiveResponse = await request.post(`/api/tags/${archivedId}/archive`, {
    headers: { "X-CSRF-Token": token },
  })
  expect(archiveResponse.ok()).toBeTruthy()

  await page.goto(`/transactions?period=all&tags=${hiddenId}`)
  await expect(page.getByRole("button", { name: "Clear tag filter" })).toBeVisible()
  await page.getByRole("button", { name: /^Filter/ }).tap()
  let sheet = page.getByRole("dialog", { name: "Filter" })
  await expect(sheet.getByRole("checkbox", { name: hiddenName })).toBeChecked()
  await expect(sheet.getByRole("checkbox", { name: archivedName })).toBeVisible()

  await sheet.getByRole("checkbox", { name: hiddenName }).click()
  await expect(page).not.toHaveURL(new RegExp(`[?&]tags=${hiddenId}(?:&|$)`))
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()

  await page.getByRole("button", { name: /^Filter/ }).tap()
  sheet = page.getByRole("dialog", { name: "Filter" })
  await expect(sheet.getByText(hiddenName, { exact: true })).toHaveCount(0)
  await expect(sheet.getByText(archivedName, { exact: true })).toBeVisible()
})

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

  await Promise.all([
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
  await createTransaction(isolated.request, isolated.csrfToken, {
    date: today,
    occurred_at: `${today}T12:00:00`,
    type: "expense",
    amount_cents: 3_000,
    category_id: category.id,
    title: `${marker} regular`,
    tags: [],
  })

  await page.goto(`/transactions?period=this_month&q=${encodeURIComponent(marker)}`)
  await page.getByRole("button", { name: "Filter", exact: true }).tap()
  let sheet = page.getByRole("dialog", { name: "Filter" })
  for (const tagName of [vacationName, projectName]) {
    const checkbox = sheet.getByRole("checkbox", { name: tagName })
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
  await sheet.getByRole("checkbox", { name: vacationName }).click()
  await expect(sheet.getByRole("checkbox", { name: vacationName })).toBeChecked()
  await sheet.getByRole("checkbox", { name: projectName }).click()
  await expect(sheet.getByRole("checkbox", { name: projectName })).toBeChecked()
  await expect(page).toHaveURL(new RegExp(`tags=${tagIds[0]}%2C${tagIds[1]}`))
  await sheet.getByRole("radio", { name: "Exclude" }).tap()
  await expect(sheet.getByRole("radio", { name: "Exclude" })).toBeChecked()
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page).not.toHaveURL(/[?&]tags=/)
  await page.keyboard.press("Escape")
  const list = page.getByRole("list", { name: "Transactions" })
  await expect(list.getByRole("listitem", { name: `${marker} vacation` })).toHaveCount(0)
  await expect(list.getByRole("listitem", { name: `${marker} project` })).toHaveCount(0)
  await expect(list.getByRole("listitem", { name: `${marker} regular` })).toBeVisible()
  await expect(page.getByRole("button", { name: "Excluding: 2 tags" })).toBeVisible()

  await page.getByRole("button", { name: "Filter · 1" }).tap()
  sheet = page.getByRole("dialog", { name: "Filter" })
  await sheet.getByRole("radio", { name: "Only include" }).tap()
  await expect(page).toHaveURL(new RegExp(`tags=${tagIds[0]}%2C${tagIds[1]}`))
  await expect(page).not.toHaveURL(/exclude_tags=/)
  await page.keyboard.press("Escape")
  await expect(list.getByRole("listitem", { name: `${marker} vacation` })).toBeVisible()
  await expect(list.getByRole("listitem", { name: `${marker} project` })).toBeVisible()
  await expect(list.getByRole("listitem", { name: `${marker} regular` })).toHaveCount(0)

  await page.goto("/?period=this_month")
  const dashboardFilterTrigger = page.getByRole("button", {
    name: "Filter",
    exact: true,
  })
  await expect(dashboardFilterTrigger).toBeVisible()
  const [filterTriggerBox, periodBox] = await Promise.all([
    dashboardFilterTrigger.boundingBox(),
    page.getByRole("group", { name: "Period" }).boundingBox(),
  ])
  expect(filterTriggerBox).not.toBeNull()
  expect(periodBox).not.toBeNull()
  expect(Math.abs(filterTriggerBox!.height - periodBox!.height)).toBeLessThanOrEqual(1)

  await dashboardFilterTrigger.tap()
  sheet = page.getByRole("dialog", { name: "Filter" })
  await sheet.getByRole("radio", { name: "Exclude" }).tap()
  await sheet.getByRole("checkbox", { name: vacationName }).click()
  await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagIds[0]}(?:&|$)`))
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Filter · 1" })).toBeVisible()
  const recent = page.getByRole("region", { name: "Recent" })
  await expect(recent.getByRole("listitem", { name: `${marker} regular` })).toBeVisible()
  await expect(recent.getByRole("listitem", { name: `${marker} vacation` })).toHaveCount(0)

  await page.goto("/insights?period=this_month")
  await page.getByRole("button", { name: "Filter", exact: true }).tap()
  sheet = page.getByRole("dialog", { name: "Filter" })
  await sheet.getByRole("checkbox", { name: vacationName }).click()
  await sheet.getByRole("checkbox", { name: projectName }).click()
  await expect(page).toHaveURL(new RegExp(`tags=${tagIds[0]}%2C${tagIds[1]}`))
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Filter · 2" })).toBeVisible()
  await expect(page.getByText("Spent", { exact: true }).first().locator("..")).toContainText("140,00 €")

  await isolated.request.dispose()
})
