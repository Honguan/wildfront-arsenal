import { expect, test } from '@playwright/test';

interface PlayerState {
  ads: boolean;
  ammo: number;
  crouching: boolean;
  grounded: boolean;
  maxHealth: number;
  position: number[];
  reloading: boolean;
  vaulting: boolean;
  weapon: string;
  weaponQuality: string;
}

interface GameTestApi {
  ads(value?: boolean): void;
  hurtPlayer(amount?: number, x?: number, z?: number): void;
  fire(): void;
  melee(): boolean;
  inspectWeapon(): boolean;
  damageEnemy(id: number, amount?: number): boolean;
  getEnemies(): Array<{ id: number; health: number; bossType?: string; hasBossSignature: boolean; phase: number; armorBroken: boolean; telegraphing: boolean; heardNoise: string | null; squadId: number; squadRole: string; squadCommand: string | null; position: number[] }>;
  getGameState(): { phase: string; score: number; modifier: string | null; recoilShot: number; effects: number; effectCapacity: number; environmentKills: number; mission: null | { id: string } };
  getLootBoxes(): Array<{ key: string; opened: boolean; quality: string; position: number[] }>;
  getInteractions(): Array<{ key: string; label: string; used: boolean; position: number[] }>;
  getAnimals(): Array<{ type: string; state: string; position: number[] }>;
  getAttachments(): string[];
  grantAttachment(id: string): boolean;
  getRenderState(): { background: string; toneMapping: number; exposure: number; pixelRatio: number; sun: number };
  readCenterPixel(): number[];
  getPlayer(): PlayerState;
  reload(): void;
  openLoot(): boolean;
  interact(): boolean;
  applyPerk(id: string): boolean;
  emitNoise(type?: string, radius?: number): void;
  spawnBoss(type?: string): number | null;
  killEnemy(id: number): boolean;
  setMap(value: string): boolean;
  setPlayerHP(value: number): boolean;
  setWeapon(value: number): boolean;
  setWeather(value: string): boolean;
  setTime(value: string): boolean;
  setEnemyPosition(id: number, x?: number, z?: number): boolean;
  startMission(type: string): boolean;
  teleportPlayer(x: number, z: number, yaw?: number): void;
}

interface DiagnosticApi {
  getState(): {
    complete: boolean;
    mode: string;
    report: null | { averageFps: number; drawCalls: number; enemies: number; onePercentLowFrameTimeMs: number; particles: number; potentialStuckAgents: number; samples: number; triangles: number };
    target: number;
  };
}

declare global {
  interface Window {
    __GAME_TEST__: GameTestApi;
    __GAME_DIAGNOSTICS__: DiagnosticApi;
  }
}

test('reload fills the effective extended magazine capacity', async ({ page }) => {
  await page.goto('./?test=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await page.locator('#modifier-policy').selectOption('normal');
  await page.getByRole('button', { name: '開始行動' }).click();

  expect(await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    api.setWeapon(6);
    const granted = api.grantAttachment('extended-mag');
    api.fire();
    api.reload();
    return granted;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().ammo), { timeout: 3_000 }).toBe(41);
});

