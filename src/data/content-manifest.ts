import type { RecoilProfileId } from '../weapons/Recoil.ts';

export interface WeaponDefinition {
  id: string;
  name: string;
  category: string;
  damage: number;
  rate: number;
  magazine: number;
  reserve: number;
  reload: number;
  spread: number;
  falloff: number;
  color: number;
  recoil: RecoilProfileId;
  adsFov?: number;
  automatic?: boolean;
  critical?: number;
  movePenalty?: number;
  overheat?: number;
  pellets?: number;
  penetration?: number;
  shellReload?: boolean;
  armorPenetration?: number;
}

export interface MapDefinition {
  id: string;
  name: string;
  available?: boolean;
  ground: number;
  clearing: number;
  sky: number;
  fog: number;
  accent: number;
  weather: string[];
}

export interface EnemyDefinition {
  label: string;
  health: number;
  speed: number;
  range: number;
  damage: number;
  fireDelay: number;
  behavior: 'flank' | 'hold' | 'rush' | 'skirmish' | 'support';
  color: number;
  score: number;
  commander?: boolean;
  flying?: boolean;
  medic?: boolean;
  shield?: boolean;
}

export interface BossDefinition {
  id: string;
  label: string;
  enemy: string;
  health: number;
  speed: number;
  range: number;
  damage: number;
  fireDelay: number;
  behavior: EnemyDefinition['behavior'];
  ability?: 'summon' | 'teleport';
}

export interface AttachmentDefinition {
  id: string;
  name: string;
  slot: 'sight' | 'barrel' | 'magazine' | 'grip' | 'special';
  spread?: number;
  recoil?: number;
  reload?: number;
  magazine?: number;
  falloff?: number;
  adsFov?: number;
  noise?: number;
}

export const WEAPON_QUALITIES = [
  { id: 'common', label: 'Common', reload: 1, recoil: 1, penetration: 0, reserve: 1 },
  { id: 'uncommon', label: 'Uncommon', reload: .94, recoil: .95, penetration: 0, reserve: 1.1 },
  { id: 'rare', label: 'Rare', reload: .88, recoil: .88, penetration: 1, reserve: 1.2 },
  { id: 'epic', label: 'Epic', reload: .82, recoil: .8, penetration: 1, reserve: 1.35 },
  { id: 'legendary', label: 'Legendary', reload: .74, recoil: .72, penetration: 2, reserve: 1.5 },
] as const;

