import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ATTACHMENTS, BOSSES, CHAOS_MODIFIERS, CONTENT_MANIFEST, DIFFICULTIES, ENEMY_TYPES, MAPS, MODES, PERKS, WEAPONS, WEAPON_QUALITIES, circleIntersectsRectangle, createDailyChallenge, createRng, createRun, createWave, pickPerks, rollElite, shotDamage } from '../src/rules.js';
import { SAVE_KEY, SAVE_VERSION, loadSave, saveGame } from '../src/core/SaveManager.ts';
import { createFixedStep } from '../src/core/GameLoop.ts';
import { stressTarget, summarizePerformance } from '../src/debug/PerformanceHarness.ts';
import { findVaultTarget } from '../src/player/Vault.ts';
import { RECOIL_PROFILES, recoilFor } from '../src/weapons/Recoil.ts';
import { bossPhase } from '../src/enemies/BossPhases.ts';
import { chooseCover, coverPointsForBox } from '../src/enemies/Cover.ts';
import { canHear, memorySeconds } from '../src/enemies/Perception.ts';
import { comboLabel, scoreKill } from '../src/combat/Scoring.ts';
import { createMission, progressMission } from '../src/missions/Missions.ts';
import { applyArmor } from '../src/combat/Armor.ts';
import { environmentMix, musicMix } from '../src/audio.js';
import { FACTIONS, createVisualIdentity, factionFor } from '../src/enemies/Visuals.ts';
import { createProgress, recordRun, summarizeProgress } from '../src/progress.js';
import { createShotEffects } from '../src/effects/ShotEffects.ts';