test('production build supports the core playable flow', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('./?test=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /Wildfront Arsenal/i })).toBeVisible();
  await expect(page.locator('canvas#game')).toBeAttached();
  await page.getByRole('button', { name: 'Armory', exact: true }).click();
  await expect(page.locator('#armory-list article')).toHaveCount(34);
  await page.locator('#armory-panel .close-menu-panel').click();
  await page.getByRole('button', { name: 'Loadout', exact: true }).click();
  await page.locator('#loadout-slots select').first().selectOption('6');
  await page.locator('#loadout-panel .close-menu-panel').click();
  await page.locator('#modifier-policy').selectOption('normal');
  await page.getByRole('button', { name: '開始行動' }).click();

  const combat = await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    const initialWeapon = api.getPlayer().weapon;
    api.setWeapon(0);
    const ammo = api.getPlayer().ammo;
    api.fire();
    const firedAmmo = api.getPlayer().ammo;
    api.reload();
    api.ads(true);
    return { initialWeapon, ammo, firedAmmo, enemies: api.getEnemies().length, player: api.getPlayer(), game: api.getGameState() };
  });

  expect(combat.game.phase).toBe('playing');
  expect(combat.initialWeapon).toBe('AR-4');
  expect(combat.enemies).toBeGreaterThan(0);
  expect(combat.firedAmmo).toBe(combat.ammo - 1);
  expect(combat.player.reloading).toBe(true);
  expect(combat.player.ads).toBe(true);
  expect(combat.game.recoilShot).toBe(1);
  expect(combat.game.effects).toBeGreaterThan(0);
  expect(combat.game.effects).toBeLessThanOrEqual(combat.game.effectCapacity);
  const weaponActions = await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    api.setWeapon(0);
    const enemy = api.getEnemies()[0];
    api.teleportPlayer(0, 6, 0);
    api.setEnemyPosition(enemy.id, 0, 5);
    const before = api.getEnemies().find(({ id }) => id === enemy.id)!.health;
    const inspect = api.inspectWeapon();
    const melee = api.melee();
    const after = api.getEnemies().find(({ id }) => id === enemy.id)!.health;
    return { melee, inspect, before, after };
  });
  expect(weaponActions).toMatchObject({ melee: true, inspect: true });
  expect(weaponActions.after).toBeLessThan(weaponActions.before);

  const wildlife = await page.evaluate(async () => {
    const api = window.__GAME_TEST__;
    api.emitNoise('gunshot', 100);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return api.getAnimals();
  });
  expect(wildlife.map(({ type }) => type).sort()).toEqual(['bird', 'boar', 'deer', 'rabbit', 'wolf']);
  expect(wildlife.find(({ type }) => type === 'bird')?.state).toBe('flee');
  const hearing = await page.evaluate(async () => {
    const api = window.__GAME_TEST__;
    const enemy = api.getEnemies()[0];
    api.setEnemyPosition(enemy.id, -30, -30);
    api.teleportPlayer(37, 37);
    api.emitNoise('reload', 100);
    await new Promise((resolve) => setTimeout(resolve, 350));
    return api.getEnemies().find(({ id }) => id === enemy.id)?.heardNoise;
  });
  expect(hearing).toBe('reload');

  await page.evaluate(() => {
    const box = window.__GAME_TEST__.getLootBoxes()[0];
    window.__GAME_TEST__.teleportPlayer(box.position[0], box.position[2]);
  });
  await expect(page.locator('#interaction')).toContainText('OPEN NORMAL CACHE');
  const loot = await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    const box = api.getLootBoxes()[0];
    const opened = api.openLoot();
    const attachments = api.getAttachments();
    api.setWeather('rain');
    return { opened, attachments, persisted: api.getLootBoxes().find((candidate) => candidate.key === box.key)?.opened };
  });
  expect(loot).toMatchObject({ opened: true, persisted: true });
  expect(loot.attachments).toHaveLength(1);

  const environment = await page.evaluate(async () => {
    const api = window.__GAME_TEST__;
    const enemy = api.getEnemies()[0];
    const interaction = api.getInteractions().find(({ label }) => label === 'ACTIVATE BRIDGE TRAP')!;
    api.setEnemyPosition(enemy.id, 0, -7);
    api.teleportPlayer(interaction.position[0], interaction.position[2]);
    const activated = api.interact();
    await new Promise((resolve) => setTimeout(resolve, 100));
    api.setWeather('storm');
    return { activated, environmentKills: api.getGameState().environmentKills, persisted: api.getInteractions().find(({ key }) => key === interaction.key)?.used };
  });
  expect(environment).toMatchObject({ activated: true, persisted: true });
  expect(environment.environmentKills).toBeGreaterThan(0);

  const mission = await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    api.startMission('supply');
    const box = api.getLootBoxes().find(({ opened }) => !opened)!;
    api.teleportPlayer(box.position[0], box.position[2]);
    const score = api.getGameState().score;
    api.openLoot();
    return { mission: api.getGameState().mission, reward: api.getGameState().score - score };
  });
  expect(mission).toEqual({ mission: null, reward: 500 });

  const quality = await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    const box = api.getLootBoxes().find(({ quality }) => quality === 'Experimental')!;
    api.teleportPlayer(box.position[0], box.position[2]);
    api.openLoot();
    return api.getPlayer().weaponQuality;
  });
  expect(quality).toBe('Uncommon');
  const perk = await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    const before = api.getPlayer().maxHealth;
    const applied = api.applyPerk('health');
    return { applied, before, after: api.getPlayer().maxHealth };
  });
  expect(perk).toEqual({ applied: true, before: 100, after: 120 });

  const boss = await page.evaluate(() => {
    const api = window.__GAME_TEST__;
    const id = api.spawnBoss('juggernaut');
    if (id === null) return null;
    api.damageEnemy(id, 400);
    return api.getEnemies().find((enemy) => enemy.id === id) ?? null;
  });
  expect(boss).toMatchObject({ bossType: 'juggernaut', hasBossSignature: true, phase: 2, armorBroken: true });
  await expect(page.locator('#boss-hud')).toBeVisible();
  await expect(page.locator('#boss-phase')).toHaveText('PHASE 2');
  await page.evaluate((id) => window.__GAME_TEST__.killEnemy(id), boss!.id);

  await page.evaluate(() => {
    window.__GAME_TEST__.setPlayerHP(20);
    window.__GAME_TEST__.hurtPlayer(1, 8, 0);
  });
  await expect(page.locator('#damage-direction')).toHaveClass(/active/);
  await expect(page.locator('#hud')).toHaveClass(/low-health/);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getGameState().phase)).toBe('paused');
  await page.getByRole('button', { name: '繼續' }).click();
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getGameState().phase)).toBe('playing');

  await page.keyboard.down('Control');
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().crouching)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().position[1])).toBeLessThan(1.7);
  await page.keyboard.up('Control');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().grounded)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().position[1])).toBeGreaterThan(1.7);
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().grounded), { timeout: 2_000 }).toBe(true);

  await page.evaluate(() => {
    window.__GAME_TEST__.setMap('iron');
    window.__GAME_TEST__.teleportPlayer(-6, -6.5, 0);
  });
  await page.keyboard.down('w');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().vaulting)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().position[2])).toBeLessThan(-7);
  await page.keyboard.up('w');
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getPlayer().vaulting), { timeout: 1_000 }).toBe(false);
  expect(await page.evaluate(() => window.__GAME_TEST__.getPlayer().position[2])).toBeLessThan(-8.4);

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__GAME_TEST__.getGameState().phase)).toBe('paused');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#setting-quality').selectOption('low');
  await expect(page.locator('#quality-value')).toContainText('LOW');
  expect(await page.evaluate(() => (document.querySelector('#game') as HTMLCanvasElement).width / innerWidth)).toBeCloseTo(.75, 1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wildfront-save') ?? '{}').settings.quality)).toBe('low');
  await page.locator('#setting-master').fill('25');
  await page.locator('#setting-resolution').fill('50');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wildfront-save') ?? '{}').settings.masterVolume)).toBe(25);
  expect(await page.evaluate(() => (document.querySelector('#game') as HTMLCanvasElement).width / innerWidth)).toBeCloseTo(.375, 1);
  await page.getByRole('button', { name: '返回' }).click();
  await page.evaluate(() => window.__GAME_TEST__.setPlayerHP(0));
  await expect(page.getByRole('heading', { name: '你倒下了' })).toBeVisible();
  await page.getByRole('button', { name: '返回主選單' }).last().click();
  await expect(page.getByRole('button', { name: '開始行動' })).toBeVisible();
  await page.locator('#seed').fill('WORLD-MODIFIER-TEST');
  await page.locator('#modifier-policy').selectOption('random');
  await page.getByRole('button', { name: '開始行動' }).click();
  expect(await page.evaluate(() => window.__GAME_TEST__.getGameState().modifier)).not.toBeNull();
  expect(runtimeErrors).toEqual([]);
});