export const WEAPONS = [
  { id: 'p9', name: 'P9', category: 'PISTOL', damage: 28, rate: 300, magazine: 12, reserve: 72, reload: 1.1, spread: 0.004, falloff: 42, recoil: 'sidearm', color: 0xd6c38a },
  { id: 'heavy-revolver', name: 'Heavy Revolver', category: 'PISTOL', damage: 58, rate: 150, magazine: 6, reserve: 42, reload: 1.65, spread: 0.006, critical: 2.25, falloff: 50, movePenalty: .96, recoil: 'precision', armorPenetration: .5, color: 0xc68a57 },
  { id: 'machine-pistol', name: 'Machine Pistol', category: 'PISTOL', damage: 15, rate: 900, magazine: 24, reserve: 144, reload: 1.45, spread: 0.021, falloff: 24, automatic: true, recoil: 'smg', color: 0x78b99a },
  { id: 'smg-9', name: 'SMG-9', category: 'SMG', damage: 16, rate: 750, magazine: 30, reserve: 150, reload: 1.55, spread: 0.016, falloff: 28, automatic: true, recoil: 'smg', color: 0x4dd2a5 },
  { id: 'vector-smg', name: 'Vector SMG', category: 'SMG', damage: 13, rate: 1050, magazine: 27, reserve: 162, reload: 1.7, spread: 0.019, falloff: 22, automatic: true, recoil: 'smg', color: 0x5fc9d1 },
  { id: 'heavy-smg', name: 'Heavy SMG', category: 'SMG', damage: 23, rate: 520, magazine: 36, reserve: 144, reload: 2.05, spread: 0.014, falloff: 32, movePenalty: .92, automatic: true, recoil: 'heavy', color: 0x8da28e },
  { id: 'ar-4', name: 'AR-4', category: 'ASSAULT', damage: 24, rate: 600, magazine: 30, reserve: 120, reload: 1.8, spread: 0.009, falloff: 48, movePenalty: .96, automatic: true, recoil: 'rifle', color: 0xe5a43b },
  { id: 'burst-rifle', name: 'Burst Rifle', category: 'ASSAULT', damage: 30, rate: 420, magazine: 24, reserve: 120, reload: 1.9, spread: 0.006, falloff: 55, movePenalty: .94, automatic: true, recoil: 'rifle', color: 0xd08e52 },
  { id: 'pump-shotgun', name: 'Pump Shotgun', category: 'SHOTGUN', damage: 13, pellets: 8, rate: 75, magazine: 6, reserve: 42, reload: 0.48, spread: 0.065, falloff: 16, movePenalty: .91, shellReload: true, recoil: 'shotgun', color: 0xcb684e },
  { id: 'bolt-sniper', name: 'Bolt Sniper', category: 'SNIPER', damage: 95, rate: 45, magazine: 5, reserve: 30, reload: 2.4, spread: 0.001, critical: 2.5, falloff: 90, movePenalty: .86, adsFov: 32, penetration: 2, recoil: 'precision', armorPenetration: .7, color: 0x8db8cf },
  { id: 'auto-shotgun', name: 'Auto Shotgun', category: 'SHOTGUN', damage: 9, pellets: 7, rate: 240, magazine: 10, reserve: 50, reload: 2.3, spread: 0.075, falloff: 14, movePenalty: .86, automatic: true, recoil: 'shotgun', color: 0xc45f45 },
  { id: 'dmr', name: 'DMR', category: 'MARKSMAN', damage: 52, rate: 220, magazine: 15, reserve: 75, reload: 2, spread: 0.003, critical: 2.2, falloff: 72, movePenalty: .9, adsFov: 42, penetration: 2, recoil: 'precision', color: 0x9eae78 },
  { id: 'battle-rifle', name: 'Battle Rifle', category: 'MARKSMAN', damage: 44, rate: 340, magazine: 20, reserve: 100, reload: 2.15, spread: 0.006, falloff: 62, movePenalty: .88, automatic: true, recoil: 'rifle', color: 0x8f795e },
  { id: 'semi-auto-sniper', name: 'Semi-auto Sniper', category: 'SNIPER', damage: 72, rate: 120, magazine: 8, reserve: 40, reload: 2.5, spread: 0.0015, critical: 2.35, falloff: 88, movePenalty: .82, adsFov: 34, penetration: 2, recoil: 'precision', color: 0x7693aa },
  { id: 'lmg', name: 'LMG', category: 'HEAVY', damage: 27, rate: 620, magazine: 75, reserve: 225, reload: 4.2, spread: 0.014, falloff: 50, movePenalty: .76, automatic: true, penetration: 2, recoil: 'heavy', color: 0x77745d },
  { id: 'minigun', name: 'Minigun', category: 'HEAVY', damage: 18, rate: 1200, magazine: 180, reserve: 360, reload: 5.4, spread: 0.022, falloff: 45, movePenalty: .62, automatic: true, recoil: 'heavy', color: 0x676b69 },
  { id: 'railgun', name: 'Railgun', category: 'EXPERIMENTAL', damage: 150, rate: 32, magazine: 3, reserve: 18, reload: 2.8, spread: 0, critical: 2.2, falloff: 110, movePenalty: .78, adsFov: 38, penetration: 4, recoil: 'energy', armorPenetration: 1, color: 0x61e9ff },
  { id: 'plasma-rifle', name: 'Plasma Rifle', category: 'EXPERIMENTAL', damage: 31, rate: 480, magazine: 100, reserve: 0, reload: 0, spread: 0.007, falloff: 58, movePenalty: .91, automatic: true, overheat: 13, recoil: 'energy', color: 0xb45cff },
  { id: 'heavy-ar', name: 'Heavy AR', category: 'ASSAULT', damage: 35, rate: 440, magazine: 28, reserve: 112, reload: 2.25, spread: 0.011, falloff: 58, movePenalty: .87, automatic: true, penetration: 2, recoil: 'heavy', color: 0x9d713f },
  { id: 'tactical-rifle', name: 'Tactical Rifle', category: 'ASSAULT', damage: 33, rate: 360, magazine: 24, reserve: 120, reload: 1.7, spread: 0.004, critical: 2.15, falloff: 65, movePenalty: .93, adsFov: 46, recoil: 'rifle', color: 0x709378 },
] satisfies WeaponDefinition[];

