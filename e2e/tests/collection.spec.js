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
    expect(unexpectedOrigins, 'Only local resources should be requested').toEqual([]);
  },
});

const productCards = (page) => page.getByRole('list', { name: 'Products', exact: true }).locator('article');
const save = (page, title) => page.getByRole('button', { name: `Save ${title} to shortlist`, exact: true });
const removeSaved = (page, title) => page.getByRole('button', { name: `Remove ${title} from shortlist`, exact: true });
const addCompare = (page, title) => page.getByRole('button', { name: `Add ${title} to comparison`, exact: true });
const removeCompare = (page, title) => page.getByRole('button', { name: `Remove ${title} from comparison`, exact: true });
const backToCatalog = (page) => page.getByRole('link', { name: /^(?:← )?Back to catalog$/ });

async function catalog(page, query = '') {
  const response = await page.context().request.get(`/api/products${query ? `?${query}` : ''}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

async function shortlist(page) {
  const response = await page.context().request.get('/api/shortlist');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data.map((item) => item.product.id);
}

async function expectNoOverflow(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('filtered catalog leads to details, comparison and a shortlist that survives reload', async ({ page }) => {
  const query = 'category=chair&sort=price_desc&page=2&page_size=2';
  const products = await catalog(page, query);
  expect(products).toHaveLength(2);
  await page.goto(`/products?${query}`);
  await expect(productCards(page).getByRole('heading')).toHaveText(products.map((product) => product.title));
  await productCards(page).first().getByRole('link', { name: products[0].title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/products/${products[0].slug}$`));
  await expect(page.getByRole('heading', { name: products[0].title, exact: true })).toBeVisible();
  const detailResponse = await page.context().request.get(`/api/products/${products[0].slug}`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = (await detailResponse.json()).data;
  await expect(page.getByText(detail.description, { exact: true })).toBeVisible();
  const image = page.getByRole('img', { name: `Illustration of ${products[0].title}`, exact: true });
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  await addCompare(page, products[0].title).click();
  await backToCatalog(page).click();
  await expect(page).toHaveURL(`/products?${query}`);
  await expect(productCards(page).getByRole('heading')).toHaveText(products.map((product) => product.title));
  await addCompare(page, products[1].title).click();
  await page.getByRole('link', { name: 'Compare (2)', exact: true }).click();
  const table = page.getByRole('table', { name: 'Furniture comparison', exact: true });
  await expect(table).toBeVisible();
  for (const product of products) {
    await expect(table.getByRole('link', { name: product.title, exact: true })).toBeVisible();
  }
  await save(page, products[0].title).click();
  await expect(removeSaved(page, products[0].title)).toBeEnabled();
  await page.getByRole('link', { name: 'Shortlist (1)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your shortlist', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: products[0].title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: products[0].title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Compare (0)', exact: true })).toBeVisible();
  expect(await shortlist(page)).toEqual([products[0].id]);
  await removeSaved(page, products[0].title).click();
  await expect(page.getByRole('heading', { name: 'A little room for favorites.', exact: true })).toBeVisible();
  expect(await shortlist(page)).toEqual([]);
});

test('comparison caps at three, exposes accessible specifications and reopens space after removal', async ({ page }) => {
  const products = (await catalog(page)).slice(0, 4);
  await page.goto('/products');
  await expect(productCards(page)).toHaveCount(12);
  for (const product of products.slice(0, 3)) await addCompare(page, product.title).click();
  await expect(addCompare(page, products[3].title)).toBeDisabled();
  await expect(page.getByText('Comparison holds three products. Remove one to add another.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Compare (3)', exact: true }).click();
  const table = page.getByRole('table', { name: 'Furniture comparison', exact: true });
  for (const name of ['Price (JPY)', 'Width (cm)', 'Depth (cm)', 'Height (cm)', 'Category', 'Material', 'Color', 'Availability']) {
    await expect(table.getByRole('rowheader', { name, exact: true })).toBeVisible();
  }
  for (const product of products.slice(0, 3)) {
    const column = table.getByRole('columnheader').filter({
      has: page.getByRole('link', { name: product.title, exact: true }),
    });
    await expect(column).toBeVisible();
    await expect(column).toHaveAttribute('scope', 'col');
  }
  const specifications = [
    ['Price (JPY)', (product) => new Intl.NumberFormat('en-US').format(product.price_jpy)],
    ['Width (cm)', (product) => String(product.dimensions_cm.width)],
    ['Depth (cm)', (product) => String(product.dimensions_cm.depth)],
    ['Height (cm)', (product) => String(product.dimensions_cm.height)],
    ['Category', (product) => product.category],
    ['Material', (product) => product.material],
  ];
  for (const [label, value] of specifications) {
    const row = table.getByRole('row').filter({
      has: page.getByRole('rowheader', { name: label, exact: true }),
    });
    await expect(row.getByRole('cell')).toHaveText(products.slice(0, 3).map(value));
  }
  await removeCompare(page, products[0].title).click();
  await expect(page.getByRole('link', { name: 'Compare (2)', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Catalog', exact: true }).click();
  await expect(addCompare(page, products[3].title)).toBeEnabled();
  await addCompare(page, products[3].title).click();
  await page.getByRole('button', { name: 'Clear comparison', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Compare (0)', exact: true })).toBeVisible();
  await expect(addCompare(page, products[0].title)).toBeEnabled();
});

test('direct detail entry returns safely to the catalog and reports missing products', async ({ page }) => {
  const [product] = await catalog(page);
  await page.goto(`/products/${product.slug}?return_to=https%3A%2F%2Fexample.invalid%2F&from=%2F%2Fexample.invalid`);
  await expect(page.getByRole('heading', { name: product.title, exact: true })).toBeVisible();
  await expect(backToCatalog(page)).toHaveAttribute('href', '/products');
  await backToCatalog(page).click();
  await expect(page).toHaveURL('/products');
  await page.goto('/products/no-such-original-product');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(backToCatalog(page)).toHaveAttribute('href', '/products');
  await expect(page.getByRole('button', { name: /to shortlist/ })).toHaveCount(0);
  await page.goto('/products/Invalid-Slug');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: /to shortlist/ })).toHaveCount(0);
});

test('shortlists are isolated between independent browser contexts', async ({ page, browser, baseURL }) => {
  const products = (await catalog(page)).slice(0, 2);
  const otherContext = await browser.newContext({ baseURL });
  const other = await otherContext.newPage();
  const unexpectedOrigins = [];
  await otherContext.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseURL).origin) {
      unexpectedOrigins.push(route.request().url());
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  try {
    await Promise.all([page.goto('/products'), other.goto('/products')]);
    await expect(save(page, products[0].title)).toBeEnabled();
    await expect(save(other, products[0].title)).toBeEnabled();
    await save(page, products[0].title).click();
    await expect(removeSaved(page, products[0].title)).toBeEnabled();
    expect(await shortlist(other)).toEqual([]);
    await save(other, products[1].title).click();
    await expect(removeSaved(other, products[1].title)).toBeEnabled();
    expect(await shortlist(page)).toEqual([products[0].id]);
    expect(await shortlist(other)).toEqual([products[1].id]);
    await page.reload();
    await expect(removeSaved(page, products[0].title)).toBeEnabled();
    await expect(save(page, products[1].title)).toBeEnabled();
    expect(unexpectedOrigins).toEqual([]);
  } finally {
    await otherContext.close();
  }
});

test('simultaneous first-use tabs establish one shared browser session', async ({ page }) => {
  const other = await page.context().newPage();
  const sessions = [];
  const cookiesSent = [];
  let release;
  const firstResponseGate = new Promise((resolve) => { release = resolve; });
  let attempts = 0;
  await page.context().route('**/api/session', async (route) => {
    attempts += 1;
    const attempt = attempts;
    cookiesSent.push((await route.request().allHeaders()).cookie ?? null);
    if (attempt === 1) await firstResponseGate;
    const response = await route.fetch();
    sessions.push((await response.json()).data.session_ref);
    await route.fulfill({ response });
  });
  try {
    await Promise.all([page.goto('/products'), other.goto('/products')]);
    await Promise.all([
      expect(productCards(page)).toHaveCount(12),
      expect(productCards(other)).toHaveCount(12),
    ]);
  } finally {
    release();
  }
  await Promise.all([
    expect(productCards(page).first().getByRole('button', { name: /to shortlist$/ })).toBeEnabled(),
    expect(productCards(other).first().getByRole('button', { name: /to shortlist$/ })).toBeEnabled(),
  ]);
  expect(sessions).toHaveLength(2);
  expect(new Set(sessions).size).toBe(1);
  expect(cookiesSent[0]).toBeNull();
  expect(cookiesSent[1]).toContain('roomshelf_session=');
  const [product] = await catalog(page);
  await save(page, product.title).click();
  await expect(removeSaved(page, product.title)).toBeEnabled();
  await other.reload();
  await expect(removeSaved(other, product.title)).toBeEnabled();
  expect(await shortlist(other)).toEqual([product.id]);
  await other.close();
});

test('shortlist save and reload work when Web Locks are unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });
  const [product] = await catalog(page);
  await page.goto('/products');
  expect(await page.evaluate(() => navigator.locks === undefined)).toBe(true);
  await expect(save(page, product.title)).toBeEnabled();
  await save(page, product.title).click();
  await expect(removeSaved(page, product.title)).toBeEnabled();
  await page.reload();
  await expect(removeSaved(page, product.title)).toBeEnabled();
  expect(await shortlist(page)).toEqual([product.id]);
  await removeSaved(page, product.title).click();
  await expect(save(page, product.title)).toBeEnabled();
  expect(await shortlist(page)).toEqual([]);
});

test('an expired CSRF response refreshes once and retries the intended save once', async ({ page }) => {
  const [product] = await catalog(page);
  await page.goto('/products');
  await expect(save(page, product.title)).toBeEnabled();
  let attempts = 0;
  let refreshes = 0;
  await page.route('**/api/session', async (route) => {
    refreshes += 1;
    await route.fallback();
  });
  await page.route('**/api/shortlist/items', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'csrf_invalid', message: 'CSRF token expired.', details: [] } }) });
    } else await route.fallback();
  });
  await save(page, product.title).click();
  await expect(removeSaved(page, product.title)).toBeEnabled();
  expect(attempts).toBe(2);
  expect(refreshes).toBe(1);
  expect(await shortlist(page)).toEqual([product.id]);
});