test('core loading failure offers recovery actions', async ({ page }) => {
  await page.goto('./?failCore=1');
  await expect(page.getByText('Failed to load required game data.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear Cache' })).toBeVisible();
  await page.getByRole('button', { name: 'Return' }).click();
  await expect(page.getByRole('heading', { name: /Wildfront Arsenal/i })).toBeVisible();
});

test('diagnostic routes create their specified real enemy loads', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./?benchmark=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  expect(await page.evaluate(() => ({ diagnostic: window.__GAME_DIAGNOSTICS__.getState(), enemies: window.__GAME_TEST__.getEnemies().length }))).toMatchObject({
    diagnostic: { mode: 'benchmark', target: 25 },
    enemies: 25,
  });
  await expect.poll(() => page.evaluate(() => window.__GAME_DIAGNOSTICS__.getState().complete), { timeout: 15_000 }).toBe(true);
  const report = await page.evaluate(() => window.__GAME_DIAGNOSTICS__.getState().report);
  expect(report).toMatchObject({ enemies: 25, particles: 120 });
  expect(report?.averageFps).toBeGreaterThan(0);
  expect(report?.drawCalls).toBeLessThanOrEqual(110);
  expect(report?.samples).toBeGreaterThan(0);
  expect(report?.onePercentLowFrameTimeMs).toBeGreaterThan(0);
  expect(report?.triangles).toBeLessThanOrEqual(5_200);

  await page.goto('./?aiStress=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  const stressState = await page.evaluate(() => ({ diagnostic: window.__GAME_DIAGNOSTICS__.getState(), enemies: window.__GAME_TEST__.getEnemies().length }));
  expect(stressState.diagnostic.mode).toBe('ai-stress');
  expect(stressState.diagnostic.target).toBeGreaterThanOrEqual(10);
  expect(stressState.diagnostic.target).toBeLessThanOrEqual(50);
  expect(stressState.enemies).toBe(stressState.diagnostic.target);
  await expect.poll(() => page.evaluate(() => window.__GAME_DIAGNOSTICS__.getState().complete), { timeout: 30_000 }).toBe(true);
  const stressReport = await page.evaluate(() => window.__GAME_DIAGNOSTICS__.getState().report);
  expect(stressReport?.drawCalls).toBeLessThanOrEqual(200);
  expect(stressReport?.potentialStuckAgents).toBe(0);
  expect(stressReport?.triangles).toBeLessThanOrEqual(9_000);
});
