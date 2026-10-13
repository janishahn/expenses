import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

test.describe("Summary and report surfaces (mobile)", () => {
  test("navigates the weekly digest and renders its sections", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const categoryName = `Digest expense ${Date.now()}`
    const categoryId = await ensureCategory(request, csrfToken, "expense", categoryName)
    await createTransaction(request, csrfToken, {
      date: "2019-03-05",
      occurred_at: "2019-03-05T12:00:00",
      type: "expense",
      amount_cents: 1250,
      category_id: categoryId,
      title: "Digest coverage",
      tags: [],
    })

    await page.goto("/digest?week_of=2019-03-04")
    await expect(page.getByRole("heading", { name: "Digest", level: 1 })).toBeVisible()
    const spent = page.getByText("Spent", { exact: true }).locator("..")
    await expect(spent).toContainText(/12,50\s?€/)
    await expect(spent).toContainText("1 transaction")
    for (const name of ["Top categories", "Budgets", "Unusual", "Auto-posted"]) {
      await expect(page.getByRole("heading", { name })).toBeVisible()
    }
    await expect(
      page.getByRole("list", { name: "Top categories" }).getByRole("listitem", { name: categoryName }),
    ).toBeVisible()

    const week = page.getByRole("group", { name: "Week" })
    await week.getByRole("button", { name: "Previous week" }).click()
    await expect(page).toHaveURL(/week_of=2019-02-25/)
    await expect(page.getByText("No spending this week.").first()).toBeVisible()
    await week.getByRole("button", { name: "Next week" }).click()
    await expect(page).toHaveURL(/week_of=2019-03-04/)

    await page
      .getByRole("list", { name: "Top categories" })
      .getByRole("listitem", { name: categoryName })
      .tap()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*category=${categoryId}`))
  })

  test("generates a tag-scoped real PDF and exposes the latest download", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const tagName = `Mobile report tag ${suffix}`
    const categoryId = await ensureCategory(
      request,
      csrfToken,
      "expense",
      `Mobile report category ${suffix}`
    )
    const tagResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": csrfToken },
      data: { name: tagName, is_hidden_from_budget: false },
    })
    expect(tagResponse.ok()).toBeTruthy()
    const tagId = ((await tagResponse.json()) as { id: number }).id
    const today = new Date().toISOString().slice(0, 10)
    await createTransaction(request, csrfToken, {
      date: today,
      occurred_at: `${today}T12:00:00`,
      type: "expense",
      amount_cents: 2_500,
      category_id: categoryId,
      title: `Mobile report transaction ${suffix}`,
      tags: [tagName],
    })

    await page.goto("/reports/builder")
    await page
      .getByRole("radiogroup", { name: "Tags" })
      .getByRole("radio", { name: "Only include" })
      .tap()
    await page.getByRole("button", { name: /^Choose tags/ }).tap()
    await page.getByRole("option", { name: new RegExp(tagName) }).tap()
    await page.keyboard.press("Escape")
    const requestPromise = page.waitForRequest("**/api/reports/pdf")
    const responsePromise = page.waitForResponse("**/api/reports/pdf")
    const popupPromise = page.waitForEvent("popup")
    await page.getByRole("button", { name: "Generate PDF" }).tap()
    const payload = (await requestPromise).postDataJSON() as Record<string, unknown>
    expect(payload.tag_ids).toEqual([tagId])
    expect(payload.excluded_tag_ids).toEqual([])
    const popup = await popupPromise
    const response = await responsePromise
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("application/pdf")
    const filename = /filename="?([^";]+\.pdf)"?/.exec(
      response.headers()["content-disposition"] ?? "",
    )?.[1]
    expect(filename).toBeTruthy()
    expect((await response.body()).length).toBeGreaterThan(0)
    await popup.close()
    await expect(page.getByText(filename!, { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible()
  })

  test("keeps the dashboard tag scope in spending-band drill-downs", async ({
    page,
    request,
  }) => {
    const csrfToken = await getCsrfToken(request)
    const suffix = Date.now()
    const tagName = `Mobile dashboard tag ${suffix}`
    const categoryId = await ensureCategory(
      request,
      csrfToken,
      "expense",
      `Mobile dashboard category ${suffix}`,
    )
    const tagResponse = await request.post("/api/tags", {
      headers: { "X-CSRF-Token": csrfToken },
      data: { name: tagName, is_hidden_from_budget: false },
    })
    const tagId = ((await tagResponse.json()) as { id: number }).id
    const today = new Date().toISOString().slice(0, 10)
    await createTransaction(request, csrfToken, {
      date: today,
      occurred_at: `${today}T12:00:00`,
      type: "expense",
      amount_cents: 2_500,
      category_id: categoryId,
      title: `Mobile dashboard transaction ${suffix}`,
      tags: [tagName],
    })
    await createTransaction(request, csrfToken, {
      date: today,
      occurred_at: `${today}T13:00:00`,
      type: "expense",
      amount_cents: 1_200,
      category_id: categoryId,
      title: `Mobile dashboard untagged transaction ${suffix}`,
      tags: [],
    })

    await page.goto("/")
    await page.getByRole("button", { name: "Filter", exact: true }).click()
    const filters = page.getByRole("dialog", { name: "Filter" })
    await filters.getByRole("radio", { name: "Exclude" }).click()
    await filters.getByRole("checkbox", { name: tagName }).click()
    await expect(page).toHaveURL(new RegExp(`exclude_tags=${tagId}`))
    await page.keyboard.press("Escape")
    await expect(filters).toBeHidden()

    await page
      .getByRole("region", { name: "Spending by category" })
      .locator('[class*="_track_"] > span')
      .first()
      .tap()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*exclude_tags=${tagId}`))
  })
})