test('content, seed, and progression rules stay intact', () => {
  assert.equal(WEAPONS.length, 20);
  assert.equal(MAPS.length, 6);
  assert.equal(MAPS.filter(({ available }) => available !== false).length, 3);
  assert.equal(Object.keys(MODES).length, 5);
  assert.equal(CHAOS_MODIFIERS.length, 14);
  assert.equal(Object.keys(ENEMY_TYPES).length, 12);
  assert.equal(BOSSES.length, 5);
  assert.equal(CONTENT_MANIFEST.weapons, WEAPONS);
  assert.equal(CONTENT_MANIFEST.attachments, ATTACHMENTS);
  assert.equal(ATTACHMENTS.length, 14);
  assert.deepEqual(WEAPON_QUALITIES.map(({ label }) => label), ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
  assert.equal(PERKS.length, 16);
  assert.equal(new Set(PERKS.map(({ id }) => id)).size, 16);
  assert.equal(new Set(WEAPONS.map(({ id }) => id)).size, WEAPONS.length);
  assert.ok(createWave(2, 'normal').includes('scout'));
  assert.ok(createWave(3, 'normal').includes('rifleman'));
  assert.ok(createWave(3, 'hard').length > createWave(3, 'easy').length);
  assert.equal(DIFFICULTIES.hard.health, undefined, 'difficulty must not inflate enemy health');
  assert.equal(shotDamage(WEAPONS[0], true, 1), WEAPONS[0].damage * 2.2);
  assert.deepEqual(createRun('shared-seed'), createRun('shared-seed'));
  assert.equal(createRun('shared-seed', 'iron').map, 'iron');
  assert.equal(new Set(createRun('shared-seed').loadout).size, 5);
  assert.deepEqual(pickPerks(createRng('perks')), pickPerks(createRng('perks')));
  assert.equal(pickPerks(createRng('perks')).length, 3);
  assert.deepEqual(rollElite(() => 0, 8), ['armored']);
  assert.ok(createWave(7, 'normal').includes('medic'));
  assert.ok(createWave(10, 'normal').includes('berserker'));
  assert.deepEqual(createDailyChallenge('2026-08-11'), createDailyChallenge('2026-08-11'));
  assert.equal(createDailyChallenge('invalid').date, '1970-01-01');
});

test('shot effects reuse bounded tracer, impact, casing, and explosion pools', () => {
  const effects = createShotEffects(1, 1, 1, 1);
  const point = new THREE.Vector3();
  effects.spawnTracer(point, new THREE.Vector3(1, 0, 0), 0xffffff);
  effects.spawnImpact(point, 'metal');
  effects.spawnCasing(point);
  effects.spawnExplosion(point);
  assert.equal(effects.capacity, 4);
  assert.equal(effects.activeCount(), 4);
  effects.update(1);
  assert.equal(effects.activeCount(), 0);
});

test('one hundred procedural seeds produce valid playable manifests', () => {
  for (let index = 1; index <= 100; index += 1) {
    const run = createRun(`Seed ${index}`);
    const map = MAPS.find(({ id }) => id === run.map);
    assert.ok(map?.available !== false);
    assert.ok(map.weather.includes(run.weather));
    assert.ok(['dawn', 'day', 'sunset', 'night'].includes(run.time));
    assert.equal(run.loadout.length, 5);
    assert.equal(new Set(run.loadout).size, 5);
    for (const difficulty of Object.keys(DIFFICULTIES)) {
      const wave = createWave(index % 10 + 1, difficulty);
      assert.ok(wave.length >= 3);
      assert.ok(wave.every((type) => ENEMY_TYPES[type]));
    }
  }
});

test('legacy progress migrates once into a versioned save envelope', () => {
  const values = new Map([['wildfront-progress', JSON.stringify({ kills: 7, highestScore: 900 })]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value)
  };
  const migrated = loadSave(storage);
  assert.equal(migrated.version, SAVE_VERSION);
  assert.equal(migrated.progress.kills, 7);
  assert.equal(values.has('wildfront-progress'), false);
  assert.ok(values.has(SAVE_KEY));
  assert.equal(saveGame(storage, migrated.progress, { fov: 500, crosshair: 'invalid', masterVolume: 500, fpsLimit: 45 }), true);
  const saved = JSON.parse(values.get(SAVE_KEY));
  assert.equal(saved.settings.fov, 100);
  assert.equal(saved.settings.crosshair, '#f5faed');
  assert.equal(saved.settings.masterVolume, 100);
  assert.equal(saved.settings.fpsLimit, 0);
  assert.equal(saved.statistics.highestScore, 900);
});

test('run results accumulate into persistent statistics and achievements', () => {
  assert.equal(createProgress({ kills: 'corrupt' }).kills, 0);
  const progress = recordRun(createProgress(), {
    playTime: 90, kills: 2, deaths: 1, shots: 10, hits: 5, headshots: 1, wave: 3, score: 800,
    bossKills: 0, eliteKills: 1, untouchedWaves: 1, weaponShots: { P9: 10 }, weaponKills: { P9: 2 }
  });
  assert.equal(summarizeProgress(progress).accuracy, '50%');
  assert.equal(summarizeProgress(progress).favoriteWeapon, 'P9');
  assert.ok(progress.achievements.includes('first-blood'));
  assert.ok(progress.achievements.includes('untouchable'));
});

test('player circle stops at obstacle edges and corners', () => {
  assert.equal(circleIntersectsRectangle(0, 0, .4, 1, 2, 1, 2), false);
  assert.equal(circleIntersectsRectangle(.6, 1.5, .4, 1, 2, 1, 2), true);
  assert.equal(circleIntersectsRectangle(.7, .7, .4, 1, 2, 1, 2), false);
});

test('performance reports calculate stable benchmark and stress metrics', () => {
  assert.equal(stressTarget(0), 10);
  assert.equal(stressTarget(5), 20);
  assert.equal(stressTarget(999), 50);
  const report = summarizePerformance([10, 20, 40], { drawCalls: 8, enemies: 25, memoryMb: 12, particles: 120, textureMemoryEstimateMb: 0, triangles: 3000 });
  assert.equal(report.samples, 3);
  assert.equal(report.onePercentLowFrameTimeMs, 40);
  assert.equal(report.frameSpikes, 1);
  assert.equal(report.enemies, 25);
});

test('fixed game loop caps catch-up work and preserves its remainder', () => {
  const advance = createFixedStep(.125, 3);
  let updates = 0;
  const first = advance(.3125, () => { updates += 1; });
  assert.equal(first.steps, 2);
  assert.equal(first.alpha, .5);
  const second = advance(1, () => { updates += 1; });
  assert.equal(second.steps, 3);
  assert.equal(updates, 5);
});

test('vault requires a low obstacle, clear route, and clear landing', () => {
  const lowObstacle = { minX: -.5, maxX: .5, minY: 0, maxY: 1, minZ: -1.5, maxZ: -.8 };
  const target = findVaultTarget({ x: 0, z: 0 }, { x: 0, z: -1 }, [lowObstacle]);
  assert.ok(target);
  assert.ok(target.z < lowObstacle.minZ);
  assert.equal(findVaultTarget({ x: 0, z: 0 }, { x: 0, z: -1 }, [{ ...lowObstacle, maxY: 2 }]), null);
  assert.equal(findVaultTarget({ x: 0, z: 0 }, { x: 0, z: -1 }, [lowObstacle, { ...lowObstacle, minZ: -2.4, maxZ: -1.6 }]), null);
});

test('weapon recoil is deterministic, cyclic, and reduced while aiming', () => {
  const first = recoilFor('rifle', 0);
  assert.deepEqual(recoilFor('rifle', RECOIL_PROFILES.rifle.pattern.length), first);
  assert.ok(recoilFor('rifle', 0, true).pitch < first.pitch);
  assert.equal(WEAPONS.every(({ recoil }) => recoil in RECOIL_PROFILES), true);
});

test('boss phases advance at the readable health thresholds', () => {
  assert.equal(bossPhase(100, 100), 1);
  assert.equal(bossPhase(70, 100), 2);
  assert.equal(bossPhase(40, 100), 3);
  assert.equal(bossPhase(10, 100), 4);
});

test('cover selection avoids occupied points and favors protection', () => {
  const points = coverPointsForBox({ min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 1, z: 1 } });
  const first = chooseCover(points, { x: 0, z: -5 }, { x: 0, z: 5 });
  assert.ok(first);
  assert.ok(first.normalZ < 0);
  first.occupancy = 7;
  assert.notEqual(chooseCover(points, { x: 0, z: -5 }, { x: 0, z: 5 })?.id, first.id);
});