test('a replacement session cancels an expired-token write without replaying it', async ({ page }) => {
  const [product] = await catalog(page);
  await page.goto('/products');
  await expect(save(page, product.title)).toBeEnabled();
  let attempts = 0;
  await page.route('**/api/shortlist/items', async (route) => {
    attempts += 1;
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'csrf_invalid', message: 'CSRF token expired.', details: [] } }) });
  });
  await page.route('**/api/session', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const reference = body.data.session_ref;
    body.data.session_ref = `${reference[0] === 'a' ? 'b' : 'a'}${reference.slice(1)}`;
    await route.fulfill({ response, json: body });
  });
  await save(page, product.title).click();
  await expect(page.getByText('Your shortlist session ended. Your current shortlist has been refreshed. Please try the action again.', { exact: true })).toBeVisible();
  expect(attempts).toBe(1);
  expect(await shortlist(page)).toEqual([]);
  await expect(save(page, product.title)).toBeEnabled();
});

test('a lost save response reconciles the committed membership without a second write', async ({ page }) => {
  const [product] = await catalog(page);
  await page.goto('/products');
  await expect(save(page, product.title)).toBeEnabled();
  let writes = 0;
  await page.route('**/api/shortlist/items', async (route) => {
    writes += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await save(page, product.title).click();
  await expect(removeSaved(page, product.title)).toBeEnabled();
  await expect(page.getByText('The update could not be confirmed. Your shortlist has been refreshed; check it before trying again.', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  expect(await shortlist(page)).toEqual([product.id]);
});

test('mobile detail, comparison and shortlist controls remain usable from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const products = (await catalog(page)).slice(0, 3);
  await page.goto('/products');
  await expect(productCards(page)).toHaveCount(12);
  const detailLink = productCards(page).first().getByRole('link', { name: products[0].title, exact: true });
  await detailLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: products[0].title, exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await expect(save(page, products[0].title)).toBeEnabled();
  await save(page, products[0].title).focus();
  await page.keyboard.press('Enter');
  await expect(removeSaved(page, products[0].title)).toBeEnabled();
  await addCompare(page, products[0].title).focus();
  await page.keyboard.press('Enter');
  await backToCatalog(page).click();
  for (const product of products.slice(1)) await addCompare(page, product.title).click();
  await page.getByRole('link', { name: 'Compare (3)', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Furniture comparison', exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await page.getByRole('link', { name: 'Shortlist (1)', exact: true }).click();
  await expect(page.getByRole('heading', { name: products[0].title, exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await removeSaved(page, products[0].title).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'A little room for favorites.', exact: true })).toBeVisible();
});
