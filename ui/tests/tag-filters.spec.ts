import { expect, test } from "./fixtures"
import { createTransaction, getCsrfToken, loginAsIsolatedUser } from "./helpers"

test("keeps archived and hidden filter visibility independent", async ({
  page,
  request,
}) => {
  const token = await getCsrfToken(request)
  const stamp = Date.now()
  const archivedName = `Archived vacation ${stamp}`
  const hiddenName = `Hidden filter tag ${stamp}`

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
  await page.getByRole("button", { name: `Only: ${hiddenName}` }).click()
  let filterPanel = page.getByRole("dialog", { name: "Tag filter" })
  await expect(filterPanel.getByRole("checkbox", { name: hiddenName })).toBeChecked()
  await expect(filterPanel.getByRole("checkbox", { name: archivedName })).toBeVisible()

  await filterPanel.getByRole("checkbox", { name: hiddenName }).click()
  await expect(page).not.toHaveURL(new RegExp(`[?&]tags=${hiddenId}(?:&|$)`))
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Tag", exact: true }).click()
  filterPanel = page.getByRole("dialog", { name: "Tag filter" })
  await expect(filterPanel.getByText(hiddenName, { exact: true })).toHaveCount(0)
  await expect(filterPanel.getByText(archivedName, { exact: true })).toBeVisible()
})

test("restores excluded spending-band categories in their original stack order", async ({
  page,
}) => {
  await page.goto("/")
  const isolated = await loginAsIsolatedUser(page)
  const stamp = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  const tagNames = [`Band exclude A ${stamp}`, `Band exclude C ${stamp}`]
  const categoryNames = ["A", "B", "C", "D"].map(
    (label) => `Band order ${label} ${stamp}`,
  )

  for (const name of tagNames) {
    const response = await isolated.request.post("/api/tags", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name, is_hidden_from_budget: false },
    })
    expect(response.ok()).toBeTruthy()
  }

  const categoryIds: number[] = []
  for (const name of categoryNames) {
    const response = await isolated.request.post("/api/categories", {
      headers: { "X-CSRF-Token": isolated.csrfToken },
      data: { name, type: "expense", order: 0 },
    })
    expect(response.ok()).toBeTruthy()
    categoryIds.push(((await response.json()) as { id: number }).id)
  }

  for (const [index, amountCents] of [40_000, 30_000, 20_000, 10_000].entries()) {
    await createTransaction(isolated.request, isolated.csrfToken, {
      date: today,
      occurred_at: `${today}T${String(10 + index).padStart(2, "0")}:00:00`,
      type: "expense",
      amount_cents: amountCents,
      category_id: categoryIds[index],
      title: categoryNames[index],
      tags: index === 0 ? [tagNames[0]] : index === 2 ? [tagNames[1]] : [],
    })
  }

  await page.goto("/?period=this_month")
  const spending = page.getByRole("region", { name: "Spending by category" })
  // The table columns follow the legend order, which is the stack order of the bands.
  const categoryColumns = async () => {
    await spending.getByRole("button", { name: "Chart options" }).click()
    const toggle = page.getByRole("menuitemcheckbox", { name: "Show as table" })
    if ((await toggle.getAttribute("aria-checked")) === "false") await toggle.click()
    else await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toHaveCount(0)
    const headers = await spending.getByRole("columnheader").allTextContents()
    return headers.filter((name) => name.startsWith("Band order"))
  }
  const initialColumns = await categoryColumns()
  expect(initialColumns).toEqual(categoryNames)

  await page.getByRole("button", { name: "Filter", exact: true }).click()
  const filter = page.getByRole("dialog", { name: "Filter" })
  await filter.getByRole("radio", { name: "Exclude" }).click()
  for (const tagName of tagNames) {
    await filter.getByRole("checkbox", { name: tagName }).click()
  }
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Filter · 2" })).toBeVisible()
  await expect.poll(categoryColumns).toEqual([categoryNames[1], categoryNames[3]])

  await page.getByRole("button", { name: "Filter · 2" }).click()
  for (const tagName of tagNames) {
    await filter.getByRole("checkbox", { name: tagName }).click()
  }
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible()
  await expect.poll(categoryColumns).toEqual(initialColumns)

  await isolated.request.dispose()
})

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
  const dashboardFilterTrigger = page.getByRole("button", {
    name: "Filter",
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
