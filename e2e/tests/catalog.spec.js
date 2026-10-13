import { test as base, expect } from '@playwright/test';

const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const unexpectedOrigins = [];
    const origin = new URL(baseURL).origin;
    await page.context().route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        unexpectedOrigins.push(route.request().url());
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    await use(page);
    expect(unexpectedOrigins, 'The catalog must not request external resources').toEqual([]);
  },
});

const cards = (page) => page.getByRole('list', { name: 'Products', exact: true }).locator('article');
const headings = (page) => cards(page).getByRole('heading');
const resetFilters = (page) => page.getByRole('complementary', { name: 'Catalog filters' }).getByRole('button', { name: 'Reset filters', exact: true });

async function seededProducts(request) {
  const firstResponse = await request.get('/api/products?page_size=48');
  expect(firstResponse.ok()).toBeTruthy();
  const first = await firstResponse.json();
  expect(first.meta.total).toBe(144);
  const products = [...first.data];
  for (let number = 2; number <= first.meta.total_pages; number += 1) {
    const response = await request.get(`/api/products?page_size=48&page=${number}`);
    expect(response.ok()).toBeTruthy();
    products.push(...(await response.json()).data);
  }
  expect(products).toHaveLength(144);
  expect(new Set(products.map((product) => product.id)).size).toBe(144);
  return products;
}

async function expectQuery(page, name, value) {
  await expect.poll(() => new URL(page.url()).searchParams.get(name)).toBe(value);
}

async function selectFacet(page, name) {
  const checkbox = page.getByRole('checkbox', { name, exact: true });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
}

test('shows the seeded catalog with fully loaded original local illustrations', async ({ page, request }) => {
  const products = await seededProducts(request);
  await page.goto('/products');
  await expect(page.getByText('144 products', { exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(12);
  await expect(headings(page)).toHaveText(products.slice(0, 12).map((product) => product.title));

  const images = cards(page).getByRole('img');
  await expect(images).toHaveCount(12);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  }
  await expect.poll(() => images.evaluateAll((elements) => elements.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  const sources = await images.evaluateAll((elements) => elements.map((image) => image.currentSrc));
  for (const source of sources) {
    const url = new URL(source);
    expect(url.origin).toBe('http://127.0.0.1:4173');
    expect(url.pathname).toMatch(/\.svg$/);
  }
  await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
});

test('combines OR facets with inclusive price and width limits and price sorting', async ({ page, request }) => {
  const products = await seededProducts(request);
  const expected = products
    .filter((product) => ['chair', 'table'].includes(product.category)
      && ['wood', 'metal'].includes(product.material)
      && product.price_jpy >= 10_000 && product.price_jpy <= 60_000
      && product.dimensions_cm.width <= 90)
    .sort((left, right) => left.price_jpy - right.price_jpy || left.id - right.id);
  expect(expected.length).toBeGreaterThan(0);

  await page.goto('/products');
  await selectFacet(page, 'Chair');
  await selectFacet(page, 'Table');
  await selectFacet(page, 'Wood');
  await selectFacet(page, 'Metal');
  await page.getByLabel('Min price (JPY)', { exact: true }).fill('10000');
  await page.getByLabel('Max price (JPY)', { exact: true }).fill('60000');
  await page.getByLabel('Maximum width (cm)', { exact: true }).fill('90');
  await page.getByRole('button', { name: 'Apply limits', exact: true }).click();
  await page.getByLabel('Sort by', { exact: true }).selectOption('price_asc');

  await expectQuery(page, 'sort', 'price_asc');
  await expectQuery(page, 'max_width', '90');
  const parameters = new URL(page.url()).searchParams;
  expect(new Set(parameters.getAll('category'))).toEqual(new Set(['chair', 'table']));
  expect(new Set(parameters.getAll('material'))).toEqual(new Set(['wood', 'metal']));
  await expect(page.getByText(`${expected.length} ${expected.length === 1 ? 'product' : 'products'}`, { exact: true })).toBeVisible();
  await expect(headings(page)).toHaveText(expected.slice(0, 12).map((product) => product.title));

  await resetFilters(page).click();
  await expect(page.getByText('144 products', { exact: true })).toBeVisible();
  await expectQuery(page, 'category', null);
  await expectQuery(page, 'max_width', null);
});

test('pagination survives browser Back and Forward and sorting resets page one', async ({ page, request }) => {
  const products = await seededProducts(request);
  await page.goto('/products');
  await expect(headings(page)).toHaveText(products.slice(0, 12).map((product) => product.title));
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expectQuery(page, 'page', '2');
  await expect(headings(page)).toHaveText(products.slice(12, 24).map((product) => product.title));

  await page.goBack();
  await expectQuery(page, 'page', null);
  await expect(headings(page)).toHaveText(products.slice(0, 12).map((product) => product.title));
  await page.goForward();
  await expectQuery(page, 'page', '2');
  await expect(headings(page)).toHaveText(products.slice(12, 24).map((product) => product.title));

  await page.getByLabel('Sort by', { exact: true }).selectOption('price_desc');
  await expectQuery(page, 'page', null);
  const descending = [...products].sort((left, right) => right.price_jpy - left.price_jpy || left.id - right.id);
  await expect(headings(page)).toHaveText(descending.slice(0, 12).map((product) => product.title));
});

test('an unavailable response can be retried and an empty search can be reset', async ({ page }) => {
  let failed = false;
  await page.route('**/api/products*', async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'database_busy', message: 'Catalog temporarily unavailable.', details: [] } }),
      });
      return;
    }
    await route.fallback();
  });
  await page.goto('/products');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('144 products', { exact: true })).toBeVisible();
  await page.getByLabel('Search furniture', { exact: true }).fill('no-matching-catalog-entry');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expectQuery(page, 'q', 'no-matching-catalog-entry');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText('0 products', { exact: true })).toBeVisible();
  await resetFilters(page).click();
  await expect(page.getByText('144 products', { exact: true })).toBeVisible();
});

test('a delayed catalog request exposes the loading state before real results', async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/products*', async (route) => {
    await gate;
    await route.fallback();
  });
  try {
    await page.goto('/products');
    await expect(page.getByText('Loading products…', { exact: true })).toBeAttached();
    await expect(page.getByRole('region', { name: 'Catalog results' })).toHaveAttribute('aria-busy', 'true');
  } finally {
    release();
  }
  await expect(page.getByText('144 products', { exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(12);
});

test('mobile search works from the keyboard without document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/products');
  await expect(page.getByText('144 products', { exact: true })).toBeVisible();
  const search = page.getByLabel('Search furniture', { exact: true });
  await search.focus();
  await page.keyboard.type('chair');
  await page.keyboard.press('Enter');
  await expectQuery(page, 'q', 'chair');
  await expect(headings(page).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
});