export const MAPS = [
  { id: 'verdant', name: 'Verdant Ruins', ground: 0x263d27, clearing: 0x48553a, sky: 0x101d16, fog: 0.026, accent: 0xb7d44d, weather: ['clear', 'rain', 'storm', 'fog'] },
  { id: 'iron', name: 'Iron Depot', ground: 0x313638, clearing: 0x4c5354, sky: 0x171c1e, fog: 0.018, accent: 0xf29a3f, weather: ['clear', 'rain', 'fog'] },
  { id: 'prism', name: 'Prism Arena', ground: 0x17172b, clearing: 0x25264a, sky: 0x090a18, fog: 0.014, accent: 0x58e7ff, weather: ['clear', 'fog'] },
  { id: 'frozen', name: 'Frozen Station', available: false, ground: 0xb8ced2, clearing: 0xd9e5e5, sky: 0x8daeb9, fog: 0.025, accent: 0x75e8ff, weather: ['snow', 'blizzard', 'overcast'] },
  { id: 'desert', name: 'Desert Graveyard', available: false, ground: 0x9f794c, clearing: 0xc49b64, sky: 0x9d6846, fog: 0.02, accent: 0xffb64c, weather: ['clear', 'sandstorm', 'overcast'] },
  { id: 'neon', name: 'Neon District', available: false, ground: 0x17181e, clearing: 0x24262d, sky: 0x05060c, fog: 0.018, accent: 0xff42ce, weather: ['rain', 'heavy-rain', 'fog'] },
] satisfies MapDefinition[];

export const WEATHER = {
  clear: { label: 'CLEAR', fog: 1, visibility: 1 },
  overcast: { label: 'OVERCAST', fog: 1.15, visibility: .96 },
  rain: { label: 'RAIN', fog: 1.35, visibility: .9, particles: true },
  'heavy-rain': { label: 'HEAVY RAIN', fog: 1.7, visibility: .76, particles: true },
  storm: { label: 'THUNDERSTORM', fog: 1.65, visibility: .8, particles: true },
  fog: { label: 'FOG', fog: 2.4, visibility: .62 },
  sandstorm: { label: 'SANDSTORM', fog: 2.7, visibility: .55, particles: true },
  snow: { label: 'SNOW', fog: 1.35, visibility: .9, particles: true },
  blizzard: { label: 'BLIZZARD', fog: 2.8, visibility: .5, particles: true },
};

export const MODES = {
  survival: { label: 'Survival', description: '無限波次生存' },
  hunt: { label: 'Hunt', description: '完成 3 次 Elite 獵殺' },
  defense: { label: 'Defense', description: '守住能源核心 5 波' },
  extraction: { label: 'Extraction', description: '完成 3 波後撤離' },
  chaos: { label: 'Chaos', description: '隨機規則下撐過 5 波' },
};

export const CHAOS_MODIFIERS = [
  { id: 'double-enemies', label: 'DOUBLE ENEMIES' },
  { id: 'low-gravity', label: 'LOW GRAVITY' },
  { id: 'fast-player', label: 'PLAYER SPEED ×2' },
  { id: 'fast-enemies', label: 'ENEMY SPEED ×2' },
  { id: 'fog-world', label: 'FOG' },
  { id: 'elite-invasion', label: 'ELITE INVASION' },
  { id: 'limited-ammo', label: 'LIMITED AMMO' },
  { id: 'headshot-bonus', label: 'HEADSHOT BONUS' },
  { id: 'night-mode', label: 'NIGHT MODE' },
  { id: 'explosive-world', label: 'EXPLOSIVE WORLD' },
  { id: 'infinite-ammo', label: 'INFINITE AMMO' },
  { id: 'headshot-only', label: 'HEADSHOT ONLY' },
  { id: 'shotgun-only', label: 'SHOTGUN ONLY' },
  { id: 'random-weapon', label: 'RANDOM WEAPON' },
];

