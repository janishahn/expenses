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

// Waits for the menu to leave, so the next menu opens after the previous one finished closing.
async function pickMenuItem(page: Page, name: string) {
  await page.getByRole("menuitemcheckbox", { name }).click()
  await expect(page.getByRole("menu")).toHaveCount(0)
}

async function chooseOptions(page: Page, comboboxName: string, names: string[]) {
  await page.getByRole("button", { name: new RegExp(`^Choose ${comboboxName}`) }).click()
  for (const name of names) {
    await page.getByRole("option", { name: new RegExp(name) }).click()
  }
  await page.keyboard.press("Escape")
}

test.describe("Report Builder Page", () => {
  test("shows the report options with their defaults", async ({ page }) => {
    await page.goto("/reports/builder")
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible()
    const sections = page.getByRole("group", { name: "Sections" })
    for (const name of ["Summary", "Category breakdown", "Transactions"]) {
      await expect(sections.getByRole("checkbox", { name })).toBeChecked()
    }
    for (const name of ["Top categories", "Trend", "Upcoming recurring"]) {
      await expect(sections.getByRole("checkbox", { name })).not.toBeChecked()
    }
    await expect(page.getByRole("switch", { name: "Running balance" })).not.toBeChecked()
    await expect(page.getByRole("switch", { name: "Category subtotals" })).not.toBeChecked()
    await expect(page.getByRole("switch", { name: "Cents in tables" })).toBeChecked()
    await expect(page.getByRole("radio", { name: "All" }).first()).toBeChecked()
    await expect(page.getByRole("button", { name: /^Sort/ })).toContainText("Newest first")
  })

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
    const downloaded = readFileSync((await download.path())!)
    expect(downloaded.length).toBeGreaterThan(0)
    expect(downloaded.subarray(0, 4).toString()).toBe("%PDF")
  })

  test("sends the chosen date range, type, notes and sections", async ({ page }) => {
    await page.goto("/reports/builder")
    await page.getByRole("button", { name: /^Date range/ }).click()
    const range = page.getByRole("dialog", { name: "Date range" })
    await range.getByLabel("From").fill("2026-03-10")
    await range.getByLabel("Until").fill("2026-03-02")
    await range.getByRole("button", { name: "Save" }).click()
    await expect(range.getByText("The end must not be before the start.")).toBeVisible()
    await range.getByLabel("Until").fill("2026-03-20")
    await range.getByRole("button", { name: "Save" }).click()
    await expect(range).toHaveCount(0)

    await page.getByRole("radiogroup", { name: "Type" }).getByRole("radio", { name: "Expense" }).click()
    await page.getByRole("textbox", { name: "Notes" }).fill("  Quarterly check  ")
    const sections = page.getByRole("group", { name: "Sections" })
    await sections.getByRole("checkbox", { name: "Trend" }).check()
    await sections.getByRole("checkbox", { name: "Summary" }).uncheck()

    const payload = await generate(page)
    expect(payload.start).toBe("2026-03-10")
    expect(payload.end).toBe("2026-03-20")
    expect(payload.transaction_type).toBe("expense")
    expect(payload.notes).toBe("Quarterly check")
    expect(payload.sections).toEqual(["category_breakdown", "trend", "recent_transactions"])
  })

  test("asks for at least one section", async ({ page }) => {
    await page.goto("/reports/builder")
    const sections = page.getByRole("group", { name: "Sections" })
    for (const name of ["Summary", "Category breakdown", "Transactions"]) {
      await sections.getByRole("checkbox", { name }).uncheck()
    }
    await page.getByRole("button", { name: "Generate PDF" }).click()
    await expect(page.getByText("Select at least one report section.")).toBeVisible()
  })

  test("forces oldest-first sorting when running balance is enabled", async ({ page }) => {
    await page.goto("/reports/builder")
    await page.getByRole("button", { name: /^Sort/ }).click()
    await pickMenuItem(page, "Oldest first")
    await expect(page.getByRole("button", { name: /^Sort/ })).toContainText("Oldest first")
    await page.getByRole("button", { name: /^Sort/ }).click()
    await pickMenuItem(page, "Newest first")

    await page.getByRole("switch", { name: "Running balance" }).click()
    await expect(page.getByText("Oldest first, for the running balance")).toBeVisible()
    await expect(page.getByRole("button", { name: /^Sort/ })).toHaveCount(0)
    const payload = await generate(page)
    expect(payload.show_running_balance).toBe(true)
    expect(payload.transactions_sort).toBe("oldest")
  })

  test("sends the category selection and the table options", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const keep = `E2E Report Keep ${stamp}`
    const other = `E2E Report Other ${stamp}`
    const keepId = await createCategory(request, token, "expense", keep)
    await createCategory(request, token, "expense", other)

    await page.goto("/reports/builder")
    await page.getByRole("radiogroup", { name: "Categories" }).getByRole("radio", { name: "Selected" }).click()
    await chooseOptions(page, "categories", [keep])
    await expect(page.getByRole("button", { name: "Choose categories, 1 chosen" })).toBeVisible()
    await page.getByRole("switch", { name: "Cents in tables" }).click()
    await page.getByRole("switch", { name: "Category subtotals" }).click()

    const payload = await generate(page)
    expect(payload.category_ids).toEqual([keepId])
    expect(payload.include_cents).toBe(false)
    expect(payload.include_category_subtotals).toBe(true)
  })

  test("lists categories that another page already loaded", async ({ page, request }) => {
    const token = await getCsrfToken(request)
    const name = `E2E Report Cached ${Date.now()}`
    await createCategory(request, token, "expense", name)

    // Templates fills the category options cache that the Report Builder shares.
    const loaded = page.waitForResponse("**/api/categories/options")
    await page.goto("/templates")
    await loaded
    await page.evaluate(() => {
      window.history.pushState({}, "", "/reports/builder")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    await page.getByRole("radiogroup", { name: "Categories" }).getByRole("radio", { name: "Selected" }).click()
    await chooseOptions(page, "categories", [name])
    await expect(page.getByRole("button", { name: "Choose categories, 1 chosen" })).toBeVisible()
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

  test("offers archived tags but omits tags hidden from filter menus", async ({
    page,
    request,
  }) => {
    const token = await getCsrfToken(request)
    const stamp = Date.now()
    const archivedName = `Report archived vacation ${stamp}`
    const hiddenName = `Report hidden tag ${stamp}`
    const archivedId = await createTag(request, token, archivedName)
    await createTag(request, token, hiddenName, { is_hidden_from_filters: true })
    const archiveResponse = await request.post(`/api/tags/${archivedId}/archive`, {
      headers: { "X-CSRF-Token": token },
    })
    expect(archiveResponse.ok()).toBeTruthy()

    await page.goto("/reports/builder")
    await page.getByRole("radiogroup", { name: "Tags" }).getByRole("radio", { name: "Only include" }).click()
    await page.getByRole("button", { name: /^Choose tags/ }).click()
    const archived = page.getByRole("option", { name: new RegExp(archivedName) })
    await expect(archived).toBeVisible()
    await expect(archived).toContainText("Archived")
    await expect(page.getByRole("option", { name: new RegExp(hiddenName) })).toHaveCount(0)
  })
})
