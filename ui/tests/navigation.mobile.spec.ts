import { expect, test, type Page } from "./fixtures"

test.describe.configure({ mode: "parallel" })

function tabBar(page: Page) {
  return page.getByRole("navigation", { name: "Tabs" })
}

async function chooseMoreDestination(page: Page, label: string) {
  await tabBar(page).getByRole("button", { name: "More" }).click()
  const sheet = page.getByRole("dialog", { name: "More" })
  await expect(sheet).toBeVisible()
  await sheet.getByRole("link", { name: label, exact: true }).click()
  await expect(sheet).toBeHidden()
}

test.describe("Navigation (mobile)", () => {
  test("hides the tab bar while a dialog, sheet, or text field is active", async ({
    page,
  }) => {
    await page.goto("/transactions")
    const tabs = tabBar(page)
    await expect(tabs).toBeVisible()

    await page.getByRole("button", { name: "Add transaction" }).click()
    const addDialog = page.getByRole("dialog", { name: "Add transaction" })
    await expect(addDialog).toBeVisible()
    await addDialog.getByRole("button", { name: "Close" }).click()
    await expect(addDialog).toBeHidden()
    await expect(tabs).toBeVisible()

    await tabs.getByRole("button", { name: "More" }).click()
    const sheet = page.getByRole("dialog", { name: "More" })
    await expect(sheet).toBeVisible()
    await expect(tabs).toBeHidden()
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole("button", { name: "More" })).toBeFocused()

    await page.getByRole("button", { name: "Search", exact: true }).click()
    const search = page.getByRole("searchbox", { name: "Search transactions" })
    await expect(search).toBeFocused()
    await expect(tabs).toBeHidden()
    await search.blur()
    await expect(tabs).toBeVisible()
  })

  test("navigates non-tab routes through the More sheet", async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto("/")

    const routes = [
      { label: "Assistant", path: "/assistant", heading: "Assistant" },
      { label: "Forecast", path: "/forecast", heading: "Forecast" },
      { label: "Digest", path: "/digest", heading: "Digest" },
      { label: "Recurring", path: "/recurring", heading: "Recurring" },
      { label: "Templates", path: "/templates", heading: "Templates" },
      { label: "Rules", path: "/rules", heading: "Rules" },
      { label: "Categories", path: "/categories", heading: "Categories" },
      { label: "Tags", path: "/tags", heading: "Tags" },
      { label: "Reports", path: "/reports/builder", heading: "Reports" },
      { label: "What If", path: "/scenarios", heading: "What If" },
      { label: "Reconcile", path: "/reconciliation", heading: "Reconcile" },
      { label: "Settings", path: "/settings", heading: "Settings" },
      {
        label: "Admin",
        path: "/admin/elevate?redirect=%2Fadmin",
        heading: "Admin",
      },
    ]

    for (const route of routes) {
      await chooseMoreDestination(page, route.label)
      await expect(page).toHaveURL(route.path)
      await expect(
        page.getByRole("heading", { name: route.heading, level: 1 }),
      ).toBeVisible()
    }
  })
})