export const ENEMY_TYPES = {
  grunt: { label: 'Grunt', health: 80, speed: 2.2, range: 8, damage: 8, fireDelay: 1.35, behavior: 'skirmish', color: 0xc6533d, score: 100 },
  scout: { label: 'Scout', health: 48, speed: 4.4, range: 1.5, damage: 12, fireDelay: 0.8, behavior: 'rush', color: 0xe5a43b, score: 125 },
  rifleman: { label: 'Rifleman', health: 65, speed: 1.8, range: 14, damage: 10, fireDelay: 1.7, behavior: 'hold', color: 0x6c7fd8, score: 150 },
  shotgunner: { label: 'Shotgunner', health: 90, speed: 2.7, range: 5, damage: 18, fireDelay: 1.9, behavior: 'rush', color: 0xc56b43, score: 175 },
  sniper: { label: 'Sniper', health: 50, speed: 1.35, range: 28, damage: 26, fireDelay: 2.5, behavior: 'hold', color: 0x786bb8, score: 225 },
  heavy: { label: 'Heavy', health: 230, speed: 1.15, range: 11, damage: 7, fireDelay: .38, behavior: 'hold', color: 0x727b72, score: 300 },
  shield: { label: 'Shield Unit', health: 140, speed: 1.55, range: 2, damage: 15, fireDelay: 1.25, behavior: 'rush', shield: true, color: 0x477b8b, score: 250 },
  medic: { label: 'Medic', health: 58, speed: 1.9, range: 10, damage: 5, fireDelay: 2.1, behavior: 'support', medic: true, color: 0x4ba879, score: 275 },
  commander: { label: 'Commander', health: 115, speed: 1.7, range: 12, damage: 10, fireDelay: 1.45, behavior: 'support', commander: true, color: 0xb09b45, score: 350 },
  hunter: { label: 'Hunter', health: 92, speed: 3.1, range: 4, damage: 17, fireDelay: 1.15, behavior: 'flank', color: 0x9b4e72, score: 325 },
  drone: { label: 'Drone', health: 45, speed: 2.8, range: 13, damage: 7, fireDelay: 1.2, behavior: 'hold', flying: true, color: 0x4f9eb3, score: 200 },
  berserker: { label: 'Berserker', health: 125, speed: 4.7, range: 1.4, damage: 23, fireDelay: .75, behavior: 'rush', color: 0xb5382d, score: 300 },
} satisfies Record<string, EnemyDefinition>;

export const BOSSES = [
  { id: 'juggernaut', label: 'Juggernaut', enemy: 'heavy', health: 1150, speed: .85, range: 5, damage: 22, fireDelay: 1.1, behavior: 'rush' },
  { id: 'hunter-alpha', label: 'Hunter Alpha', enemy: 'hunter', health: 820, speed: 4.2, range: 3, damage: 28, fireDelay: .75, behavior: 'flank' },
  { id: 'drone-carrier', label: 'Drone Carrier', enemy: 'drone', health: 980, speed: 1.5, range: 18, damage: 14, fireDelay: 1.2, behavior: 'hold', ability: 'summon' },
  { id: 'siege-walker', label: 'Siege Walker', enemy: 'heavy', health: 1400, speed: .65, range: 22, damage: 30, fireDelay: 1.8, behavior: 'hold' },
  { id: 'phantom', label: 'Phantom', enemy: 'hunter', health: 760, speed: 3.6, range: 9, damage: 20, fireDelay: 1.1, behavior: 'skirmish', ability: 'teleport' },
] satisfies BossDefinition[];

export const ELITE_TRAITS = ['armored', 'fast', 'accurate', 'regeneration', 'explosive'];

