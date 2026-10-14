import { chromium, test as base, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const unexpectedOrigins = [];
    const origin = new URL(baseURL).origin;
    await page.context().route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        unexpectedOrigins.push(route.request().url());
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await use(page);
    expect(unexpectedOrigins, 'Accessibility flows use only local resources').toEqual([]);
  },
});

const cards = (page) => page.getByRole('list', { name: 'Products', exact: true }).locator('article');
const addCompare = (page, title) => page.getByRole('button', { name: `Add ${title} to comparison`, exact: true });
const removeCompare = (page, title) => page.getByRole('button', { name: `Remove ${title} from comparison`, exact: true });
const removeTray = (page, title) => page.getByRole('button', { name: `Remove ${title} from comparison selection`, exact: true });
const save = (page, title) => page.getByRole('button', { name: `Save ${title} to shortlist`, exact: true });
const removeSaved = (page, title) => page.getByRole('button', { name: `Remove ${title} from shortlist`, exact: true });
const browse = (page) => page.getByRole('link', { name: 'Browse the catalog', exact: true });
const summary = (page) => page.locator('.filter-disclosure > summary');

async function products(page, query = '') {
  const response = await page.context().request.get(`/api/products${query ? `?${query}` : ''}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

async function readyCatalog(page, query = '') {
  await page.goto(`/products${query ? `?${query}` : ''}`);
  await expect(cards(page).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Catalog results' })).toHaveAttribute('aria-busy', 'false');
}

async function compareThree(page) {
  const selected = (await products(page)).slice(0, 3);
  await readyCatalog(page);
  for (const product of selected) await addCompare(page, product.title).click();
  await page.getByRole('link', { name: 'Compare (3)', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Furniture comparison', exact: true })).toBeVisible();
  return selected;
}

async function shortlistThree(page) {
  const selected = (await products(page)).slice(0, 3);
  await readyCatalog(page);
  for (const product of selected) {
    await expect(save(page, product.title)).toBeEnabled();
    await save(page, product.title).click();
    await expect(removeSaved(page, product.title)).toBeEnabled();
  }
  await page.getByRole('link', { name: 'Shortlist (3)', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Saved products', exact: true }).locator('article')).toHaveCount(3);
  return [...selected].reverse();
}

async function holdNextCatalog(page) {
  let release;
  let markStarted;
  let markFinished;
  let claimed = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const finished = new Promise((resolve) => { markFinished = resolve; });
  await page.route('**/api/products?*', async (route) => {
    if (claimed) return route.fallback();
    claimed = true;
    try {
      const response = await route.fetch();
      markStarted();
      await gate;
      await route.fulfill({ response });
    } finally {
      markFinished();
    }
  });
  return { release, started, finished };
}

async function openScrolledDetail(page) {
  const query = 'category=chair&sort=price_desc&page=2';
  const selected = await products(page, query);
  await readyCatalog(page, query);
  const originalLink = cards(page).getByRole('link', { name: selected[6].title, exact: true });
  await originalLink.scrollIntoViewIfNeeded();
  const originalY = await page.evaluate(() => scrollY);
  expect(originalY).toBeGreaterThan(500);
  await originalLink.click();
  await expect(page.getByRole('heading', { name: selected[6].title, exact: true })).toBeVisible();
  return { query, product: selected[6], originalY };
}

async function expectNoOverflow(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function expectFocusInViewport(page) {
  await expect.poll(() => page.evaluate(() => {
    const rectangle = document.activeElement.getBoundingClientRect();
    return rectangle.top >= 0 && rectangle.left >= 0 && rectangle.bottom <= innerHeight && rectangle.right <= innerWidth;
  })).toBe(true);
}

test('route changes set useful titles and focus while catalog query changes keep input focus', async ({ page }) => {
  await readyCatalog(page);
  await expect(page).toHaveTitle('Catalog | RoomShelf');
  await expect(page.locator('h1')).toBeFocused();
  const search = page.getByLabel('Search furniture', { exact: true });
  await search.focus();
  await search.fill('chair');
  await search.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('chair');
  await expect(page.getByRole('region', { name: 'Catalog results' })).toHaveAttribute('aria-busy', 'false');
  await expect(search).toBeFocused();
  await expect(page).toHaveTitle('Catalog | RoomShelf');
  const product = (await products(page, 'q=chair'))[0];
  await cards(page).getByRole('link', { name: product.title, exact: true }).click();
  await expect(page).toHaveTitle(`${product.title} | RoomShelf`);
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('link', { name: 'Compare (0)', exact: true }).click();
  await expect(page).toHaveTitle('Compare Products | RoomShelf');
  await expect(page.getByRole('heading', { name: 'Compare the details', exact: true })).toBeFocused();
  await page.getByRole('link', { name: 'Shortlist (0)', exact: true }).click();
  await expect(page).toHaveTitle('Your Shortlist | RoomShelf');
  await expect(page.getByRole('heading', { name: 'Your shortlist', exact: true })).toBeFocused();
  await page.goto('/not-a-page');
  await expect(page).toHaveTitle('Page Not Found | RoomShelf');
  await expect(page.getByRole('heading', { name: 'This page is off the shelf.', exact: true })).toBeFocused();
});

test('keyboard skip link reaches main content on every product flow with a visible focus indicator', async ({ page }) => {
  const [product] = await products(page);
  for (const path of ['/products', `/products/${product.slug}`, '/compare', '/shortlist']) {
    await page.goto(path);
    await page.getByRole('link', { name: 'RoomShelf catalog', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    const skip = page.getByRole('link', { name: 'Skip to content', exact: true });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    const outline = await skip.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  }
});

test('delayed detail results update the title without dropping main focus or stealing a new focus choice', async ({ page }) => {
  const [product] = await products(page);
  let release;
  let markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  await page.route(`**/api/products/${product.slug}`, async (route) => {
    const response = await route.fetch();
    markStarted();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/products/${product.slug}`);
    await started;
    await expect(page).toHaveTitle('Product Details | RoomShelf');
    await expect(page.locator('#main-content')).toBeFocused();
    await page.getByRole('link', { name: 'Catalog', exact: true }).focus();
  } finally {
    release();
  }
  await expect(page).toHaveTitle(`${product.title} | RoomShelf`);
  await expect(page.getByRole('link', { name: 'Catalog', exact: true })).toBeFocused();
  await page.goto('/products/no-such-room-shelf-product');
  await expect(page).toHaveTitle('Product Not Found | RoomShelf');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('comparison removal keeps adjacent focus and loaded surviving columns', async ({ page }) => {
  const selected = await compareThree(page);
  const detailRequests = [];
  await page.route('**/api/products/*', async (route) => {
    detailRequests.push(new URL(route.request().url()).pathname);
    await route.fallback();
  });
  await removeCompare(page, selected[1].title).focus();
  await page.keyboard.press('Enter');
  await expect(removeCompare(page, selected[2].title)).toBeFocused();
  await expect(page.getByRole('table', { name: 'Furniture comparison', exact: true }).getByRole('columnheader')).toHaveCount(3);
  await page.keyboard.press('Enter');
  await expect(removeCompare(page, selected[0].title)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(browse(page)).toBeFocused();
  await expect(page.getByRole('table', { name: 'Furniture comparison', exact: true })).toHaveCount(0);
  expect(detailRequests, 'Removing a column must retain loaded remaining details').toEqual([]);
});

test('comparison tray removal and Clear keep a useful focused control', async ({ page }) => {
  const selected = (await products(page)).slice(0, 3);
  await readyCatalog(page);
  for (const product of selected) await addCompare(page, product.title).click();
  await removeTray(page, selected[0].title).focus();
  await page.keyboard.press('Enter');
  await expect(removeTray(page, selected[1].title)).toBeFocused();
  await page.getByRole('button', { name: 'Clear comparison', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeFocused();
  await expectFocusInViewport(page);
  await expect(page.getByRole('complementary', { name: 'Selected comparison products', exact: true })).toHaveCount(0);
  await addCompare(page, selected[0].title).click();
  await page.getByRole('link', { name: 'Compare (1)', exact: true }).click();
  await removeTray(page, selected[0].title).focus();
  await page.keyboard.press('Enter');
  await expect(browse(page)).toBeFocused();
  await expectFocusInViewport(page);
});

test('catalog and detail Save keep keyboard focus through pending writes and authoritative reads without duplicate mutations', async ({ page }) => {
  const selected = (await products(page)).slice(0, 2);
  for (const [index, product] of selected.entries()) {
    await page.goto(index === 0 ? '/products' : `/products/${product.slug}`);
    const button = save(page, product.title);
    await expect(button).toBeEnabled();
    let releaseWrite;
    let releaseRead;
    let markWriteStarted;
    let markReadStarted;
    let armed = false;
    let writes = 0;
    const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
    const readGate = new Promise((resolve) => { releaseRead = resolve; });
    const writeStarted = new Promise((resolve) => { markWriteStarted = resolve; });
    const readStarted = new Promise((resolve) => { markReadStarted = resolve; });
    const writeRoute = async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      writes += 1;
      const response = await route.fetch();
      markWriteStarted();
      await writeGate;
      await route.fulfill({ response });
    };
    const readRoute = async (route) => {
      if (!armed) return route.fallback();
      armed = false;
      const response = await route.fetch();
      markReadStarted();
      await readGate;
      await route.fulfill({ response });
    };
    await page.route('**/api/shortlist/items', writeRoute);
    await page.route('**/api/shortlist', readRoute);
    try {
      await button.focus();
      armed = true;
      await page.keyboard.press('Enter');
      await writeStarted;
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      expect(writes).toBe(1);
      releaseWrite();
      await readStarted;
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      expect(writes).toBe(1);
      releaseRead();
      await expect(removeSaved(page, product.title)).toBeEnabled();
      await expect(removeSaved(page, product.title)).toBeFocused();
      expect(writes).toBe(1);
    } finally {
      releaseWrite();
      releaseRead();
      await page.unroute('**/api/shortlist/items', writeRoute);
      await page.unroute('**/api/shortlist', readRoute);
    }
  }
});

test('confirmed shortlist removals keep adjacent focus and the last removal reaches the empty action', async ({ page }) => {
  const selected = await shortlistThree(page);
  await removeSaved(page, selected[1].title).focus();
  await page.keyboard.press('Enter');
  await expect(removeSaved(page, selected[2].title)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(removeSaved(page, selected[0].title)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(browse(page)).toBeFocused();
  await expect(page.getByRole('heading', { name: 'A little room for favorites.', exact: true })).toBeVisible();
});

test('a delayed removal does not steal focus from another shortlist control', async ({ page }) => {
  const selected = await shortlistThree(page);
  let release;
  let markStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  await page.route(`**/api/shortlist/items/${selected[0].id}`, async (route) => {
    const response = await route.fetch();
    markStarted();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await removeSaved(page, selected[0].title).focus();
    await page.keyboard.press('Enter');
    await started;
    await addCompare(page, selected[1].title).focus();
  } finally {
    release();
  }
  await expect(removeSaved(page, selected[0].title)).toHaveCount(0);
  await expect(addCompare(page, selected[1].title)).toBeFocused();
});

test('a rejected shortlist removal keeps the saved product and restores its usable control', async ({ page }) => {
  const selected = await shortlistThree(page);
  await page.route(`**/api/shortlist/items/${selected[0].id}`, async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'origin_rejected', message: 'This request could not be accepted.', details: [] } }),
    });
  });
  await removeSaved(page, selected[0].title).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('This request could not be accepted.');
  await expect(removeSaved(page, selected[0].title)).toBeEnabled();
  await expect(removeSaved(page, selected[0].title)).toBeFocused();
  await expect(page.getByRole('list', { name: 'Saved products', exact: true }).locator('article')).toHaveCount(3);
});

