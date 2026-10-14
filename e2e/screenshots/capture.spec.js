import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');
const cards = (page) => page.getByRole('list', { name: 'Products', exact: true }).locator('article');

async function selectFacet(page, name) {
  const checkbox = page.getByRole('checkbox', { name, exact: true });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
}

async function capture(page, name, fullPage = false) {
  const position = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.getByRole('img').all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await page.evaluate(({ x, y }) => scrollTo(x, y), position);
  await expect(page.locator('main[aria-busy="true"], .skeleton-card, [role="alert"]')).toHaveCount(0);
  await page.screenshot({ path: resolve(output, name), fullPage, scale: 'css' });
}

test('capture four genuine seeded application views', async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  const unexpected = [];
  const errors = [];
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== baseURL) {
      unexpected.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/products');
    await expect(page.getByText('144 products', { exact: true })).toBeVisible();
    await expect(cards(page)).toHaveCount(12);
    await selectFacet(page, 'Chair');
    await selectFacet(page, 'Metal');
    await page.getByLabel('Sort by', { exact: true }).selectOption('price_asc');
    await expect(cards(page)).toHaveCount(5);
    const expected = await page.request.get('/api/products?category=chair&material=metal&sort=price_asc');
    expect(expected.ok()).toBeTruthy();
    await expect(cards(page).getByRole('heading')).toHaveText((await expected.json()).data.map((product) => product.title));
    await capture(page, 'desktop-catalog.png', true);

    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await expect(cards(page)).toHaveCount(12);
    await cards(page).getByRole('link', { name: 'Arc Chair 01', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Arc Chair 01', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Arc Chair 01 to shortlist', exact: true })).toBeEnabled();
    await capture(page, 'product-details.png', true);

    await page.getByRole('link', { name: 'Back to catalog', exact: false }).click();
    await selectFacet(page, 'Chair');
    for (const title of ['Arc Chair 01', 'Cedarline Chair 02', 'Dune Chair 03']) {
      await page.getByRole('button', { name: `Add ${title} to comparison`, exact: true }).click();
    }
    await page.getByRole('link', { name: 'Compare (3)', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Furniture comparison', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dune Chair 03', exact: true })).toBeVisible();
    await capture(page, 'three-chair-comparison.png', true);
    await page.close();

    const mobile = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    try {
      const mobilePage = await mobile.newPage();
      await mobilePage.goto('/products');
      await expect(cards(mobilePage)).toHaveCount(12);
      await expect(mobilePage.locator('.filter-panel details')).not.toHaveAttribute('open');
      await capture(mobilePage, 'mobile-catalog.png');
    } finally { await mobile.close(); }
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