export const PERKS = [
  { id: 'damage', name: 'High Caliber', description: '所有武器傷害 +10%' },
  { id: 'critical', name: 'Critical Optics', description: '爆頭傷害 +20%' },
  { id: 'fire-rate', name: 'Rapid Cycle', description: '射速 +15%' },
  { id: 'health', name: 'Vitality', description: '最大生命 +20，並補滿' },
  { id: 'armor', name: 'Field Armor', description: 'Armor +25' },
  { id: 'regeneration', name: 'Regeneration', description: '緩慢恢復生命' },
  { id: 'movement', name: 'Trail Runner', description: '移動速度 +10%' },
  { id: 'double-jump', name: 'Air Step', description: 'Double Jump' },
  { id: 'sprint', name: 'Sprinter', description: '衝刺速度 +15%' },
  { id: 'reload', name: 'Fast Hands', description: '換彈時間 -15%' },
  { id: 'ammo', name: 'Bandolier', description: '所有備彈 +30%' },
  { id: 'pickup', name: 'Magnet Rig', description: '拾取範圍增加' },
  { id: 'explosive-kill', name: 'Volatile Rounds', description: '擊殺引發爆炸' },
  { id: 'chain-lightning', name: 'Arc Rounds', description: '命中連鎖傷害' },
  { id: 'penetration', name: 'Piercing Core', description: '子彈穿透 +1' },
  { id: 'lifesteal', name: 'Combat Recovery', description: '每次擊殺回復 4 HP' },
];

export const ATTACHMENTS = [
  { id: 'red-dot', name: 'Red Dot', slot: 'sight', adsFov: 48 },
  { id: 'holo', name: 'Holo', slot: 'sight', adsFov: 44 },
  { id: '2x', name: '2× Scope', slot: 'sight', adsFov: 38 },
  { id: '4x', name: '4× Scope', slot: 'sight', adsFov: 30 },
  { id: '8x', name: '8× Scope', slot: 'sight', adsFov: 22 },
  { id: 'compensator', name: 'Compensator', slot: 'barrel', recoil: .78 },
  { id: 'suppressor', name: 'Suppressor', slot: 'barrel', noise: .38, falloff: .92 },
  { id: 'long-barrel', name: 'Long Barrel', slot: 'barrel', falloff: 1.2 },
  { id: 'fast-mag', name: 'Fast Mag', slot: 'magazine', reload: .76 },
  { id: 'extended-mag', name: 'Extended Mag', slot: 'magazine', magazine: 1.35, reload: 1.08 },
  { id: 'vertical-grip', name: 'Vertical Grip', slot: 'grip', recoil: .82 },
  { id: 'angled-grip', name: 'Angled Grip', slot: 'grip', spread: .82 },
  { id: 'laser', name: 'Laser', slot: 'special', spread: .75 },
  { id: 'flashlight', name: 'Flashlight', slot: 'special' },
] satisfies AttachmentDefinition[];

export const DIFFICULTIES = {
  easy: { label: 'EASY', speed: 0.78, damage: 0.7, accuracy: 0.45, fireDelay: 1.35, spawn: 0.8 },
  normal: { label: 'NORMAL', speed: 1, damage: 1, accuracy: 0.65, fireDelay: 1, spawn: 1 },
  hard: { label: 'HARD', speed: 1.16, damage: 1.15, accuracy: 0.82, fireDelay: 0.8, spawn: 1.2 },
};

export const CONTENT_MANIFEST = {
  weapons: WEAPONS,
  enemies: ENEMY_TYPES,
  maps: MAPS,
  bosses: BOSSES,
  perks: PERKS,
  attachments: ATTACHMENTS,
  weaponQualities: WEAPON_QUALITIES,
  audioPacks: [{ id: 'procedural-combat', layers: ['shot', 'tail', 'mechanical', 'reload', 'empty', 'equip', 'danger'] }],
  effects: ['muzzle', 'impact', 'metal-spark', 'concrete-dust', 'wood-chip', 'glass', 'armor', 'abstract-hit', 'explosion', 'shockwave', 'energy', 'smoke', 'casing'],
};
