import { expect, test } from '@playwright/test';

test('production visual baseline set is captured', async ({ page }, testInfo) => {
  const capture = async (name: string) => {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__GAME_TEST__.readCenterPixel());
    await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
      const frame = document.createElement('img');
      frame.id = 'visual-frame';
      frame.src = canvas.toDataURL('image/png');
      Object.assign(frame.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '0' });
      document.body.prepend(frame);
      canvas.style.visibility = 'hidden';
      await frame.decode();
    });
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, animations: 'disabled' });
    await testInfo.attach(name, { path, contentType: 'image/png' });
    await page.evaluate(() => { document.querySelector('#visual-frame')?.remove(); document.querySelector<HTMLCanvasElement>('#game')!.style.visibility = ''; });
  };
  await page.goto('./?test=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await capture('01-main-menu');

  await page.getByRole('button', { name: 'Loadout', exact: true }).click();
  await capture('02-loadout');
  await page.locator('#loadout-panel .close-menu-panel').click();
  await page.locator('#modifier-policy').selectOption('normal');
  await page.getByRole('button', { name: '開始行動' }).click();

  await page.evaluate(() => { window.__GAME_TEST__.setMap('verdant'); window.__GAME_TEST__.setWeather('clear'); window.__GAME_TEST__.setTime('day'); window.__GAME_TEST__.teleportPlayer(-14, 0, 0); });
  expect(await page.evaluate(() => window.__GAME_TEST__.getRenderState())).toMatchObject({ background: '101d16', exposure: 1.05, sun: 2.4 });
  expect(await page.evaluate(() => window.__GAME_TEST__.readCenterPixel())).not.toEqual([255, 255, 255, 255]);
  await capture('03-verdant-day');
  await page.evaluate(() => window.__GAME_TEST__.setWeather('rain'));
  await capture('04-verdant-rain');
  await page.evaluate(() => { window.__GAME_TEST__.setMap('iron'); window.__GAME_TEST__.setWeather('clear'); window.__GAME_TEST__.teleportPlayer(0, 24, 0); });
  await capture('05-iron-depot');
  await page.evaluate(() => { window.__GAME_TEST__.setMap('prism'); window.__GAME_TEST__.setWeather('clear'); window.__GAME_TEST__.teleportPlayer(0, 24, 0); });
  await capture('06-prism-arena');

  await page.evaluate(() => {
    const enemy = window.__GAME_TEST__.getEnemies()[0];
    window.__GAME_TEST__.teleportPlayer(0, 6, 0);
    window.__GAME_TEST__.setEnemyPosition(enemy.id, 0, 1);
  });
  await capture('07-enemy-closeup');
  await page.evaluate(() => window.__GAME_TEST__.ads(true));
  await capture('08-weapon-ads');
  await page.evaluate(() => { const id = window.__GAME_TEST__.spawnBoss('juggernaut'); if (id !== null) window.__GAME_TEST__.setEnemyPosition(id, 0, 0); });
  await capture('09-boss');

  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
  await capture('10-pause');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await capture('11-settings');
  await page.locator('#close-settings').click();
  await page.evaluate(() => window.__GAME_TEST__.setPlayerHP(0));
  await expect(page.locator('#game-over')).toBeVisible();
  await capture('12-game-over');
});
