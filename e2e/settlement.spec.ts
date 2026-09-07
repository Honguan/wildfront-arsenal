import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./?test=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
});

test('daily winning shot is included in saved accuracy and a settled result cannot be replaced', async ({ page }) => {
  await page.locator('#daily').click();
  const goal = Number((await page.locator('#daily-summary').innerText()).match(/目標 (\d+)/)![1]);
  await page.locator('#start').click();
  await page.evaluate((goal) => {
    const api = window.__GAME_TEST__ as typeof window.__GAME_TEST__ & { spawnEnemy(type: string): number; setModifier(value: null): void };
    api.setModifier(null);
    api.setMap('iron');
    api.setPlayerHP(10000);
    api.teleportPlayer(0, 6, 0);
    for (const enemy of api.getEnemies()) api.setEnemyPosition(enemy.id, 30, 30);
    for (let i = 0; i < goal - 1; i++) api.killEnemy(api.spawnEnemy('grunt'));
    const target = api.spawnEnemy('grunt');
    api.setEnemyPosition(target, 0, 4);
    api.setWeapon(0);
    for (let i = 0; i < 30; i++) api.applyPerk('damage');
    api.readCenterPixel();
    api.fire();
    // A nonterminal phase change before the microtask must not drop the win.
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  }, goal);
  await expect(page.locator('#victory')).toBeVisible();
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('wildfront-save')!).progress);
  expect(progress).toMatchObject({ shots: 1, hits: 1, deaths: 0 });
  expect(progress.kills).toBeGreaterThanOrEqual(goal);
  await page.evaluate(() => window.__GAME_TEST__.setPlayerHP(0));
  await expect(page.locator('#victory')).toBeVisible();
  await expect(page.locator('#game-over')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wildfront-save')!).progress)).toEqual(progress);
});

test('paused time is excluded from career play time', async ({ page }) => {
  await page.locator('#modifier-policy').selectOption('normal');
  await page.locator('#start').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  await page.evaluate(() => {
    const now = performance.now.bind(performance);
    performance.now = () => now() + 60_000;
    window.__GAME_TEST__.setPlayerHP(0);
  });
  await expect(page.locator('#game-over')).toBeVisible();
  const elapsed = await page.evaluate(() => JSON.parse(localStorage.getItem('wildfront-save')!).progress.playTime);
  expect(elapsed).toBeGreaterThanOrEqual(0);
  expect(elapsed).toBeLessThan(30);
});