test('AI hearing is range-limited and hard mode remembers longer', () => {
  assert.equal(canHear(8, 9), true);
  assert.equal(canHear(10, 9), false);
  assert.ok(memorySeconds('hard') > memorySeconds('normal'));
});

test('combo scoring includes special kills and a capped multiplier', () => {
  assert.equal(comboLabel(2), 'DOUBLE KILL');
  assert.equal(comboLabel(10), 'MASSACRE');
  const scored = scoreKill(100, { headshot: true, distance: 35, airborne: true, combo: 20 });
  assert.equal(scored.multiplier, 2);
  assert.equal(scored.total, 600);
  assert.deepEqual(scored.bonuses, ['HEADSHOT', 'LONGSHOT', 'AIR KILL']);
});

test('missions only advance from their matching gameplay event', () => {
  const mission = createMission(() => 0, 'P9', 'headshot');
  assert.equal(progressMission(mission, 'elite').progress, 0);
  let progressed = mission;
  for (let index = 0; index < 5; index += 1) progressed = progressMission(progressed, 'headshot');
  assert.equal(progressed.complete, true);
  assert.equal(progressMission(createMission(() => 0, 'P9', 'no-damage'), 'damage').failed, true);
});

test('armor reduces ordinary rounds, breaks, and yields to penetration', () => {
  assert.equal(applyArmor(100, 100, .2).damage, 48);
  assert.equal(applyArmor(100, 100, 1).damage, 100);
  assert.deepEqual(applyArmor(100, 50, .2), { damage: 48, durability: 0, broken: true });
});

test('music mix crossfades exploration, combat, and boss tension', () => {
  assert.ok(musicMix(0, 'exploration').exploration > musicMix(1, 'combat').exploration);
  assert.ok(musicMix(1, 'boss').combat > musicMix(.5, 'combat').combat);
  assert.equal(musicMix(1, 'boss').pulse, 172);
  assert.ok(environmentMix('iron', 'storm', 'day').gain > environmentMix('iron', 'clear', 'day').gain);
  assert.ok(environmentMix('prism', 'clear', 'night').frequency < environmentMix('prism', 'clear', 'day').frequency);
});

test('enemy visual identities cover four factions and modular variants', () => {
  assert.deepEqual(new Set(['grunt', 'rifleman', 'drone', 'hunter'].map(factionFor)), new Set(FACTIONS));
  assert.deepEqual(createVisualIdentity('rifleman', () => .99), { faction: 'Helix Security', helmet: 2, chest: 2, shoulder: 1, palette: 2 });
});
