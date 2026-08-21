import { expect, test } from "./fixtures"
import { createTransaction, ensureCategory, getCsrfToken } from "./helpers"

test.describe("Summary and report surfaces (mobile)", () => {
  test(
    "navigates the weekly digest and renders its decision sections",
    async ({ page, request }) => {
      const csrfToken = await getCsrfToken(request)
      const categoryId = await ensureCategory(
        request,
        csrfToken,
        "expense",
        "Digest expense"
      )
      const now = new Date()
      const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-")
      await createTransaction(request, csrfToken, {
        date,
        occurred_at: `${date}T12:00:00`,
        type: "expense",
        amount_cents: 1250,
        category_id: categoryId,
        title: "Digest coverage",
        tags: [],
      })

      await page.goto("/digest")
      await expect(page.getByText("Total spent")).toBeVisible()
      await expect(page.getByTestId("digest-weekly-composition")).toBeVisible()
      const initialUrl = page.url()
      await page.getByRole("button", { name: "Previous week" }).click()
      await expect(page).not.toHaveURL(initialUrl)
    }
  )

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

    await page.addInitScript(() => {
      window.open = () => {
        const current = window.location.href
        return {
          location: { href: current },
          close() {},
        } as unknown as Window
      }
    })

    await page.goto("/reports/builder")
    const tagScope = page.getByRole("radiogroup", { name: "Tag scope" })
    await tagScope.getByRole("radio", { name: "Only include" }).check()
    await page.getByRole("checkbox", { name: tagName }).check()
    const reportRequestPromise = page.waitForRequest("**/api/reports/pdf")
    await page.getByRole("button", { name: "Generate PDF Report" }).click()
    const payload = (await reportRequestPromise).postDataJSON() as Record<string, unknown>
    expect(payload.tag_ids).toEqual([tagId])
    expect(payload.excluded_tag_ids).toEqual([])
    await expect(page.getByRole("link", { name: "Download latest PDF" })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId("report-latest-pdf")).toContainText(".pdf")
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

    await page.goto("/")
    await page.getByRole("button", { name: "Filters", exact: true }).click()
    const filters = page.getByRole("dialog", { name: "Dashboard filters" })
    await filters.getByRole("button", { name: "Exclude" }).click()
    await filters.getByRole("checkbox", { name: tagName }).check()
    await filters.getByRole("button", { name: "Apply" }).click()

    await expect(
      page.getByTestId("dashboard-spending-band-month").first(),
    ).toHaveAttribute("href", new RegExp(`exclude_tags=${tagId}`))
  })
})
