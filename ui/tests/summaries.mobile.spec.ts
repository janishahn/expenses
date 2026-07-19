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

  test("generates a real PDF and exposes the latest download", async ({ page }) => {
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
    await page.getByRole("button", { name: "Generate PDF Report" }).click()
    await expect(page.getByRole("link", { name: "Download latest PDF" })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByTestId("report-latest-pdf")).toContainText(".pdf")
  })
})
