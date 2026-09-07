import { expect, test } from '@playwright/test';

type ModelApi = typeof window.__GAME_TEST__ & {
  getWeaponModel(): { id: string; uuid: string; cacheSize: number; magazineY: number; boltZ: number; muzzle: number[]; attachments: string[]; tracerStarts: number[][]; geometries: number };
};

test.beforeEach(async ({ page }) => {
  await page.goto('./?test=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
});

test('armory filters and equips a persistent loadout used by the next run', async ({ page }) => {
  await page.locator('#armory').click();
  await page.locator('#armory-category').selectOption('SNIPER');
  await expect(page.locator('#armory-list article:visible')).toHaveCount(2);
  await page.locator('#armory-search').fill('bolt');
  await expect(page.locator('#armory-list article:visible')).toHaveCount(1);
  await page.locator('#armory-slot').selectOption('0');
  await page.getByRole('button', { name: '裝備 Bolt Sniper', exact: true }).click();
  await expect(page.locator('#armory-status')).toContainText('欄位 1');
  await page.keyboard.press('Escape');
  await page.locator('#loadout').click();
  await expect(page.locator('#loadout-slots select').first()).toHaveValue('9');
  await page.keyboard.press('Escape');
  await page.locator('#menu-settings').click();
  await page.locator('#setting-master').fill('15');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden();
  await page.locator('#modifier-policy').selectOption('normal');
  await page.locator('#start').click();
  expect(await page.evaluate(() => window.__GAME_TEST__.getPlayer().weapon)).toBe('Bolt Sniper');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wildfront-save')!).loadout[0])).toBe('bolt-sniper');
});

test('weapon models are reused, attachments reach the muzzle, and tracers start there', async ({ page }, testInfo) => {
  await page.locator('#modifier-policy').selectOption('normal');
  await page.locator('#start').click();
  const result = await page.evaluate(() => {
    const api = window.__GAME_TEST__ as ModelApi;
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      api.setWeapon(i);
      api.readCenterPixel();
      ids.push(api.getWeaponModel().uuid);
    }
    const warm = api.getWeaponModel();
    for (let i = 0; i < 20; i++) {
      api.setWeapon(i);
      api.readCenterPixel();
      if (api.getWeaponModel().uuid !== ids[i]) throw new Error('Weapon model was rebuilt');
    }
    const reused = api.getWeaponModel();
    api.setWeapon(9);
    api.grantAttachment('red-dot');
    api.grantAttachment('8x');
    api.grantAttachment('suppressor');
    api.grantAttachment('flashlight');
    api.teleportPlayer(0, 6, 0);
    api.fire();
    return { warm, reused, fired: api.getWeaponModel() };
  });
  expect(result.reused.cacheSize).toBe(20);
  expect(result.reused.geometries).toBe(result.warm.geometries);
  expect(result.fired.id).toBe('bolt-sniper');
  expect(result.fired.attachments).toEqual(['8x', 'suppressor', 'flashlight']);
  expect(result.fired.tracerStarts).toHaveLength(1);
  result.fired.tracerStarts[0].forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(result.fired.muzzle[axis], 4));
  for (const weapon of [{ index: 9, name: 'bolt-sniper' }, { index: 8, name: 'pump-shotgun' }, { index: 15, name: 'minigun' }, { index: 16, name: 'railgun' }]) {
    await page.evaluate((index) => {
      const api = window.__GAME_TEST__;
      api.setMap('iron');
      api.setTime('day');
      api.teleportPlayer(0, 6, 0);
      api.setWeapon(index);
      api.ads(false);
    }, weapon.index);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__GAME_TEST__.readCenterPixel())).not.toEqual([255, 255, 255, 255]);
    await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
      const frame = document.createElement('img');
      frame.id = 'model-frame';
      frame.src = canvas.toDataURL('image/png');
      Object.assign(frame.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '0' });
      document.body.prepend(frame);
      canvas.style.visibility = 'hidden';
      await frame.decode();
    });
    await page.screenshot({ path: testInfo.outputPath(`${weapon.name}.png`) });
    await page.evaluate(() => {
      document.querySelector('#model-frame')!.remove();
      document.querySelector<HTMLCanvasElement>('#game')!.style.visibility = '';
    });
  }
});

test('selecting the active slot preserves reload while wheel switching preserves each magazine', async ({ page }) => {
  await page.locator('#modifier-policy').selectOption('normal');
  await page.locator('#start').click();
  await page.evaluate(() => { window.__GAME_TEST__.setWeapon(14); window.__GAME_TEST__.fire(); });
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().reloading)).toBe(true);
  await page.keyboard.press('1');
  expect(await page.evaluate(() => window.__GAME_TEST__.getPlayer().reloading)).toBe(true);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().weapon)).toBe('Heavy Revolver');
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().weapon)).toBe('LMG');
  expect(await page.evaluate(() => window.__GAME_TEST__.getPlayer().ammo)).toBe(74);
});

test('distant bosses retain their identifying model and weak point on low detail', async ({ page }) => {
  await page.locator('#modifier-policy').selectOption('normal');
  await page.locator('#start').click();
  const id = await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    const id = api.spawnBoss('juggernaut')!;
    api.teleportPlayer(0, 6, 0);
    api.setEnemyPosition(id, 0, -30);
    return id;
  });
  await expect.poll(() => page.evaluate((id) => window.__GAME_TEST__.getEnemies().find(enemy => enemy.id === id), id)).toMatchObject({ lowDetail: true, signatureVisible: true, weakPointVisible: true });
});
