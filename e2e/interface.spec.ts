import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./?test=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
});

test('viewing challenges preserves the configured run and returns focus', async ({ page }) => {
  await page.locator('#seed').fill('KEEP-MY-RUN');
  await page.locator('#map').selectOption('iron');
  await page.locator('#mode').selectOption('extraction');
  await page.locator('#difficulty').selectOption('hard');
  await page.locator('.custom-panel summary').click();
  await page.locator('#custom-enabled').check();
  await page.locator('.custom-panel summary').click();
  await page.locator('#challenges').click();
  await expect(page.locator('#challenges-panel')).toBeVisible();
  await expect(page.locator('#seed')).toHaveValue('KEEP-MY-RUN');
  await expect(page.locator('#map')).toHaveValue('iron');
  await expect(page.locator('#mode')).toHaveValue('extraction');
  await expect(page.locator('#difficulty')).toHaveValue('hard');
  await expect(page.locator('#custom-enabled')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('#challenges-panel')).toBeHidden();
  await expect(page.locator('#challenges')).toBeFocused();
});

test('armory has a named dialog and searchable empty state', async ({ page }) => {
  await page.locator('#armory').click();
  const dialog = page.getByRole('dialog', { name: 'Armory', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Armory', exact: true })).toBeVisible();
  const search = page.locator('#armory-search');
  await expect(search).toBeFocused();
  const cards = page.locator('#armory-list article:visible');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  await search.fill('no-match-weapon-zzzz');
  await expect(page.locator('#armory-empty')).toBeVisible();
  await expect(cards).toHaveCount(0);
  await search.fill('');
  await expect(page.locator('#armory-empty')).toBeHidden();
  await expect(cards).toHaveCount(count);
});

test('menu settings traps keyboard focus and closes without exposing the HUD', async ({ page }) => {
  await page.locator('#menu-settings').click();
  const panel = page.locator('#settings-panel');
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect(page.locator('#hud')).toBeHidden();
  const first = panel.locator('input, select, button').first();
  const last = page.locator('#close-settings');
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('#menu-settings')).toBeFocused();
  await expect(page.locator('#hud')).toBeHidden();
});

test('typing seed digits does not switch the player weapon', async ({ page }) => {
  expect(await page.evaluate(() => window.__GAME_TEST__.setWeapon(9))).toBe(true);
  const weapon = await page.evaluate(() => window.__GAME_TEST__.getPlayer().weapon);
  const seed = page.locator('#seed');
  await seed.fill('');
  for (const digit of '12345') {
    await seed.pressSequentially(digit);
    expect(await page.evaluate(() => window.__GAME_TEST__.getPlayer().weapon)).toBe(weapon);
  }
  await expect(seed).toHaveValue('12345');
});

test('empty custom numbers use defaults instead of minimum values', async ({ page }) => {
  await page.locator('#modifier-policy').selectOption('normal');
  await page.locator('.custom-panel summary').click();
  await page.locator('#custom-enabled').check();
  await page.locator('#custom-enemy-count').fill('');
  await page.locator('#custom-player-hp').fill('');
  await page.locator('#start').click();
  expect(await page.evaluate(() => window.__GAME_TEST__.getEnemies().length)).toBe(12);
  expect(await page.evaluate(() => window.__GAME_TEST__.getPlayer().maxHealth)).toBe(100);
});

test('cancelling a repeated daily selection restores the original custom setup', async ({ page }) => {
  await page.locator('#seed').fill('RESTORE-MY-RUN');
  await page.locator('#map').selectOption('iron');
  await page.locator('#mode').selectOption('extraction');
  await page.locator('#difficulty').selectOption('hard');
  await page.locator('#modifier-policy').selectOption('normal');
  await page.locator('.custom-panel summary').click();
  await page.locator('#custom-enabled').check();
  await page.locator('.custom-panel summary').click();
  await page.locator('#daily').click();
  await expect(page.locator('#run-kind')).toHaveText('每日挑戰');
  await expect(page.locator('#seed')).not.toHaveValue('RESTORE-MY-RUN');
  await expect(page.locator('#custom-enabled')).not.toBeChecked();
  await page.locator('#daily').click();
  await page.locator('#cancel-daily').click();
  await expect(page.locator('#seed')).toHaveValue('RESTORE-MY-RUN');
  await expect(page.locator('#map')).toHaveValue('iron');
  await expect(page.locator('#mode')).toHaveValue('extraction');
  await expect(page.locator('#difficulty')).toHaveValue('hard');
  await expect(page.locator('#modifier-policy')).toHaveValue('normal');
  await expect(page.locator('#custom-enabled')).toBeChecked();
  await expect(page.locator('#run-kind')).toHaveText('自訂行動');
  await expect(page.locator('#cancel-daily')).toBeHidden();
  await expect(page.locator('#daily')).toBeFocused();
});

test('custom modifier policy reveals the controls and updates the briefing', async ({ page }) => {
  await expect(page.locator('.custom-panel')).not.toHaveAttribute('open');
  await expect(page.locator('#custom-enabled')).not.toBeChecked();
  await page.locator('#modifier-policy').selectOption('custom');
  await expect(page.locator('.custom-panel')).toHaveAttribute('open');
  await expect(page.locator('#custom-enabled')).toBeChecked();
  await page.locator('#custom-modifier').selectOption('low-gravity');
  await expect(page.locator('#briefing-modifier')).toHaveText('LOW GRAVITY');
  await expect(page.locator('#run-kind')).toHaveText('自訂行動');
});

test('unavailable local storage warns without preventing a playable run', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Storage access denied', 'SecurityError'); },
    });
  });
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#save-status')).toBeVisible();
  await expect(page.locator('#save-status')).toContainText('無法儲存');
  await page.locator('#modifier-policy').selectOption('normal');
  await page.getByRole('button', { name: '開始行動' }).click();
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getGameState().phase)).toBe('playing');
  await expect(page.locator('#hud')).toBeVisible();
  expect(await page.evaluate(() => window.__GAME_TEST__.getEnemies().length)).toBeGreaterThan(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
  test(`menu and settings remain usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addStyleTag({ content: 'h1, h2 { font-family: sans-serif; }' });
    const menu = page.locator('#menu');
    await expect(menu).toBeVisible();
    const dimensions = await menu.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: element.clientWidth, scrollWidth: element.scrollWidth };
    });
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(viewport.width);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    expect(await menu.locator('h1').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (viewport.width === 390) await page.screenshot({ path: testInfo.outputPath('menu-mobile.png') });

    await page.locator('#menu-settings').click();
    const panel = page.locator('#settings-panel');
    await expect(panel).toBeVisible();
    const scroll = await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { top: element.scrollTop, height: element.clientHeight, scrollHeight: element.scrollHeight };
    });
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.height);
    expect(scroll.top).toBeGreaterThan(0);
    await expect(page.locator('#close-settings')).toBeInViewport();
    if (viewport.width === 390) await page.screenshot({ path: testInfo.outputPath('settings-mobile.png') });
    await page.locator('#close-settings').click();
    await expect(panel).toBeHidden();
    await expect(menu).toBeVisible();
  });
}
