import { test, expect } from "@playwright/test";

test.describe("Search Flow E2E", () => {
  test("loads the home page and performs a parking search", async ({ page }) => {
    // 1. Visit homepage
    await page.goto("/");

    // 2. Check title and hero
    await expect(page).toHaveTitle(/Valet Parking MVP/);
    await expect(page.locator("h1")).toContainText(
      "Aparcamiento seguro y servicio valet"
    );

    // 3. Locate search form
    const searchForm = page.locator("form.search-form");
    await expect(searchForm).toBeVisible();

    // 4. Check airport selector has options (in demo mode: MAD, BCN, VLC)
    const airportSelect = page.locator("select#\\:r0\\:-airport, select.field-select");
    await expect(airportSelect).toBeVisible();

    // 5. Submit search
    const submitBtn = page.locator("#search-submit-btn");
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 6. Navigation to /search
    await expect(page).toHaveURL(/\/search\?airport_id=/);

    // 7. Verify search results page displays summary
    const summaryBar = page.locator(".search-summary-bar");
    await expect(summaryBar).toBeVisible();
    await expect(summaryBar).toContainText("Aeropuerto");
    await expect(summaryBar).toContainText("Entrada");
    await expect(summaryBar).toContainText("Salida");

    // 8. In demo mode (no Supabase credentials), verify demo banner & graceful empty state
    const demoBanner = page.locator(".demo-banner");
    await expect(demoBanner).toBeVisible();
    await expect(demoBanner).toContainText("Modo demostración");

    // 9. Back to search link works
    const backLink = page.locator(".back-link");
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL("/");
  });
});
