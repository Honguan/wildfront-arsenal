import { CHAOS_MODIFIERS, DIFFICULTIES, ELITE_TRAITS, MAPS, PERKS, WEAPONS } from './data/content-manifest.ts';

export { ATTACHMENTS, BOSSES, CHAOS_MODIFIERS, CONTENT_MANIFEST, DIFFICULTIES, ELITE_TRAITS, ENEMY_TYPES, MAPS, MODES, PERKS, WEATHER, WEAPONS, WEAPON_QUALITIES } from './data/content-manifest.ts';

export function seedNumber(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed) {
  let value = seedNumber(seed);
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

export function createRun(seed, requestedMap = 'random') {
  const rng = createRng(seed);
  const availableMaps = MAPS.filter(({ available }) => available !== false);
  const map = MAPS.find(({ id }) => id === requestedMap) ?? availableMaps[Math.floor(rng() * availableMaps.length)];
  const weather = map.weather[Math.floor(rng() * map.weather.length)];
  const time = ['dawn', 'day', 'sunset', 'night'][Math.floor(rng() * 4)];
  const weapons = WEAPONS.map((_, index) => index);
  for (let index = weapons.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [weapons[index], weapons[target]] = [weapons[target], weapons[index]];
  }
  return { seed: String(seed), map: map.id, weather, time, loadout: weapons.slice(0, 5) };
}

export function createDailyChallenge(date) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '1970-01-01';
  const seed = `DAILY-${day}`;
  const run = createRun(seed);
  const rng = createRng(`${seed}:CHALLENGE`);
  return {
    date: day,
    seed,
    map: run.map,
    weather: run.weather,
    weapon: Math.floor(rng() * WEAPONS.length),
    modifier: CHAOS_MODIFIERS[Math.floor(rng() * CHAOS_MODIFIERS.length)].id,
    goal: 40 + Math.floor(rng() * 4) * 10,
  };
}

export function pickPerks(rng) {
  const perks = [...PERKS];
  for (let index = perks.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [perks[index], perks[target]] = [perks[target], perks[index]];
  }
  return perks.slice(0, 3);
}

export function rollElite(rng, wave) {
  if (wave < 2 || rng() >= Math.min(.3, .08 + wave * .015)) return [];
  const available = [...ELITE_TRAITS];
  const traits = [];
  const count = 1 + Math.floor(rng() * Math.min(3, 1 + Math.floor(wave / 4)));
  while (traits.length < count) traits.push(available.splice(Math.floor(rng() * available.length), 1)[0]);
  return traits;
}

export function createWave(wave, difficulty) {
  const count = Math.max(3, Math.round((3 + wave * 1.5) * DIFFICULTIES[difficulty].spawn));
  const pool = ['grunt'];
  if (wave >= 2) pool.push('scout', 'shotgunner');
  if (wave >= 3) pool.push('rifleman');
  if (wave >= 4) pool.push('shield');
  if (wave >= 5) pool.push('heavy');
  if (wave >= 6) pool.push('sniper');
  if (wave >= 7) pool.push('medic');
  if (wave >= 8) pool.push('commander', 'hunter');
  if (wave >= 9) pool.push('drone');
  if (wave >= 10) pool.push('berserker');
  return Array.from({ length: count }, (_, index) => pool[(index + wave) % pool.length]);
}

export function shotDamage(weapon, headshot, damageLevel, distance = 0) {
  const falloff = distance > weapon.falloff ? Math.max(.55, 1 - (distance - weapon.falloff) / 100) : 1;
  return weapon.damage * (headshot ? weapon.critical ?? 2 : 1) * (1 + damageLevel * 0.1) * falloff;
}

export function circleIntersectsRectangle(x, z, radius, minX, maxX, minZ, maxZ) {
  const nearestX = Math.max(minX, Math.min(x, maxX));
  const nearestZ = Math.max(minZ, Math.min(z, maxZ));
  return (x - nearestX) ** 2 + (z - nearestZ) ** 2 <= radius ** 2;
}
