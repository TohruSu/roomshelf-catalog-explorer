import { test as base, expect } from '@playwright/test';

const REQUEST_TIMEOUT_MS = 10_000;
const UPDATE_UNCONFIRMED = 'The update could not be confirmed. Your shortlist has been refreshed; check it before trying again.';

const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const unexpectedOrigins = [];
    const pageErrors = [];
    const origin = new URL(baseURL).origin;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.context().route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        unexpectedOrigins.push(route.request().url());
        await route.abort('blockedbyclient');
      } else await route.continue();
    });
    await page.clock.install();
    await use(page);
    expect(unexpectedOrigins, 'Only local resources should be requested').toEqual([]);
    expect(pageErrors, 'Deadline recovery should not leak browser errors').toEqual([]);
  },
});

const save = (page, title) => page.getByRole('button', { name: `Save ${title} to shortlist`, exact: true });
const removeSaved = (page, title) => page.getByRole('button', { name: `Remove ${title} from shortlist`, exact: true });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function products(page) {
  const response = await page.context().request.get('/api/products');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

async function shortlist(page) {
  const response = await page.context().request.get('/api/shortlist');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data.map((item) => item.product.id);
}

async function openCatalog(page) {
  await page.goto('/products');
  // Finish unrelated reads before advancing every browser request timer.
  await expect(page.getByRole('list', { name: 'Products', exact: true })).toBeVisible();
  await expect(page.getByLabel('Min price (JPY)', { exact: true })).toHaveAttribute('placeholder', /^\d+$/);
}

async function expireRequest(page) {
  await page.clock.fastForward(REQUEST_TIMEOUT_MS + 1);
}

test('a stalled first session expires and an explicit refresh can bootstrap again', async ({ page }) => {
  const [product] = await products(page);
  const started = deferred();
  const release = deferred();
  let attempts = 0;
  await page.route('**/api/session', async (route) => {
    attempts += 1;
    if (attempts !== 1) return route.fallback();
    started.resolve();
    await release.promise;
    await route.abort('failed');
  });
  try {
    await openCatalog(page);
    await started.promise;
    await expireRequest(page);
    await expect(page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Refresh shortlist', exact: true }) })).toBeVisible();
    await expect(save(page, product.title)).toBeDisabled();
    await page.getByRole('button', { name: 'Refresh shortlist', exact: true }).click();
    await expect(save(page, product.title)).toBeEnabled();
    expect(attempts).toBe(2);
    expect(await shortlist(page)).toEqual([]);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a committed save timeout reconciles once and a late save response cannot overwrite a newer removal', async ({ page }) => {
  const [product] = await products(page);
  await openCatalog(page);
  await expect(save(page, product.title)).toBeEnabled();
  const committed = deferred();
  const release = deferred();
  const finished = deferred();
  let writes = 0;
  await page.route('**/api/shortlist/items', async (route) => {
    writes += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed.resolve();
    await release.promise;
    await route.fulfill({ response });
    finished.resolve();
  });
  try {
    await save(page, product.title).click();
    await committed.promise;
    expect(await shortlist(page)).toEqual([product.id]);
    await expireRequest(page);
    await expect(removeSaved(page, product.title)).toBeEnabled();
    await expect(page.getByText(UPDATE_UNCONFIRMED, { exact: true })).toBeVisible();
    expect(writes).toBe(1);
    await removeSaved(page, product.title).click();
    await expect(save(page, product.title)).toBeEnabled();
    expect(await shortlist(page)).toEqual([]);
    release.resolve();
    await finished.promise;
    await expect(save(page, product.title)).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Shortlist (0)', exact: true })).toBeVisible();
    expect(writes).toBe(1);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('an uncommitted removal timeout retains authoritative membership and requires an explicit retry', async ({ page }) => {
  const [product] = await products(page);
  await openCatalog(page);
  await expect(save(page, product.title)).toBeEnabled();
  await save(page, product.title).click();
  await expect(removeSaved(page, product.title)).toBeEnabled();
  const started = deferred();
  const release = deferred();
  let deletes = 0;
  await page.route(`**/api/shortlist/items/${product.id}`, async (route) => {
    deletes += 1;
    if (deletes !== 1) return route.fallback();
    started.resolve();
    await release.promise;
    await route.fulfill({ status: 204 });
  });
  try {
    await removeSaved(page, product.title).click();
    await started.promise;
    await expireRequest(page);
    await expect(removeSaved(page, product.title)).toBeEnabled();
    await expect(page.getByText(UPDATE_UNCONFIRMED, { exact: true })).toBeVisible();
    expect(deletes).toBe(1);
    expect(await shortlist(page)).toEqual([product.id]);
    await removeSaved(page, product.title).click();
    await expect(save(page, product.title)).toBeEnabled();
    expect(deletes).toBe(2);
    expect(await shortlist(page)).toEqual([]);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('an uncommitted save timeout releases the queue for the next intended product', async ({ page }) => {
  const [first, second] = await products(page);
  await openCatalog(page);
  await expect(save(page, first.title)).toBeEnabled();
  const started = deferred();
  const release = deferred();
  const writtenIds = [];
  await page.route('**/api/shortlist/items', async (route) => {
    const { product_id: id } = route.request().postDataJSON();
    writtenIds.push(id);
    if (id !== first.id) return route.fallback();
    started.resolve();
    await release.promise;
    await route.fulfill({ json: { data: { product_id: id, saved: true } } });
  });
  try {
    await save(page, first.title).click();
    await started.promise;
    await save(page, second.title).click();
    expect(writtenIds).toEqual([first.id]);
    await expireRequest(page);
    await expect(save(page, first.title)).toBeEnabled();
    await expect(removeSaved(page, second.title)).toBeEnabled();
    expect(writtenIds).toEqual([first.id, second.id]);
    expect(await shortlist(page)).toEqual([second.id]);
  } finally {
    release.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a stalled reconciliation clears pending state and a later refresh ignores the obsolete read', async ({ page }) => {
  const [product] = await products(page);
  await openCatalog(page);
  await expect(save(page, product.title)).toBeEnabled();
  const writeStarted = deferred();
  const readStarted = deferred();
  const releaseWrite = deferred();
  const releaseRead = deferred();
  const readFinished = deferred();
  let writes = 0;
  let reads = 0;
  await page.route('**/api/shortlist/items', async (route) => {
    writes += 1;
    if (writes !== 1) return route.fallback();
    writeStarted.resolve();
    await releaseWrite.promise;
    await route.fulfill({ json: { data: { product_id: product.id, saved: true } } });
  });
  await page.route('**/api/shortlist', async (route) => {
    reads += 1;
    if (reads !== 1) return route.fallback();
    readStarted.resolve();
    await releaseRead.promise;
    await route.fulfill({ json: { data: [], meta: { total: 0 } } });
    readFinished.resolve();
  });
  try {
    await save(page, product.title).click();
    await writeStarted.promise;
    await expireRequest(page);
    await readStarted.promise;
    await expireRequest(page);
    await expect(page.getByRole('alert')).toContainText('The update could not be confirmed. Please reload your shortlist before trying again.');
    await expect(save(page, product.title)).toBeDisabled();
    await expect(page.getByText('Updating…', { exact: true })).toHaveCount(0);
    expect(writes).toBe(1);
    await page.getByRole('button', { name: 'Refresh shortlist', exact: true }).click();
    await expect(save(page, product.title)).toBeEnabled();
    await save(page, product.title).click();
    await expect(removeSaved(page, product.title)).toBeEnabled();
    expect(writes).toBe(2);
    expect(await shortlist(page)).toEqual([product.id]);
    releaseRead.resolve();
    await readFinished.promise;
    await expect(removeSaved(page, product.title)).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Shortlist (1)', exact: true })).toBeVisible();
  } finally {
    releaseWrite.resolve();
    releaseRead.resolve();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