test('an uncertain removal reconciles server state and recovers focus without claiming success', async ({ page }) => {
  const selected = await shortlistThree(page);
  let writes = 0;
  await page.route(`**/api/shortlist/items/${selected[0].id}`, async (route) => {
    writes += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(204);
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'database_busy', message: 'The response could not be confirmed.', details: [] } }),
    });
  });
  await removeSaved(page, selected[0].title).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('The update could not be confirmed.');
  await expect(removeSaved(page, selected[0].title)).toHaveCount(0);
  await expect(removeSaved(page, selected[1].title)).toBeFocused();
  expect(writes).toBe(1);
});

test('catalog detail return waits for real results before restoring the exact URL and scroll', async ({ page }) => {
  const { query, product, originalY } = await openScrolledDetail(page);
  await page.locator('.site-footer').scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const held = await holdNextCatalog(page);
  try {
    await page.goBack();
    await held.started;
    await expect(page).toHaveURL(`/products?${query}`);
    await expect(page.getByRole('region', { name: 'Catalog results' })).toHaveAttribute('aria-busy', 'true');
    expect(await page.evaluate(() => scrollY)).toBeLessThan(originalY / 2);
  } finally {
    held.release();
    await held.finished;
  }
  await expect(cards(page).getByRole('link', { name: product.title, exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(originalY, 0);
});

test('browser Back and Forward repeatedly restore the originating catalog entry', async ({ page }) => {
  const { query, product, originalY } = await openScrolledDetail(page);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goBack();
    await expect(page).toHaveURL(`/products?${query}`);
    await expect(cards(page).getByRole('link', { name: product.title, exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(originalY, 0);
    if (attempt === 0) {
      await page.goForward();
      await expect(page).toHaveTitle(`${product.title} | RoomShelf`);
      await expect(page.locator('#main-content')).toBeFocused();
    }
  }
});

test('catalog return keeps the originating product focus visible after the viewport reflows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await readyCatalog(page, 'page_size=48');
  const originalLink = cards(page).locator('h2 a').nth(35);
  const title = await originalLink.innerText();
  await originalLink.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500);
  await originalLink.click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goBack();
  await expect(page).toHaveURL('/products?page_size=48');
  await expect(cards(page).getByRole('link', { name: title, exact: true })).toBeFocused();
  await expectFocusInViewport(page);
});

test('user scrolling cancels a pending catalog return instead of snapping back after results', async ({ page }) => {
  const { originalY } = await openScrolledDetail(page);
  const held = await holdNextCatalog(page);
  let manualY;
  try {
    await page.getByRole('link', { name: '← Back to catalog', exact: true }).click();
    await held.started;
    await page.mouse.wheel(0, 180);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    manualY = await page.evaluate(() => scrollY);
  } finally {
    held.release();
    await held.finished;
  }
  await expect(page.getByRole('region', { name: 'Catalog results' })).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(manualY, 0);
  expect(Math.abs(manualY - originalY)).toBeGreaterThan(100);
});

test('unrelated navigation cancels a pending catalog restoration and direct detail links use the safe fallback', async ({ page }) => {
  const { product } = await openScrolledDetail(page);
  const held = await holdNextCatalog(page);
  try {
    await page.getByRole('link', { name: '← Back to catalog', exact: true }).click();
    await held.started;
    await page.getByRole('link', { name: 'Compare (0)', exact: true }).click();
  } finally {
    held.release();
    await held.finished;
  }
  await expect(page).toHaveURL('/compare');
  await expect(page.getByRole('heading', { name: 'Compare the details', exact: true })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBeLessThan(100);
  await page.goto(`/products/${product.slug}?return_to=https%3A%2F%2Fexample.invalid&from=%2F%2Fexample.invalid`);
  await expect(page.getByRole('link', { name: '← Back to catalog', exact: true })).toHaveAttribute('href', '/products');
});

test('mobile filters start compact, support native keyboard control and preserve drafts across toggles and viewport changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await readyCatalog(page);
  const disclosure = page.locator('.filter-disclosure');
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(summary(page)).toHaveText(/Filters.*No active filters/s);
  expect(await cards(page).first().evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(700);
  await summary(page).focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('open', '');
  await page.getByLabel('Search furniture', { exact: true }).fill('draft chair');
  await page.getByLabel('Min price (JPY)', { exact: true }).fill('12345');
  await summary(page).focus();
  await page.keyboard.press('Space');
  await expect(disclosure).not.toHaveAttribute('open');
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(disclosure).not.toHaveAttribute('open');
  await summary(page).press('Enter');
  await expect(page.getByLabel('Search furniture', { exact: true })).toHaveValue('draft chair');
  await expect(page.getByLabel('Min price (JPY)', { exact: true })).toHaveValue('12345');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(disclosure).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByLabel('Search furniture', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Min price (JPY)', { exact: true })).toHaveValue('');
  await expect(disclosure).toHaveAttribute('open', '');
  await page.getByRole('checkbox', { name: 'Chair', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Chair', exact: true })).toBeChecked();
  await summary(page).press('Enter');
  await expect(summary(page)).toHaveText(/Filters.*1 active filter/s);
  await expect(page.getByText('24 products', { exact: true })).toBeVisible();
});

test('catalog, detail, shortlist and comparison reflow without document overflow at representative viewport sizes', async ({ page }) => {
  const selected = (await products(page)).slice(0, 3);
  await readyCatalog(page);
  for (const product of selected) await addCompare(page, product.title).click();
  await expect(save(page, selected[0].title)).toBeEnabled();
  await save(page, selected[0].title).click();
  await expect(removeSaved(page, selected[0].title)).toBeEnabled();
  for (const width of [320, 390, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoOverflow(page);
    await cards(page).getByRole('link', { name: selected[0].title, exact: true }).click();
    await expect(page.getByRole('heading', { name: selected[0].title, exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await page.getByRole('link', { name: 'Shortlist (1)', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Saved products', exact: true })).toBeVisible();
    await expectNoOverflow(page);
    await page.getByRole('link', { name: 'Compare (3)', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Furniture comparison', exact: true })).toBeVisible();
    await expectNoOverflow(page);
    const region = page.getByRole('region', { name: 'Product comparison table', exact: true });
    const overflow = await region.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    if (width <= 390) expect(overflow.scrollWidth).toBeGreaterThan(overflow.width);
    await region.focus();
    await expect(region).toBeFocused();
    await region.press('ArrowRight');
    if (width <= 390) await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await page.getByRole('link', { name: 'Catalog', exact: true }).click();
    await expect(cards(page).first()).toBeVisible();
  }
});

test('rendered secondary text and placeholders meet normal-text contrast and keyboard outlines are visible', async ({ page }) => {
  await readyCatalog(page);
  await page.getByRole('button', { name: /^Add .* to comparison$/ }).first().click();
  const contrast = await page.evaluate(() => {
    const parse = (value) => value.match(/[\d.]+/g).map(Number);
    const blend = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * (foreground[3] ?? 1) + background[index] * (1 - (foreground[3] ?? 1)));
    const backgroundOf = (element) => {
      const ancestors = [];
      for (let current = element; current; current = current.parentElement) ancestors.unshift(current);
      return ancestors.reduce((color, ancestor) => blend(parse(getComputedStyle(ancestor).backgroundColor), color), [255, 255, 255]);
    };
    const luminance = (color) => color.map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return [
      ['.header-description'], ['.eyebrow'], ['.intro-note'], ['.result-count p'],
      ['.product-category'], ['.product-specs'], ['.site-footer'], ['.text-button'],
      ['.compare-tray .eyebrow'], ['.compare-note'],
      ['#catalog-search', '::placeholder'], ['#min-price', '::placeholder'], ['#max-width', '::placeholder'],
    ].map(([selector, pseudo]) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element, pseudo);
      const background = backgroundOf(element);
      const foreground = blend(parse(style.color), background);
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return { selector, pseudo, color: style.color, background, ratio: (lighter + 0.05) / (darker + 0.05) };
    });
  });
  for (const measurement of contrast) expect(measurement.ratio, JSON.stringify(measurement)).toBeGreaterThanOrEqual(4.5);
  await page.getByLabel('Search furniture', { exact: true }).focus();
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineColor: style.outlineColor };
  });
  expect(focused.outlineStyle).not.toBe('none');
  expect(focused.outlineWidth).toBeGreaterThanOrEqual(2);
});

test('real browser zoom at 200% and 400% keeps all product flows usable without page-wide horizontal scrolling', async ({ baseURL }, testInfo) => {
  // A temporary local extension uses Chrome's browser zoom API. CSS zoom,
  // device scale emulation and pinch zoom do not exercise browser reflow.
  const temporary = await mkdtemp(join(tmpdir(), 'roomshelf-zoom-'));
  const extension = join(temporary, 'extension');
  let context;
  try {
    await mkdir(extension);
    await writeFile(join(extension, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Local browser zoom test',
      version: '1.0',
      permissions: ['tabs'],
      background: { service_worker: 'background.js' },
    }));
    await writeFile(join(extension, 'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
    context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
      ...testInfo.project.use.launchOptions,
      channel: 'chromium',
      headless: true,
      viewport: null,
      deviceScaleFactor: undefined,
      baseURL,
      args: ['--window-size=1280,900', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const origin = new URL(baseURL).origin;
    const unexpectedOrigins = [];
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        unexpectedOrigins.push(route.request().url());
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    const selected = (await products(page)).slice(0, 3);
    await readyCatalog(page);
    for (const product of selected) await addCompare(page, product.title).click();
    await expect(save(page, selected[0].title)).toBeEnabled();
    await save(page, selected[0].title).click();
    await expect(removeSaved(page, selected[0].title)).toBeEnabled();

    for (const factor of [2, 4]) {
      const zoom = await worker.evaluate(async ({ url, factor }) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((candidate) => candidate.url === url);
        await chrome.tabs.setZoom(tab.id, factor);
        return chrome.tabs.getZoom(tab.id);
      }, { url: page.url(), factor });
      expect(zoom).toBeCloseTo(factor, 5);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1280 / factor);
      expect(await page.evaluate(() => devicePixelRatio)).toBe(factor);
      expect(await page.evaluate(() => visualViewport.scale)).toBe(1);
      await expect(page.locator('.filter-disclosure')).not.toHaveAttribute('open');
      await expectNoOverflow(page);
      await cards(page).getByRole('link', { name: selected[0].title, exact: true }).click();
      await expect(page.getByRole('heading', { name: selected[0].title, exact: true })).toBeVisible();
      await expectNoOverflow(page);
      await page.getByRole('link', { name: 'Shortlist (1)', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Saved products', exact: true })).toBeVisible();
      await expectNoOverflow(page);
      await page.getByRole('link', { name: 'Compare (3)', exact: true }).click();
      await expect(page.getByRole('table', { name: 'Furniture comparison', exact: true })).toBeVisible();
      await expectNoOverflow(page);
      const region = page.getByRole('region', { name: 'Product comparison table', exact: true });
      await region.focus();
      await expect(region).toBeFocused();
      await region.press('ArrowRight');
      await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await page.getByRole('link', { name: 'Catalog', exact: true }).click();
      await expect(cards(page).first()).toBeVisible();
    }
    expect(unexpectedOrigins, 'Browser zoom checks use only local resources').toEqual([]);
  } finally {
    await context?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
