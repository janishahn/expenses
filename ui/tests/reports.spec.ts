import { readFileSync } from "node:fs"
import type { APIRequestContext, Page } from "@playwright/test"
import { test, expect } from "./fixtures"
import { createCategory, createTransaction, getCsrfToken } from "./helpers"

async function createTag(
  request: APIRequestContext,
  token: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const response = await request.post("/api/tags", {
    headers: { "X-CSRF-Token": token },
    data: { name, is_hidden_from_budget: false, ...extra },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { id: number }).id
}

// Generates the report and returns the request body the page sent; the PDF is rendered by the backend.
async function generate(page: Page): Promise<Record<string, unknown>> {
  const responsePromise = page.waitForResponse("**/api/reports/pdf")
  const popupPromise = page.waitForEvent("popup")
  await page.getByRole("button", { name: "Generate PDF" }).click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  const payload = response.request().postDataJSON() as Record<string, unknown>
  await (await popupPromise).close()
  await expect(page.getByRole("button", { name: "Generate PDF" })).toBeEnabled({
    timeout: 30_000,
  })
  return payload
}

async function chooseOptions(page: Page, comboboxName: string, names: string[]) {
  await page.getByRole("button", { name: new RegExp(`^Choose ${comboboxName}`) }).click()
  for (const name of names) {
    await page.getByRole("option", { name: new RegExp(name) }).click()
  }
  await page.keyboard.press("Escape")
}

test.describe("Report Builder Page", () => {
  test("generates a real PDF, opens it in a new tab and offers the download", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const categoryId = await createCategory(request, token, "expense", `E2E Report Pdf ${Date.now()}`)
    const today = new Date().toISOString().slice(0, 10)
    await createTransaction(request, token, {
      date: today,
      occurred_at: new Date().toISOString(),
      type: "expense",
      amount_cents: 4_200,
      category_id: categoryId,
      title: `Report pdf ${Date.now()}`,
      tags: [],
    })

    await page.goto("/reports/builder")
    const popupPromise = page.waitForEvent("popup")
    const responsePromise = page.waitForResponse("**/api/reports/pdf")
    await page.getByRole("button", { name: "Generate PDF" }).click()
    const popup = await popupPromise
    const response = await responsePromise
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("application/pdf")
    const filename = /filename="?([^";]+\.pdf)"?/.exec(
      response.headers()["content-disposition"] ?? "",
    )?.[1]
    expect(filename).toBeTruthy()
    await popup.close()

    const file = page.getByText(filename!, { exact: true })
    await expect(file).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/^Generated \d{2}:\d{2}$/)).toBeVisible()
    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("button", { name: "Download" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(filename)
    const downloaded = readFileSync(await download.path())
    expect(downloaded.length).toBeGreaterThan(0)
    expect(downloaded.subarray(0, 4).toString()).toBe("%PDF")
  })

  test("generates reports with include or exclude tag scope", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const suffix = Date.now()
    const tagName = `Report vacation ${suffix}`
    const categoryId = await createCategory(request, token, "expense", `Report category ${suffix}`)
    const tagId = await createTag(request, token, tagName)
    const today = new Date().toISOString().slice(0, 10)
    await createTransaction(request, token, {
      date: today,
      occurred_at: `${today}T12:00:00`,
      type: "expense",
      amount_cents: 4_200,
      category_id: categoryId,
      title: `Report tagged transaction ${suffix}`,
      tags: [tagName],
    })

    await page.goto("/reports/builder")
    const tagScope = page.getByRole("radiogroup", { name: "Tags" })
    await tagScope.getByRole("radio", { name: "Only include" }).click()
    await page.getByRole("button", { name: "Generate PDF" }).click()
    await expect(page.getByText("Select at least one tag.")).toBeVisible()
    await chooseOptions(page, "tags", [tagName])

    let payload = await generate(page)
    expect(payload.tag_ids).toEqual([tagId])
    expect(payload.excluded_tag_ids).toEqual([])

    await tagScope.getByRole("radio", { name: "Exclude" }).click()
    payload = await generate(page)
    expect(payload.tag_ids).toEqual([])
    expect(payload.excluded_tag_ids).toEqual([tagId])
  })
})
