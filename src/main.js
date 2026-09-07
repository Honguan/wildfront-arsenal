import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { ATTACHMENTS, BOSSES, CHAOS_MODIFIERS, DIFFICULTIES, ENEMY_TYPES, MAPS, MODES, ROTATING_CHAOS_MODIFIERS, WEATHER, WEAPONS, WEAPON_QUALITIES, arenaShiftPosition, circleIntersectsRectangle, createDailyChallenge, createRng, createRun, createWave, pickPerks, rollElite, shotDamage } from './rules.js';
import { ACHIEVEMENTS, recordRun, summarizeProgress } from './progress.js';
import { initAudio, playDanger, playEmpty, playEquip, playHeadshot, playHealthCue, playImpact, playReload, playShot, playWeather, setAudioSettings, setEnvironmentAudio, setMusicIntensity } from './audio.js';
import { loadSave, saveGame } from './core/SaveManager.ts';
import { createFixedStep } from './core/GameLoop.ts';
import { STRESS_TARGETS, stressTarget, summarizePerformance } from './debug/PerformanceHarness.ts';
import { GRAPHICS_PROFILES, detectGraphicsProfile } from './platform.ts';
import { findVaultTarget } from './player/Vault.ts';
import { createShotEffects } from './effects/ShotEffects.ts';
import { RECOIL_PROFILES, recoilFor } from './weapons/Recoil.ts';
import { bossPhase } from './enemies/BossPhases.ts';
import { chooseCover, coverPointsForBox } from './enemies/Cover.ts';
import { canHear, memorySeconds } from './enemies/Perception.ts';
import { scoreKill } from './combat/Scoring.ts';
import { createMission, progressMission } from './missions/Missions.ts';
import { applyArmor } from './combat/Armor.ts';
import { createVisualIdentity } from './enemies/Visuals.ts';
import { createWeaponModel } from './weapons/Models.ts';
import { APP_VERSION, BUILD_SHA } from './version.ts';

const $ = (selector) => document.querySelector(selector);
const query = new URLSearchParams(location.search);
const loadingScreen = $('#loading');

function showCoreLoadError() {
  loadingScreen.querySelector('h1').textContent = 'Loading failed';
  $('#loading-progress').classList.add('hidden');
  $('#loading-status').classList.add('hidden');
  $('#loading-error').classList.remove('hidden');
}

function retryLoading() {
  const url = new URL(location.href);
  url.searchParams.delete('failCore');
  location.replace(url);
}

$('#retry-loading').addEventListener('click', retryLoading);
$('#return-loading').addEventListener('click', () => {
  loadingScreen.classList.add('hidden');
  $('#menu').classList.remove('hidden');
});
$('#clear-cache').addEventListener('click', async () => {
  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map((registration) => registration.unregister()));
  } finally {
    retryLoading();
  }
});
window.addEventListener('error', showCoreLoadError, { once: true });
window.addEventListener('unhandledrejection', showCoreLoadError, { once: true });
if (query.has('failCore')) throw new Error('Simulated required game data failure');
const diagnosticMode = query.has('benchmark') ? 'benchmark' : query.has('aiStress') ? 'ai-stress' : null;
const captureMode = query.get('test') === '1';
const testMode = captureMode || diagnosticMode !== null;
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: captureMode });
const capabilities = detectGraphicsProfile(renderer);
const pixelRatio = { low: 0.75, medium: 1.25, high: 1.75 }[capabilities.profile];
renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101d16);
scene.fog = new THREE.FogExp2(0x101d16, 0.026);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.08, 120);
camera.position.set(0, 1.7, 6);
scene.add(camera);

const controls = new PointerLockControls(camera, document.body);
const timer = new THREE.Timer();
const advanceSimulation = createFixedStep();
const raycaster = new THREE.Raycaster();
const sightOrigin = new THREE.Vector3();
const sightDirection = new THREE.Vector3();
const animalDirection = new THREE.Vector3();
const enemyTarget = new THREE.Vector3();
const enemyDirection = new THREE.Vector3();
const enemyPrediction = new THREE.Vector3();
const enemySide = new THREE.Vector3();
const enemyMovement = new THREE.Vector3();
const enemyCoverDirection = new THREE.Vector3();
const collisionSteering = [
  [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
  [0, 1], [0, -1],
  [-Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
  [-1, 0],
];
let enemyLodDistance = GRAPHICS_PROFILES[capabilities.profile].enemyLodDistance;
const playerNoise = { position: new THREE.Vector3(), radius: 0, timer: 0, type: 'ambient' };
const keys = new Set();
const enemies = [];
const dyingEnemies = [];
let enemyTargets = [];
const animals = [];
let animalTargets = [];
const coverTargets = [];
const coverPoints = [];
const world = new THREE.Group();
scene.add(world);
const objectiveLayer = new THREE.Group();
scene.add(objectiveLayer);
const shotEffects = createShotEffects();
scene.add(shotEffects.group);

function freshRunStats() {
  return { kills: 0, deaths: 0, shots: 0, hits: 0, headshots: 0, bossKills: 0, eliteKills: 0, environmentKills: 0, untouchedWaves: 0, waveDamage: 0, weaponShots: {}, weaponKills: {}, bossTypes: {} };
}

let storage;
try { storage = localStorage; } catch { /* Browser storage may be disabled. */ }
const savedGame = loadSave(storage);
let preferredLoadout = savedGame.loadout;
let progress = savedGame.progress;
let pendingDaily = null;

const state = {
  phase: 'menu',
  mode: 'survival',
  difficulty: 'normal',
  wave: 1,
  score: 0,
  health: 100,
  maxHealth: 100,
  weaponIndex: 0,
  loadout: [0, 1, 2, 3, 4],
  weapons: [],
  weaponQualities: [0, 0, 0, 0, 0],
  run: createRun('WILDFRONT', 'verdant'),
  rng: createRng('WILDFRONT:GAME'),
  weatherParticles: null,
  objective: null,
  objectiveHp: 0,
  extracting: false,
  extractionTimer: 0,
  chaosTimer: 10,
  chaosEffectTimer: 0,
  chaosModifier: null,
  daily: null,
  custom: null,
  infiniteAmmo: false,
  runStarted: 0,
  runTime: 0,
  runRecorded: true,
  runStats: freshRunStats(),
  settings: savedGame.settings,
  performanceLevel: 0,
  performanceTime: 0,
  performanceFrames: 0,
  nextEnemyId: 0,
  damageLevel: 0,
  reloadLevel: 0,
  moveLevel: 0,
  criticalLevel: 0,
  fireRateLevel: 0,
  lifesteal: 0,
  regeneration: 0,
  sprintLevel: 0,
  doubleJump: 0,
  airJumps: 0,
  pickupLevel: 0,
  explosiveLevel: 0,
  chainLevel: 0,
  penetrationLevel: 0,
  reloading: false,
  reloadTimer: 0,
  reloadDuration: 0,
  boltTimer: 0,
  equipTimer: 0,
  inspectTimer: 0,
  meleeTimer: 0,
  idleTimer: 8,
  fireHeld: false,
  ads: false,
  lastShot: -Infinity,
  messageTimer: 0,
  muzzleTimer: 0,
  weaponKick: 0,
  recoilPitch: 0,
  recoilYaw: 0,
  recoilShot: 0,
  damageKick: 0,
  damageDirectionTimer: 0,
  heatHudTimer: 0,
  wavePending: false,
  crouching: false,
  crouchToggled: false,
  eyeHeight: 1.7,
  grounded: true,
  jumpRequested: false,
  landingTimer: 0,
  playerY: 0,
  verticalVelocity: 0,
  vault: null,
  attachments: [],
  lootBoxes: [],
  interactables: [],
  worldFeatures: null,
  openedLoot: new Set(),
  usedWorld: new Set(),
  armor: 0,
  comboKills: 0,
  comboTimer: 0,
  mission: null,
  footstepTimer: 0,
  weatherCueTimer: 3,
  lightningTimer: 0,
  healthCueTimer: 0
};

function emitPlayerNoise(radius, type = 'footstep', position = camera.position) {
  playerNoise.position.copy(position);
  playerNoise.radius = type === 'gunshot' && state.run.weather === 'storm' ? radius * .55 : radius;
  playerNoise.timer = .45;
  playerNoise.type = type;
}

const hud = {
  root: $('#hud'),
  wave: $('#wave'),
  enemies: $('#enemies'),
  score: $('#score'),
  run: $('#run-info'),
  health: $('#health-label'),
  healthBar: $('#health-bar'),
  weapon: $('#weapon-slot'),
  ammo: $('#ammo'),
  reserve: $('#reserve'),
  reload: $('#reload-state'),
  message: $('#message'),
  hit: $('#hit-marker'),
  damage: $('#damage-flash')
};
hud.damageDirection = $('#damage-direction');
hud.boss = $('#boss-hud');
hud.bossName = $('#boss-name');
hud.bossPhase = $('#boss-phase');
hud.bossHealth = $('#boss-health');
hud.armor = $('#armor-label');
hud.combo = $('#combo');
hud.interaction = $('#interaction');

scene.add(new THREE.HemisphereLight(0xb9d6c8, 0x172017, 1.7));
const sun = new THREE.DirectionalLight(0xffe4b5, 2.4);
sun.position.set(-18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, far: 80 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

function addCover(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  world.add(mesh);
  mesh.userData.collisionBox = new THREE.Box3().setFromObject(mesh);
  mesh.userData.surface ??= 'concrete';
  coverTargets.push(mesh);
  if (!mesh.userData.barrel) {
    mesh.userData.coverPoints = coverPointsForBox(mesh.userData.collisionBox, coverPoints.length);
    coverPoints.push(...mesh.userData.coverPoints);
  }
  return mesh;
}

function positionBlocked(x, z, radius = .42) {
  return coverTargets.some(({ userData: { collisionBox: box } }) => box.max.y >= .6 && box.min.y <= 1.7 && circleIntersectsRectangle(x, z, radius, box.min.x, box.max.x, box.min.z, box.max.z));
}

function addBox(x, y, z, width, height, depth, color, rotation = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: .08 })
  );
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotation;
  return addCover(mesh);
}

function applyTime(value) {
  const time = ['dawn', 'day', 'sunset', 'night'].includes(value) ? value : 'day';
  const map = MAPS.find(({ id }) => id === state.run.map);
  state.run.time = time;
  sun.intensity = { dawn: .9, day: 2.4, sunset: 1.2, night: .35 }[time];
  sun.color.setHex({ dawn: 0xffb77a, day: 0xffe4b5, sunset: 0xff754d, night: 0x7898c9 }[time]);
  scene.background.setHex(map.sky).multiplyScalar({ dawn: .65, day: 1, sunset: .55, night: .3 }[time]);
  scene.fog.color.copy(scene.background);
  setEnvironmentAudio(state.run.map, state.run.weather, time);
}

function removeCover(mesh) {
  world.remove(mesh);
  const index = coverTargets.indexOf(mesh);
  if (index >= 0) coverTargets.splice(index, 1);
  const removedPoints = new Set(mesh.userData.coverPoints ?? []);
  for (let pointIndex = coverPoints.length - 1; pointIndex >= 0; pointIndex -= 1) {
    if (removedPoints.has(coverPoints[pointIndex])) coverPoints.splice(pointIndex, 1);
  }
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
  else mesh.material?.dispose();
}

function addWorldInteractions(map) {
  const accent = map.accent;
  if (state.chaosModifier === 'explosive-world') {
    for (const [index, [x, z]] of [[-10, -5], [10, -5], [-12, 9], [12, 9], [0, 12], [0, -14]].entries()) {
      const key = `${map.id}:explosive-world:${index}`;
      if (state.usedWorld.has(key)) continue;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, 1.15, 12), new THREE.MeshStandardMaterial({ color: 0xb5472f, metalness: .55, roughness: .45 }));
      barrel.position.set(x, .58, z);
      Object.assign(barrel.userData, { barrel: true, key, surface: 'metal' });
      addCover(barrel);
    }
  }
  const crateKey = `${map.id}:crate`;
  if (!state.usedWorld.has(crateKey)) {
    const crate = addBox(6, .65, 7, 1.3, 1.3, 1.3, 0x80552f);
    Object.assign(crate.userData, { destructible: true, health: 60, key: crateKey, surface: 'wood' });
  }
  const glassKey = `${map.id}:glass`;
  if (!state.usedWorld.has(glassKey)) {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, .08), new THREE.MeshStandardMaterial({ color: 0x8ed8e3, transparent: true, opacity: .35, roughness: .1 }));
    glass.position.set(6, 1.2, -12);
    Object.assign(glass.userData, { destructible: true, glass: true, health: 35, key: glassKey, surface: 'glass' });
    addCover(glass);
  }
  const lightKey = `${map.id}:light`;
  if (!state.usedWorld.has(lightKey)) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe09a, emissive: 0xffb63d, emissiveIntensity: 2 }));
    const lightNode = new THREE.PointLight(0xffbd64, 8, 9);
    light.position.set(-5, 3, -9);
    lightNode.position.copy(light.position);
    Object.assign(light.userData, { destructible: true, health: 20, key: lightKey, surface: 'glass', lightNode });
    world.add(lightNode);
    addCover(light);
  }

  const door = addBox(0, 1.5, -18, 5, 3, .45, 0x455158);
  door.userData.door = true;
  const elevator = addBox(-16, .25, 8, 4, .5, 4, 0x4c555b);
  const bridge = addBox(0, 4, 15, 7, .4, 3, 0x72563d);
  const movingPlatform = addBox(12, .25, 2, 4, .5, 4, 0x3d5965);
  const trap = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, .08, 24), new THREE.MeshStandardMaterial({ color: 0x5b2424, emissive: 0xff2f1f, emissiveIntensity: .25 }));
  trap.position.set(0, .05, -7);
  world.add(trap);

  const turret = new THREE.Mesh(new THREE.CylinderGeometry(.45, .65, 1.2, 10), new THREE.MeshStandardMaterial({ color: 0x46575c, emissive: accent, emissiveIntensity: .25, metalness: .7 }));
  turret.position.set(-8, .6, 4);
  world.add(turret);

  const portals = [-24, 24].map((x) => {
    const portal = new THREE.Mesh(new THREE.TorusGeometry(1.7, .16, 8, 32), new THREE.MeshBasicMaterial({ color: accent }));
    portal.position.set(x, 1.8, 0);
    world.add(portal);
    return portal;
  });
  const arenaWalls = map.id === 'prism' ? Array.from({ length: 4 }, (_, index) => {
    const position = arenaShiftPosition(index, false);
    const wall = addBox(position.x, 1.5, position.z, 5, 3, .7, index % 2 ? 0x3e8da0 : 0x6750a5, position.rotation);
    wall.userData.shiftIndex = index;
    return wall;
  }) : [];

  const switchKey = `${map.id}:switch`;
  const turretKey = `${map.id}:turret`;
  const switchMesh = new THREE.Mesh(new THREE.BoxGeometry(.5, .7, .4), new THREE.MeshStandardMaterial({ color: 0xd7b33f, emissive: 0x755100, emissiveIntensity: .6 }));
  switchMesh.position.set(2, .45, -10);
  world.add(switchMesh);
  const features = {
    bridge,
    door,
    elevator,
    elevatorTarget: .25,
    movingPlatform,
    portals,
    portalCooldown: 0,
    trap,
    trapTimer: 0,
    turret,
    turretActive: state.usedWorld.has(turretKey),
    turretTimer: 0,
    arenaWalls,
    arenaShifted: false,
    arenaShiftTimer: 90
  };
  if (state.usedWorld.has(switchKey)) bridge.position.y = .2;
  state.worldFeatures = features;
  state.interactables.push(
    {
      key: switchKey,
      label: 'ACTIVATE BRIDGE TRAP',
      mesh: switchMesh,
      once: true,
      used: state.usedWorld.has(switchKey),
      activate() {
        bridge.position.y = .2;
        bridge.userData.collisionBox.setFromObject(bridge);
        features.trapTimer = .5;
      }
    },
    {
      key: `${map.id}:elevator`,
      label: 'CALL ELEVATOR',
      mesh: elevator,
      used: false,
      activate() { features.elevatorTarget = features.elevatorTarget > 1 ? .25 : 4; }
    },
    {
      key: turretKey,
      label: 'ACTIVATE TURRET',
      mesh: turret,
      once: true,
      used: features.turretActive,
      activate() { features.turretActive = true; }
    }
  );
}

function spawnAnimals(rng) {
  const species = [
    ['deer', 0x8a5c35, 1.25],
    ['rabbit', 0xb6a58c, .5],
    ['bird', 0x426e8f, .4],
    ['boar', 0x4b382d, .9],
    ['wolf', 0x6d746f, .85]
  ];
  for (const [index, [type, color, scale]] of species.entries()) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.35, .7, 3, 6), new THREE.MeshStandardMaterial({ color, roughness: .9 }));
    body.rotation.z = Math.PI / 2;
    body.position.y = type === 'bird' ? 0 : .65;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.25, 7, 5), body.material);
    head.position.set(.65, type === 'bird' ? .05 : .82, 0);
    group.add(body, head);
    if (type === 'bird') {
      const wings = new THREE.Mesh(new THREE.BoxGeometry(.18, .04, 1.5), body.material);
      group.add(wings);
    }
    group.scale.setScalar(scale);
    const angle = index / species.length * Math.PI * 2 + rng() * .4;
    group.position.set(Math.cos(angle) * 17, type === 'bird' ? 3 : 0, Math.sin(angle) * 17);
    const animal = { type, group, body, state: 'idle', speed: type === 'rabbit' ? 5 : type === 'bird' ? 6 : 3.6, chargeTimer: 0 };
    body.userData.animal = animal;
    animals.push(animal);
    animalTargets.push(body);
    world.add(group);
  }
}

function buildMap(run) {
  shotEffects.clear();
  world.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
  world.clear();
  coverTargets.length = 0;
  coverPoints.length = 0;
  state.lootBoxes = [];
  state.interactables = [];
  state.worldFeatures = null;
  animals.length = 0;
  animalTargets = [];
  const map = MAPS.find(({ id }) => id === run.map);
  const weather = WEATHER[run.weather];
  const rng = createRng(run.seed);
  scene.background.setHex(map.sky);
  scene.fog = new THREE.FogExp2(map.sky, map.fog * weather.fog);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: map.ground, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  const clearing = new THREE.Mesh(
    new THREE.CircleGeometry(15, 48),
    new THREE.MeshStandardMaterial({ color: map.clearing, roughness: 1 })
  );
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.y = 0.012;
  clearing.receiveShadow = true;
  world.add(clearing);

  if (map.id === 'verdant') {
    const trunkGeometry = new THREE.CylinderGeometry(0.32, 0.5, 4, 7);
    const canopyGeometry = new THREE.ConeGeometry(2.15, 6, 7);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x3d2d1d, roughness: 1 });
    const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x183d25, roughness: .95 });
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2 + rng() * .16;
      const radius = 20 + rng() * 14;
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.set(Math.cos(angle) * radius, 2, Math.sin(angle) * radius);
      trunk.rotation.y = rng() * Math.PI;
      addCover(trunk);
      const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
      canopy.position.copy(trunk.position).add(new THREE.Vector3(0, 4.1, 0));
      canopy.castShadow = true;
      world.add(canopy);
    }
    for (const wall of [[-14, -8, 8, 2.8, .7], [13, -12, 7, 3.5, -.6], [-17, 13, 5, 2.5, .25], [16, 10, 6, 3, 1.1]]) {
      addBox(wall[0], wall[3] / 2, wall[1], wall[2], wall[3], .75, 0x667065, wall[4]);
    }
  }

  if (map.id === 'iron') {
    for (let i = 0; i < 14; i += 1) {
      const side = i % 2 ? 1 : -1;
      const x = side * (11 + (i % 3) * 4);
      const z = -24 + i * 3.6;
      addBox(x, 1.35, z, 5.5, 2.7, 2.4, i % 3 ? 0x59666a : 0x9a4e32, side * .12);
    }
    addBox(-20, 4, 0, 1.2, 8, 24, 0x404a4d);
    addBox(20, 4, 0, 1.2, 8, 24, 0x404a4d);
    for (const x of [-7, 0, 7]) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(.42, .42, 18, 10),
        new THREE.MeshStandardMaterial({ color: 0x7a6347, roughness: .65, metalness: .55 })
      );
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(x, 4.8, 17);
      addCover(pipe);
    }
    for (const [index, [x, z]] of [[-6, -8], [7, -2], [-4, 11], [9, 14]].entries()) {
      const key = `${map.id}:barrel:${index}`;
      if (state.usedWorld.has(key)) continue;
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(.42, .42, 1.15, 12),
        new THREE.MeshStandardMaterial({ color: 0xa33c28, roughness: .5, metalness: .5 })
      );
      barrel.position.set(x, .58, z);
      barrel.userData.barrel = true;
      barrel.userData.key = key;
      barrel.userData.surface = 'metal';
      addCover(barrel);
    }
  }

  if (map.id === 'prism') {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const radius = i % 2 ? 14 : 22;
      addBox(Math.cos(angle) * radius, 2 + i % 3, Math.sin(angle) * radius, 1.2, 4 + (i % 3) * 2, 7, i % 2 ? 0x4a3b87 : 0x206e83, -angle);
    }
    for (const [x, z] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      const platform = new THREE.Mesh(
        new THREE.CylinderGeometry(3.4, 3.4, .45, 6),
        new THREE.MeshStandardMaterial({ color: 0x343667, emissive: map.accent, emissiveIntensity: .08, metalness: .45 })
      );
      platform.position.set(x, .25, z);
      addCover(platform);
    }
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(16.5, .09, 5, 96),
    new THREE.MeshBasicMaterial({ color: map.accent, transparent: true, opacity: .45 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = .03;
  world.add(ring);
  addWorldInteractions(map);

  state.weatherParticles = null;
  if (weather.particles) {
    const positions = new Float32Array(900);
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] = (rng() - .5) * 65;
      positions[index + 1] = rng() * 22;
      positions[index + 2] = (rng() - .5) * 65;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    state.weatherParticles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0x9dc5cf, size: .055, transparent: true, opacity: .65 })
    );
    if (state.performanceLevel >= 1) geometry.setDrawRange(0, 150);
    world.add(state.weatherParticles);
  }
  const lootQualities = ['Normal', 'Military', 'Elite', 'Experimental'];
  for (let index = 0; index < lootQualities.length; index += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 7 + rng() * 8;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.9, .55, .7), new THREE.MeshStandardMaterial({ color: [0x806c42, 0x597e66, 0xd69b36, 0x9b4cff][index], emissive: map.accent, emissiveIntensity: .18, metalness: .55 }));
    mesh.position.set(Math.cos(angle) * radius, .3, Math.sin(angle) * radius);
    const key = `${run.map}:${index}`;
    const opened = state.openedLoot.has(key);
    mesh.visible = !opened;
    world.add(mesh);
    state.lootBoxes.push({ key, mesh, opened, quality: lootQualities[index] });
  }
  spawnAnimals(rng);
  applyTime(run.time);
}

buildMap(state.run);

const gun = new THREE.Group();
const weaponModels = new Map();
let weaponModel;
const tracerOrigin = new THREE.Vector3();
const casingOrigin = new THREE.Vector3();
const casingDirection = new THREE.Vector3();
gun.position.set(.34, -.28, -.62);
camera.add(gun);
const gloveMaterial = new THREE.MeshStandardMaterial({ color: 0x27312d, roughness: .9 });
for (const side of [-1, 1]) {
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .35, 3, 6), gloveMaterial);
  arm.rotation.x = Math.PI / 2;
  arm.rotation.z = side * .12;
  arm.position.set(side * .12, -.12, .18);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(.075, 7, 5), gloveMaterial);
  hand.position.set(side * .1, -.1, -.08);
  gun.add(arm, hand);
}

const shadowMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, colorWrite: false, depthWrite: false });
const playerShadowRig = new THREE.Group();
const shadowBody = new THREE.Mesh(new THREE.CapsuleGeometry(.28, .85, 3, 6), shadowMaterial);
shadowBody.position.y = 1;
shadowBody.castShadow = true;
playerShadowRig.add(shadowBody);
for (const x of [-.16, .16]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(.18, .75, .22), shadowMaterial);
  leg.position.set(x, .38, 0);
  leg.castShadow = true;
  playerShadowRig.add(leg);
}
scene.add(playerShadowRig);

const muzzle = new THREE.PointLight(0xffb347, 0, 3);
muzzle.position.set(0, 0, 0);
const flashlight = new THREE.SpotLight(0xe8f4ff, 0, 34, Math.PI / 7, .45, 1.2);
flashlight.position.set(.18, -.08, -.35);
flashlight.target.position.set(0, 0, -10);
camera.add(flashlight, flashlight.target);

function syncFlashlight() {
  weaponModel?.setAttachments(state.attachments);
  flashlight.intensity = state.attachments.includes('flashlight') ? (state.run.time === 'night' ? 14 : 7) : 0;
}

function syncWeaponModel() {
  const weapon = WEAPONS[state.loadout[state.weaponIndex]];
  if (!weaponModels.has(weapon.id)) weaponModels.set(weapon.id, createWeaponModel(weapon));
  weaponModel?.group.removeFromParent();
  weaponModel = weaponModels.get(weapon.id);
  gun.add(weaponModel.group);
  weaponModel.muzzle.add(muzzle);
  weaponModel.setAttachments(state.attachments);
  weaponModel.update({ reload: 0, bolt: 0, heat: 0, time: performance.now() / 1000 });
}

function currentWeapon() {
  const weapon = { ...WEAPONS[state.loadout[state.weaponIndex]], ...state.weapons[state.weaponIndex] };
  const quality = WEAPON_QUALITIES[state.weaponQualities[state.weaponIndex] ?? 0];
  weapon.quality = quality.label;
  weapon.reload *= quality.reload;
  weapon.rate *= 1 + state.fireRateLevel * .15;
  weapon.recoilMultiplier = quality.recoil;
  weapon.penetration = (weapon.penetration ?? 1) + quality.penetration + state.penetrationLevel;
  for (const id of state.attachments) {
    const attachment = ATTACHMENTS.find((candidate) => candidate.id === id);
    if (!attachment) continue;
    if (attachment.spread) weapon.spread *= attachment.spread;
    if (attachment.reload) weapon.reload *= attachment.reload;
    if (attachment.magazine) weapon.magazine = Math.round(weapon.magazine * attachment.magazine);
    if (attachment.falloff) weapon.falloff *= attachment.falloff;
    if (attachment.adsFov) weapon.adsFov = attachment.adsFov;
    if (attachment.noise) weapon.noise = attachment.noise;
    if (attachment.recoil) weapon.recoilMultiplier = (weapon.recoilMultiplier ?? 1) * attachment.recoil;
  }
  return weapon;
}

function openNearbyLoot(selectedBox = null) {
  if (state.phase !== 'playing') return false;
  const box = selectedBox ?? state.lootBoxes.find(({ opened, mesh }) => !opened && mesh.position.distanceTo(camera.position) <= 2.4 + state.pickupLevel * 1.5);
  if (!box) return false;
  box.opened = true;
  box.mesh.visible = false;
  state.openedLoot.add(box.key);
  advanceMission('loot');
  if (box.quality === 'Experimental' && state.weaponQualities[state.weaponIndex] < WEAPON_QUALITIES.length - 1) {
    state.weaponQualities[state.weaponIndex] += 1;
    const quality = WEAPON_QUALITIES[state.weaponQualities[state.weaponIndex]];
    state.weapons[state.weaponIndex].reserve = Math.round(state.weapons[state.weaponIndex].reserve * quality.reserve);
    announce(`${currentWeapon().name} · ${quality.label.toUpperCase()}`, 2);
    updateHud();
    return true;
  }
  if (box.quality === 'Military') {
    const weaponPool = state.chaosModifier === 'shotgun-only' ? WEAPONS.map((weapon, index) => [weapon, index]).filter(([weapon]) => weapon.category === 'SHOTGUN').map(([, index]) => index) : WEAPONS.map((_, index) => index);
    const weaponIndex = weaponPool[Math.floor(state.rng() * weaponPool.length)];
    state.loadout[state.weaponIndex] = weaponIndex;
    state.weapons[state.weaponIndex] = { ammo: WEAPONS[weaponIndex].magazine, reserve: WEAPONS[weaponIndex].reserve, heat: 0 };
    state.weaponQualities[state.weaponIndex] = 0;
    switchWeapon(state.weaponIndex, true);
    announce(`MILITARY CACHE · ${WEAPONS[weaponIndex].name}`, 2);
    return true;
  }
  if (box.quality === 'Elite') {
    const perk = pickPerks(state.rng)[0];
    applyPerk(perk.id);
    announce(`ELITE CACHE · ${perk.name}`, 2);
    return true;
  }
  const available = ATTACHMENTS.filter(({ id }) => !state.attachments.includes(id));
  if (available.length) {
    const attachment = available[Math.floor(state.rng() * available.length)];
    state.attachments.push(attachment.id);
    syncFlashlight();
    announce(`${box.quality} CACHE · ${attachment.name}`, 2);
  } else {
    state.weapons[state.weaponIndex].reserve += currentWeapon().magazine * 2;
    state.armor = Math.min(100, state.armor + 25);
    announce(`${box.quality} CACHE · AMMO + ARMOR`, 2);
  }
  updateHud();
  return true;
}

function nearestAction() {
  let nearest;
  let nearestDistance = Infinity;
  for (const item of state.lootBoxes) {
    if (item.opened) continue;
    const distance = item.mesh.position.distanceTo(camera.position);
    if (distance <= 2.4 + state.pickupLevel * 1.5 && distance < nearestDistance) {
      nearest = { kind: 'loot', item, distance };
      nearestDistance = distance;
    }
  }
  for (const item of state.interactables) {
    if (item.used) continue;
    const distance = item.mesh.position.distanceTo(camera.position);
    if (distance <= 2.8 && distance < nearestDistance) {
      nearest = { kind: 'interaction', item, distance };
      nearestDistance = distance;
    }
  }
  return nearest;
}

function interactNearby() {
  if (state.phase !== 'playing') return false;
  const action = nearestAction();
  if (!action) return false;
  if (action.kind === 'loot') return openNearbyLoot(action.item);
  const interaction = action.item;
  interaction.activate();
  if (interaction.once) {
    interaction.used = true;
    state.usedWorld.add(interaction.key);
  }
  announce(interaction.label, 1);
  return true;
}

function resetWeapons() {
  state.weaponQualities = state.loadout.map(() => 0);
  state.weapons = state.loadout.map((index) => {
    const { magazine, reserve } = WEAPONS[index];
    return { ammo: magazine, reserve, heat: 0 };
  });
}

function clearObjective() {
  objectiveLayer.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
  objectiveLayer.clear();
}

function setPhase(phase) {
  if (state.phase === 'playing') state.runTime += (performance.now() - state.runStarted) / 1000;
  if (phase === 'playing') state.runStarted = performance.now();
  keys.clear();
  state.fireHeld = false;
  state.ads = false;
  state.jumpRequested = false;
  state.phase = phase;
  for (const id of ['menu', 'pause', 'upgrade', 'game-over', 'victory', 'settings-panel', 'controls-panel', 'statistics-panel', 'loadout-panel', 'armory-panel', 'challenges-panel', 'credits-panel']) $(`#${id}`).classList.add('hidden');
  hud.root.classList.toggle('hidden', phase !== 'playing');
  if (phase === 'menu') $('#menu').classList.remove('hidden');
  if (phase === 'paused') $('#pause').classList.remove('hidden');
  if (phase === 'upgrade') $('#upgrade').classList.remove('hidden');
  if (phase === 'gameover') $('#game-over').classList.remove('hidden');
  if (phase === 'victory') $('#victory').classList.remove('hidden');
  const visible = document.querySelector('.modal:not(.hidden)');
  if (visible) visible.querySelector('button, input, select')?.focus({ preventScroll: true });
  else if (phase === 'menu') { updateBriefing(); $('#start').focus({ preventScroll: true }); }
  else document.activeElement?.blur();
}

let panelReturnFocus = null;
function openPanel(id) {
  panelReturnFocus = document.activeElement;
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.add('hidden'));
  const panel = $(`#${id}`);
  panel.classList.remove('hidden');
  hud.root.classList.add('hidden');
  panel.scrollTop = 0;
  panel.querySelector('input, select, button')?.focus({ preventScroll: true });
}

function closePanel() {
  setPhase(state.phase);
  if (panelReturnFocus?.isConnected && panelReturnFocus.getClientRects().length) panelReturnFocus.focus({ preventScroll: true });
  panelReturnFocus = null;
}

function persistProgress() {
  const saved = saveGame(storage, progress, state.settings, preferredLoadout);
  $('#save-status').classList.toggle('hidden', saved);
  $('#save-status').textContent = saved ? '' : '目前無法儲存進度與設定；關閉頁面後，本次變更可能遺失。';
}

function announce(text, seconds = 1.8) {
  hud.message.textContent = text;
  state.messageTimer = seconds;
}

function beginMission(type) {
  state.mission = createMission(state.rng, currentWeapon().name, type);
  announce(`MISSION · ${state.mission.label}`, 2);
  updateHud();
  return true;
}

function advanceMission(event, amount = 1) {
  if (!state.mission) return;
  const previousProgress = Math.floor(state.mission.progress);
  state.mission = progressMission(state.mission, event, amount);
  if (state.mission.failed) {
    announce(`MISSION FAILED · ${state.mission.label}`, 1.5);
    state.mission = null;
  } else if (state.mission.complete) {
    state.score += 500;
    state.armor = Math.min(100, state.armor + 30);
    state.weapons[state.weaponIndex].reserve += currentWeapon().magazine;
    announce(`MISSION COMPLETE · ${state.mission.label}`, 2);
    state.mission = null;
  }
  if (!state.mission || Math.floor(state.mission.progress) !== previousProgress) updateHud();
}

function updateHud() {
  const weapon = currentWeapon();
  hud.wave.textContent = state.wave;
  hud.enemies.textContent = enemies.length;
  hud.score.textContent = state.score.toLocaleString();
  const map = MAPS.find(({ id }) => id === state.run.map);
  const objective = state.daily ? ` · DAILY ${state.runStats.kills}/${state.daily.goal}` : state.mode === 'defense' ? ` · CORE ${Math.ceil(state.objectiveHp)}` : state.extracting ? ` · EXTRACT ${Math.ceil(state.extractionTimer)}s` : state.mission ? ` · ${state.mission.label} ${Math.floor(state.mission.progress)}/${state.mission.target}` : '';
  hud.run.textContent = `${map.name} · ${String(state.run.time).toUpperCase()} · ${WEATHER[state.run.weather].label}${objective}`;
  hud.health.textContent = Math.ceil(state.health);
  hud.armor.textContent = Math.ceil(state.armor);
  hud.healthBar.style.width = `${Math.max(0, state.health / state.maxHealth) * 100}%`;
  hud.root.classList.toggle('low-health', state.health > 0 && state.health / state.maxHealth <= .25);
  hud.weapon.textContent = `0${state.weaponIndex + 1} / ${weapon.category} · ${weapon.name} · ${weapon.quality.toUpperCase()}${state.attachments.length ? ` · +${state.attachments.length}` : ''}`;
  hud.ammo.textContent = weapon.overheat ? Math.round(weapon.heat) : weapon.ammo;
  hud.reserve.textContent = weapon.overheat ? '% HEAT' : weapon.reserve;
  hud.reload.textContent = state.boltTimer > 0 ? 'CYCLING BOLT' : weapon.overheat && weapon.heat >= 100 ? 'COOLING' : state.reloading ? (weapon.shellReload ? 'LOADING SHELLS' : weapon.revolverReload ? 'SWAPPING CYLINDER' : 'RELOADING') : '';
  hud.combo.textContent = state.comboKills >= 2 ? `${state.comboKills}× COMBO` : '';
  const boss = enemies.find(({ boss }) => boss);
  hud.boss.classList.toggle('hidden', !boss);
  if (boss) {
    hud.bossName.textContent = boss.config.label;
    hud.bossPhase.textContent = `PHASE ${boss.phase}`;
    hud.bossHealth.style.width = `${Math.max(0, boss.health / boss.maxHealth) * 100}%`;
  }
}

function disposeEnemy(enemy) {
  const geometries = new Set();
  const materials = new Set();
  enemy.group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
    else if (object.material) materials.add(object.material);
  });
  scene.remove(enemy.group);
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function clearEnemies() {
  for (const enemy of enemies) disposeEnemy(enemy);
  for (const enemy of dyingEnemies) disposeEnemy(enemy);
  enemies.length = 0;
  dyingEnemies.length = 0;
  enemyTargets = [];
}

function spawnEnemy(type, index, { boss = false, bossType = 'juggernaut', forceElite = false, suppressElite = false } = {}) {
  const bossConfig = boss ? BOSSES.find(({ id }) => id === bossType) ?? BOSSES[0] : null;
  if (bossConfig) type = bossConfig.enemy;
  const config = { ...ENEMY_TYPES[type] };
  const traits = boss || suppressElite ? [] : forceElite ? ['armored', 'accurate'] : rollElite(state.rng, state.wave);
  if (traits.includes('armored')) config.health *= 1.5;
  if (traits.includes('fast')) config.speed *= 1.4;
  if (traits.length) {
    config.label = `Elite ${config.label}`;
    config.score *= 2;
  }
  if (bossConfig) Object.assign(config, bossConfig, { score: 1500 });
  if (state.custom) config.health *= state.custom.enemyHp;
  const visual = createVisualIdentity(type, state.rng);
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: config.color, roughness: .72 });
  material.color.offsetHSL((visual.palette - 1) * .025, 0, (visual.palette - 1) * .04);
  if (traits.length || boss) material.emissive.setHex(boss ? 0x8f210d : 0x574b09);
  material.emissiveIntensity = boss ? .6 : .32;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42, .72, 4, 8), material);
  body.position.y = 1;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(.3, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xc9a786, roughness: .8 })
  );
  head.position.y = 1.82;
  head.castShadow = true;
  group.add(body, head);
  const targets = [body, head];
  const accessories = [];
  const arms = [-.52, .52].map((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.2, .72, .22), material);
    arm.position.set(x, 1.1, 0);
    group.add(arm);
    targets.push(arm);
    return arm;
  });
  const legs = [-.22, .22].map((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.24, .72, .25), material);
    leg.position.set(x, .38, 0);
    group.add(leg);
    targets.push(leg);
    return leg;
  });
  const helmetGeometry = visual.helmet === 0 ? new THREE.BoxGeometry(.5, .22, .5) : visual.helmet === 1 ? new THREE.CylinderGeometry(.3, .34, .22, 8) : new THREE.ConeGeometry(.34, .34, 8);
  const helmet = new THREE.Mesh(helmetGeometry, material);
  helmet.position.y = 2.06;
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(.72 + visual.chest * .08, .5, .18 + visual.chest * .05), material);
  chestPlate.position.set(0, 1.25, -.34);
  const shoulder = new THREE.Mesh(visual.shoulder ? new THREE.SphereGeometry(.18, 6, 4) : new THREE.BoxGeometry(.3, .2, .32), material);
  shoulder.position.set(visual.palette % 2 ? -.5 : .5, 1.48, 0);
  group.add(helmet, chestPlate, shoulder);
  accessories.push(helmet, chestPlate, shoulder);
  const lowMesh = new THREE.Mesh(new THREE.CapsuleGeometry(.46, 1.05, 2, 5), new THREE.MeshLambertMaterial({ color: material.color }));
  lowMesh.material.emissiveIntensity = material.emissiveIntensity;
  lowMesh.position.y = 1;
  lowMesh.visible = false;
  group.add(lowMesh);

  let shield = null;
  if (config.shield) {
    shield = new THREE.Mesh(
      new THREE.BoxGeometry(.9, 1.25, .12),
      new THREE.MeshStandardMaterial({ color: 0x446b78, roughness: .35, metalness: .72 })
    );
    shield.position.set(0, 1.1, .5);
    shield.castShadow = true;
    group.add(shield);
    targets.push(shield);
  }

  let weakPoint = null;
  let bossSignature = null;
  if (boss) {
    weakPoint = new THREE.Mesh(
      new THREE.SphereGeometry(.24, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xff5c2e, emissive: 0xff2600, emissiveIntensity: 1.2 })
    );
    weakPoint.position.set(0, 1.25, -.48);
    group.add(weakPoint);
    targets.push(weakPoint);
    const signatureGeometry = {
      juggernaut: () => new THREE.BoxGeometry(1.35, .35, .55),
      'hunter-alpha': () => new THREE.ConeGeometry(.55, 1.4, 5),
      'drone-carrier': () => new THREE.TorusGeometry(.75, .12, 6, 18),
      'siege-walker': () => new THREE.CylinderGeometry(.15, .22, 1.8, 8),
      phantom: () => new THREE.OctahedronGeometry(.62)
    }[bossConfig.id]();
    bossSignature = new THREE.Mesh(signatureGeometry, new THREE.MeshStandardMaterial({ color: 0x34242a, emissive: 0xff4a25, emissiveIntensity: .8, metalness: .65 }));
    bossSignature.position.set(0, bossConfig.id === 'drone-carrier' ? 2.3 : 1.3, bossConfig.id === 'siege-walker' ? -.9 : 0);
    if (bossConfig.id === 'siege-walker') bossSignature.rotation.x = Math.PI / 2;
    group.add(bossSignature);
    accessories.push(bossSignature);
    group.scale.setScalar(1.65);
  }

  if (config.range > 3 && !config.flying) {
    const rifle = new THREE.Mesh(
      new THREE.BoxGeometry(.12, .12, type === 'sniper' ? 1.35 : .85),
      new THREE.MeshStandardMaterial({ color: 0x1b2420, metalness: .6, roughness: .4 })
    );
    rifle.position.set(.34, 1.1, -.25);
    group.add(rifle);
    accessories.push(rifle);
  }
  if (type === 'heavy') group.scale.x *= 1.28;
  if (type === 'sniper') group.scale.x *= .82;
  if (config.medic) {
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(.65, .72, .3), new THREE.MeshStandardMaterial({ color: 0x315f4c, emissive: 0x39ff9a, emissiveIntensity: .8 }));
    backpack.position.set(0, 1.15, .38);
    group.add(backpack);
    accessories.push(backpack);
  }
  if (config.commander) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .8, 5), new THREE.MeshStandardMaterial({ color: 0xe5c84b, emissive: 0xffc400, emissiveIntensity: 1 }));
    antenna.position.set(.3, 2.45, 0);
    group.add(antenna);
    accessories.push(antenna);
  }
  if (type === 'berserker') {
    body.rotation.x = -.18;
    const blade = new THREE.Mesh(new THREE.ConeGeometry(.13, .9, 4), new THREE.MeshStandardMaterial({ color: 0xc2c8c6, metalness: .8 }));
    blade.position.set(.55, .9, -.35);
    blade.rotation.x = Math.PI / 2;
    group.add(blade);
    accessories.push(blade);
  }

  if (config.flying) {
    const wings = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, .09, .45),
      new THREE.MeshStandardMaterial({ color: 0x263b43, metalness: .7, roughness: .35 })
    );
    wings.position.y = 1.05;
    group.add(wings);
    accessories.push(wings);
  }

  const angle = (index / Math.max(1, createWave(state.wave, state.difficulty).length)) * Math.PI * 2 + state.rng() * .45;
  const radius = 20 + state.rng() * 10;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidateAngle = angle + attempt * 2.399963;
    const candidateRadius = 20 + (radius - 20 + attempt * 2.3) % 10;
    group.position.set(Math.cos(candidateAngle) * candidateRadius, config.flying ? 3 : 0, Math.sin(candidateAngle) * candidateRadius);
    if (config.flying || !positionBlocked(group.position.x, group.position.z, boss ? .7 : .42)) break;
  }
  scene.add(group);

  const personalities = ['aggressive', 'defensive', 'cautious', 'flanker', 'coward'];
  const armored = boss || traits.includes('armored') || type === 'heavy';
  const enemy = { id: ++state.nextEnemyId, type, config, group, traits, boss, bossType: bossConfig?.id, bossSignature, health: config.health, maxHealth: config.health, armor: { head: armored ? 70 : 0, chest: armored ? 140 : 0 }, baseSpeed: config.speed, baseDamage: config.damage, phase: 1, armorBroken: false, weakPoint, visual, detailMeshes: [body, head, ...arms, ...legs, ...(shield ? [shield] : []), ...(weakPoint ? [weakPoint] : [])], accessories, lowMesh, arms, legs, animationTime: state.rng() * Math.PI * 2, fireTimer: 0, telegraphTimer: 0, pendingAttack: null, coverPoint: null, coverDecisionTimer: 0, combatState: 'acquire', personality: personalities[Math.floor(state.rng() * personalities.length)], lastKnownPlayerPosition: camera.position.clone(), memoryTimer: .5, perceptionTimer: state.rng() * .2, seesPlayer: false, patrolTarget: group.position.clone(), avoidanceDirection: new THREE.Vector3(), avoidanceTimer: 0, emissive: boss ? 0x8f210d : traits.length ? 0x574b09 : 0, attackTimer: .5 + state.rng(), abilityTimer: 5 + state.rng() * 3, hitTimer: 0, strafe: state.rng() > .5 ? 1 : -1 };
  enemy.squadId = Math.floor(index / 5);
  enemy.squadRole = config.commander ? 'Commander' : config.medic ? 'Medic' : type === 'heavy' ? 'Heavy' : 'Rifleman';
  enemy.squadCommand = null;
  enemy.squadCommandTimer = 0;
  enemy.commandCooldown = 1 + state.rng() * 2;
  enemy.heardNoise = null;
  body.userData = { enemy, headshot: false, zone: 'chest', damageScale: 1 };
  head.userData = { enemy, headshot: true, zone: 'head' };
  arms.forEach((arm) => { arm.userData = { enemy, headshot: false, zone: 'arm', damageScale: .8 }; });
  legs.forEach((leg) => { leg.userData = { enemy, headshot: false, zone: 'leg', damageScale: .7 }; });
  if (shield) shield.userData = { enemy, headshot: false, zone: 'shield', damageScale: .15 };
  if (boss) targets.at(-1).userData = { enemy, headshot: true, damageScale: 1.5 };
  enemyTargets.push(...targets);
  enemies.push(enemy);
  if (boss || traits.length) playDanger(boss ? bossConfig.id : 'elite');
  return enemy;
}

function spawnWave() {
  state.wavePending = false;
  const defaultWave = createWave(state.wave, state.difficulty);
  const wave = state.custom
    ? Array.from({ length: state.custom.enemyCount }, (_, index) => state.custom.enemyType === 'random' ? defaultWave[index % defaultWave.length] : state.custom.enemyType)
    : defaultWave;
  const activeWave = state.chaosModifier === 'double-enemies' ? [...wave, ...wave] : wave;
  activeWave.forEach(spawnEnemy);
  if (state.wave % 3 === 0) {
    const squadId = 1000 + state.wave;
    ['commander', 'rifleman', 'rifleman', 'heavy', 'medic'].forEach((type, index) => {
      const member = spawnEnemy(type, wave.length + index);
      member.squadId = squadId;
    });
  }
  if (state.custom ? state.custom.boss : state.wave % 5 === 0) {
    const boss = BOSSES[(Math.ceil(state.wave / 5) - 1) % BOSSES.length];
    spawnEnemy(boss.enemy, wave.length, { boss: true, bossType: boss.id });
  }
  if (state.mode === 'hunt') spawnEnemy(['heavy', 'sniper', 'commander', 'hunter'][(state.wave - 1) % 4], wave.length + 1, { forceElite: true });
  if (state.chaosModifier === 'elite-invasion') {
    for (let index = 0; index < 3; index += 1) spawnEnemy(index % 2 ? 'hunter' : 'heavy', activeWave.length + index, { forceElite: true });
  }
  announce(`Wave ${state.wave} · ${DIFFICULTIES[state.difficulty].label}`);
  if (state.wave > 1 && !state.mission && state.rng() < .4) beginMission();
  updateHud();
}

function boundedNumber(selector, minimum, maximum, fallback) {
  if (!$(selector).value.trim()) return fallback;
  const value = Number($(selector).value);
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, minimum, maximum) : fallback;
}

function readCustomGame() {
  if (!$('#custom-enabled').checked) return null;
  const enemyType = $('#custom-enemy-type').value;
  const weather = $('#custom-weather').value;
  const weapon = Number($('#custom-weapon').value);
  const modifier = $('#custom-modifier').value;
  return {
    enemyCount: Math.round(boundedNumber('#custom-enemy-count', 1, 100, 12)),
    enemyType: enemyType === 'random' || ENEMY_TYPES[enemyType] ? enemyType : 'random',
    boss: $('#custom-boss').checked,
    weather: weather === 'random' || WEATHER[weather] ? weather : 'random',
    time: ['dawn', 'day', 'sunset', 'night'].includes($('#custom-time').value) ? $('#custom-time').value : 'day',
    weapon: WEAPONS[weapon] ? weapon : null,
    infiniteAmmo: $('#custom-infinite-ammo').checked,
    playerHp: boundedNumber('#custom-player-hp', 25, 500, 100),
    enemyHp: boundedNumber('#custom-enemy-hp', .5, 5, 1),
    modifier: CHAOS_MODIFIERS.some(({ id }) => id === modifier) ? modifier : null
  };
}

function startGame() {
  initAudio();
  setAudioSettings({ master: state.settings.masterVolume, music: state.settings.musicVolume, sfx: state.settings.sfxVolume, ui: state.settings.uiVolume });
  clearEnemies();
  clearObjective();
  const seed = $('#seed').value.trim() || Date.now().toString(36).toUpperCase();
  const custom = readCustomGame();
  const daily = pendingDaily?.seed === seed ? pendingDaily : null;
  const run = createRun(seed, daily?.map ?? $('#map').value);
  if (!daily) run.loadout = [...document.querySelectorAll('#loadout-slots select')].map((select) => Number(select.value));
  if (daily) run.weather = daily.weather;
  if (custom?.weather && custom.weather !== 'random') run.weather = custom.weather;
  const startingWeapon = daily?.weapon ?? custom?.weapon;
  if (startingWeapon !== undefined && startingWeapon !== null) run.loadout = [startingWeapon, ...run.loadout.filter((index) => index !== startingWeapon)].slice(0, 5);
  if (custom?.time) run.time = custom.time;
  const modifierPolicy = $('#modifier-policy').value;
  const randomModifier = CHAOS_MODIFIERS[Math.floor(createRng(`${seed}:MODIFIER`)() * CHAOS_MODIFIERS.length)].id;
  const runModifier = daily?.modifier ?? (modifierPolicy === 'random' ? randomModifier : modifierPolicy === 'custom' ? custom?.modifier ?? null : null);
  if (runModifier === 'shotgun-only') run.loadout = [WEAPONS.findIndex(({ category }) => category === 'SHOTGUN'), ...run.loadout].filter((value, index, values) => values.indexOf(value) === index).slice(0, 5);
  $('#seed').value = seed;
  $('#copy-seed').textContent = 'Copy Seed';
  Object.assign(state, {
    mode: $('#mode').value,
    difficulty: $('#difficulty').value,
    run,
    loadout: run.loadout,
    rng: createRng(`${seed}:GAME`),
    wave: 1,
    score: 0,
    health: custom?.playerHp ?? 100,
    maxHealth: custom?.playerHp ?? 100,
    weaponIndex: 0,
    damageLevel: 0,
    reloadLevel: 0,
    moveLevel: 0,
    criticalLevel: 0,
    fireRateLevel: 0,
    lifesteal: 0,
    regeneration: 0,
    sprintLevel: 0,
    doubleJump: 0,
    airJumps: 0,
    pickupLevel: 0,
    explosiveLevel: 0,
    chainLevel: 0,
    penetrationLevel: 0,
    objective: null,
    objectiveHp: 0,
    extracting: false,
    extractionTimer: 0,
    chaosTimer: runModifier ? 28 : 10,
    chaosEffectTimer: runModifier ? 18 : 0,
    chaosModifier: runModifier,
    daily,
    custom,
    infiniteAmmo: custom?.infiniteAmmo ?? false,
    runStarted: performance.now(),
    runTime: 0,
    runRecorded: false,
    runStats: freshRunStats(),
    performanceLevel: 0,
    performanceTime: 0,
    performanceFrames: 0,
    nextEnemyId: 0,
    reloading: false,
    reloadDuration: 0,
    boltTimer: 0,
    equipTimer: 0,
    inspectTimer: 0,
    meleeTimer: 0,
    idleTimer: 8,
    fireHeld: false,
    ads: false,
    lastShot: -Infinity,
    recoilPitch: 0,
    recoilYaw: 0,
    recoilShot: 0,
    damageKick: 0,
    damageDirectionTimer: 0,
    heatHudTimer: 0,
    wavePending: false,
    crouching: false,
    crouchToggled: false,
    eyeHeight: 1.7,
    grounded: true,
    jumpRequested: false,
    landingTimer: 0,
    playerY: 0,
    verticalVelocity: 0,
    vault: null,
    attachments: [],
    openedLoot: new Set(),
    usedWorld: new Set(),
    armor: 0,
    comboKills: 0,
    comboTimer: 0,
    mission: null,
    footstepTimer: 0,
    weatherCueTimer: 3 + createRng(`${seed}:WEATHER`)() * 4,
    lightningTimer: 0,
    healthCueTimer: 0
  });
  buildMap(run);
  syncFlashlight();
  applyGraphicsSettings();
  if (state.mode === 'defense') {
    state.objective = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.5, 2.8, 10),
      new THREE.MeshStandardMaterial({ color: 0x4ad5d0, emissive: 0x0b827e, emissiveIntensity: .8, metalness: .65 })
    );
    state.objective.position.set(0, 1.4, 0);
    state.objective.castShadow = true;
    state.objectiveHp = 300;
    objectiveLayer.add(state.objective);
  }
  resetWeapons();
  if (state.chaosModifier === 'limited-ammo') state.weapons.forEach((weaponState) => { weaponState.reserve = Math.ceil(weaponState.reserve * .4); });
  if (state.chaosModifier === 'random-weapon') state.weaponIndex = Math.floor(state.rng() * state.loadout.length);
  if (state.chaosModifier === 'night-mode') {
    applyTime('night');
  }
  if (state.chaosModifier === 'fog-world') scene.fog.density *= 2.2;
  camera.position.set(0, 1.7, 6);
  camera.rotation.set(0, 0, 0);
  switchWeapon(state.weaponIndex, true);
  spawnWave();
  setPhase('playing');
  if (!testMode) controls.lock();
}

function switchWeapon(index, refresh = false) {
  if (index === state.weaponIndex && !refresh) return;
  if (state.loadout[index] === undefined) return;
  if (state.chaosModifier === 'shotgun-only' && WEAPONS[state.loadout[index]].category !== 'SHOTGUN') return;
  state.weaponIndex = index;
  state.reloading = false;
  state.boltTimer = 0;
  state.recoilShot = 0;
  state.equipTimer = .28;
  muzzle.intensity = 0;
  state.muzzleTimer = 0;
  syncWeaponModel();
  playEquip();
  updateHud();
}

function reload() {
  if (state.reloading || state.phase !== 'playing') return;
  const weapon = currentWeapon();
  if (weapon.overheat) return;
  if (weapon.ammo >= weapon.magazine || weapon.reserve <= 0) return;
  state.reloading = true;
  playReload();
  emitPlayerNoise(9, 'reload');
  state.reloadTimer = Math.max(.22, weapon.reload * (1 - state.reloadLevel * .15));
  state.reloadDuration = state.reloadTimer;
  updateHud();
}

function finishReload() {
  const weapon = currentWeapon();
  const ammoState = state.weapons[state.weaponIndex];
  if (weapon.shellReload) {
    ammoState.ammo += 1;
    ammoState.reserve -= 1;
    if (ammoState.ammo < weapon.magazine && ammoState.reserve > 0) {
      state.reloadTimer = Math.max(.22, weapon.reload * (1 - state.reloadLevel * .15));
      state.reloadDuration = state.reloadTimer;
    } else {
      state.reloading = false;
    }
  } else {
    const amount = Math.min(weapon.magazine - ammoState.ammo, ammoState.reserve);
    ammoState.ammo += amount;
    ammoState.reserve -= amount;
    state.reloading = false;
  }
  updateHud();
}

function flashHit(headshot = false) {
  hud.hit.classList.remove('active');
  hud.hit.classList.toggle('headshot', headshot);
  void hud.hit.offsetWidth;
  hud.hit.classList.add('active');
}

function damageEnemy(enemy, damage, headshot, environment = false, context = {}) {
  const activeEnemyIndex = enemies.indexOf(enemy);
  if (activeEnemyIndex < 0) return;
  enemy.health -= damage;
  enemy.hitTimer = .08;
  enemy.group.children[0].material.emissive.setHex(0xffffff);
  flashHit(headshot);
  if (enemy.health > 0) {
    if (enemy.boss) {
      const phase = bossPhase(enemy.health, enemy.maxHealth);
      if (phase > enemy.phase) {
        enemy.phase = phase;
        enemy.armorBroken = phase >= 2;
        enemy.config.speed = enemy.baseSpeed * (1 + (phase - 1) * .12);
        enemy.config.damage = enemy.baseDamage * (1 + (phase - 1) * .1);
        enemy.weakPoint.userData.damageScale = 1.5 + phase * .25;
        enemy.weakPoint.material.emissiveIntensity = 1.2 + phase * .4;
        announce(`${enemy.config.label} · PHASE ${phase}`, 1.4);
      }
    }
    updateHud();
    return;
  }
  if (enemy.coverPoint) enemy.coverPoint.occupancy = null;
  state.runStats.kills += 1;
  if (headshot) state.runStats.headshots += 1;
  if (headshot) playHeadshot();
  if (enemy.boss) {
    state.runStats.bossKills += 1;
    state.runStats.bossTypes[enemy.bossType] = (state.runStats.bossTypes[enemy.bossType] ?? 0) + 1;
    state.weaponQualities[state.weaponIndex] = Math.min(WEAPON_QUALITIES.length - 1, state.weaponQualities[state.weaponIndex] + 1);
    state.armor = Math.min(100, state.armor + 35);
    shotEffects.spawnExplosion(enemy.group.position);
  }
  if (enemy.traits.length) state.runStats.eliteKills += 1;
  if (enemy.traits.length) shotEffects.spawnExplosion(enemy.group.position);
  if (environment) state.runStats.environmentKills += 1;
  if (enemy.traits.length) advanceMission('elite');
  if (headshot) advanceMission('headshot');
  if (!environment && state.mission?.weapon === currentWeapon().name) advanceMission('weapon');
  if (!environment) {
    const weapon = currentWeapon().name;
    state.runStats.weaponKills[weapon] = (state.runStats.weaponKills[weapon] ?? 0) + 1;
  }
  state.comboKills = state.comboTimer > 0 ? state.comboKills + 1 : 1;
  state.comboTimer = 4;
  const scored = scoreKill(enemy.config.score, { headshot, environment, combo: state.comboKills, ...context });
  state.score += scored.total;
  if (state.lifesteal) state.health = Math.min(state.maxHealth, state.health + state.lifesteal * 4);
  if (enemy.traits.includes('explosive') && enemy.group.position.distanceTo(camera.position) < 5) damagePlayer(20, enemy.group.position);
  enemies.splice(activeEnemyIndex, 1);
  enemyTargets = enemyTargets.filter((target) => target.userData.enemy !== enemy);
  if (state.explosiveLevel || state.chaosModifier === 'explosive-world') {
    for (const nearby of [...enemies]) {
      const distance = nearby.group.position.distanceTo(enemy.group.position);
      if (distance < 4) damageEnemy(nearby, 25 * Math.max(1, state.explosiveLevel) * (1 - distance / 5), false, true);
    }
  }
  enemy.deathTimer = enemy.boss ? .9 : .48;
  enemy.deathDuration = enemy.deathTimer;
  enemy.deathVariant = enemy.id % 5;
  dyingEnemies.push(enemy);
  announce([scored.combo, ...scored.bonuses, `${enemy.config.label} DOWN`].filter(Boolean).join(' · '), .8);
  updateHud();
  if (state.daily && state.runStats.kills >= state.daily.goal) queueMicrotask(() => {
    if (!state.runRecorded) finishRun(true);
  });
}

function explodeBarrel(barrel) {
  if (barrel.userData.exploded) return;
  barrel.userData.exploded = true;
  if (barrel.userData.key) state.usedWorld.add(barrel.userData.key);
  const position = barrel.position.clone();
  removeCover(barrel);
  emitPlayerNoise(35, 'explosion', position);
  for (const enemy of [...enemies]) {
    const distance = enemy.group.position.distanceTo(position);
    if (distance < 6) damageEnemy(enemy, 130 * (1 - distance / 8), false, true);
  }
  const playerDistance = camera.position.distanceTo(position);
  if (playerDistance < 5) damagePlayer(28 * (1 - playerDistance / 6), position);
  shotEffects.spawnExplosion(position);
}

function destroyProp(prop) {
  prop.userData.health -= 35;
  if (prop.userData.health > 0) return;
  if (prop.userData.key) state.usedWorld.add(prop.userData.key);
  removeCover(prop);
  if (prop.userData.lightNode) world.remove(prop.userData.lightNode);
  if (prop.userData.glass) emitPlayerNoise(22, 'glass', prop.position);
  if (!prop.userData.glass) state.armor = Math.min(100, state.armor + 10);
  announce(prop.userData.glass ? 'GLASS SHATTERED' : 'CRATE DESTROYED · ARMOR +10', .8);
}

function fire(force = false) {
  if (state.phase !== 'playing' || !force && !controls.isLocked) return;
  const weapon = currentWeapon();
  const now = performance.now() / 1000;
  if (state.boltTimer > 0) return;
  if (now - state.lastShot < 60 / weapon.rate) return;
  if (weapon.overheat && weapon.heat >= 100) {
    announce('WEAPON OVERHEATED', .7);
    return;
  }
  if (state.reloading) {
    if (weapon.shellReload && weapon.ammo > 0) state.reloading = false;
    else return;
  }
  if (!weapon.overheat && weapon.ammo <= 0) {
    playEmpty();
    announce(weapon.reserve ? 'RELOAD' : 'NO AMMO', .6);
    reload();
    return;
  }

  if (now - state.lastShot > Math.max(.22, 120 / weapon.rate)) state.recoilShot = 0;
  const recoil = recoilFor(weapon.recoil, state.recoilShot++, state.ads);
  const recoilMultiplier = weapon.recoilMultiplier ?? 1;
  recoil.pitch *= recoilMultiplier;
  recoil.yaw *= recoilMultiplier;
  recoil.weaponKick *= recoilMultiplier;
  state.lastShot = now;
  state.boltTimer = weapon.boltCycle ?? 0;
  state.idleTimer = 8;
  emitPlayerNoise(28 * (weapon.noise ?? 1), 'gunshot');
  playShot(weapon.name, state.run.map === 'iron' ? 'indoor' : 'outdoor');
  state.runStats.shots += 1;
  state.runStats.weaponShots[weapon.name] = (state.runStats.weaponShots[weapon.name] ?? 0) + 1;
  if (weapon.overheat) state.weapons[state.weaponIndex].heat = Math.min(100, weapon.heat + weapon.overheat);
  else if (!state.infiniteAmmo && state.chaosModifier !== 'infinite-ammo') state.weapons[state.weaponIndex].ammo -= 1;
  if (!state.settings.reduceShake) {
    state.weaponKick = recoil.weaponKick;
    state.recoilPitch += recoil.pitch;
    state.recoilYaw += recoil.yaw;
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + recoil.pitch, -Math.PI / 2 + .02, Math.PI / 2 - .02);
    camera.rotation.y += recoil.yaw;
  }
  state.muzzleTimer = .045;
  muzzle.intensity = state.settings.reduceFlash ? 0 : weapon.category === 'SHOTGUN' ? 12 : 6;
  const pellets = weapon.pellets ?? 1;
  let shotHit = false;
  const tracerStart = muzzle.getWorldPosition(tracerOrigin);
  if (weapon.category !== 'EXPERIMENTAL') {
    gun.localToWorld(casingOrigin.set(.1, .025, -.12));
    casingDirection.set(1, 0, 0).transformDirection(gun.matrixWorld);
    shotEffects.spawnCasing(casingOrigin, casingDirection);
  }
  const moving = keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD') || !state.grounded;

  for (let pellet = 0; pellet < pellets; pellet += 1) {
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const spread = weapon.spread * (state.ads ? .35 : 1) * (moving ? RECOIL_PROFILES[weapon.recoil].moveSpread : 1);
    direction.x += (state.rng() - .5) * spread;
    direction.y += (state.rng() - .5) * spread;
    direction.z += (state.rng() - .5) * spread;
    raycaster.set(camera.position, direction.normalize());
    raycaster.far = 100;
    const hits = raycaster.intersectObjects([...enemyTargets, ...animalTargets, ...coverTargets], false);
    const tracerEnd = hits[0]?.point ?? camera.position.clone().addScaledVector(direction, raycaster.far);
    shotEffects.spawnTracer(tracerStart, tracerEnd, weapon.color);
    const damaged = new Set();
    let remaining = weapon.penetration ?? 1;
    for (const hit of hits) {
      if (hit.object.userData.barrel) {
        shotEffects.spawnImpact(hit.point, 'metal');
        explodeBarrel(hit.object);
        break;
      }
      if (hit.object.userData.destructible) {
        shotEffects.spawnImpact(hit.point, hit.object.userData.surface);
        destroyProp(hit.object);
        break;
      }
      const animal = hit.object.userData.animal;
      if (animal) {
        animal.state = animal.type === 'boar' ? 'charge' : 'flee';
        animal.chargeTimer = 2;
        shotEffects.spawnImpact(hit.point, 'enemy');
        break;
      }
      const enemy = hit.object.userData.enemy;
      if (!enemy) {
        shotEffects.spawnImpact(hit.point, hit.object.userData.surface);
        break;
      }
      if (damaged.has(enemy)) continue;
      if (state.chaosModifier === 'headshot-only' && !hit.object.userData.headshot) break;
      damaged.add(enemy);
      shotEffects.spawnImpact(hit.point, 'enemy');
      shotHit = true;
      const criticalWeapon = { ...weapon, critical: (weapon.critical ?? 2) + state.criticalLevel * .2 + (state.chaosModifier === 'headshot-bonus' ? 1 : 0) };
      let damage = shotDamage(criticalWeapon, hit.object.userData.headshot, state.damageLevel, hit.distance) * (hit.object.userData.damageScale ?? 1);
      const zone = hit.object.userData.zone;
      if (zone === 'head' || zone === 'chest') {
        const armoredHit = applyArmor(damage, enemy.armor[zone], weapon.armorPenetration);
        damage = armoredHit.damage;
        enemy.armor[zone] = armoredHit.durability;
        if (armoredHit.broken) {
          enemy.armorBroken = true;
          announce(`${zone.toUpperCase()} ARMOR BREAK`, .6);
          shotEffects.spawnExplosion(hit.point);
        }
      }
      damageEnemy(enemy, damage, hit.object.userData.headshot, false, { distance: hit.distance, airborne: !state.grounded });
      if (state.chainLevel) {
        const chained = enemies.find((candidate) => candidate !== enemy && candidate.group.position.distanceTo(enemy.group.position) < 5);
        if (chained) damageEnemy(chained, 12 * state.chainLevel, false, true);
      }
      remaining -= 1;
      if (remaining <= 0) break;
    }
  }

  if (shotHit) state.runStats.hits += 1;

  updateHud();
  if (!weapon.overheat && state.weapons[state.weaponIndex].ammo === 0 && !state.infiniteAmmo && state.chaosModifier !== 'infinite-ammo') reload();
}

function melee() {
  if (state.phase !== 'playing' || state.meleeTimer > 0) return false;
  state.meleeTimer = .35;
  state.inspectTimer = 0;
  state.idleTimer = 8;
  emitPlayerNoise(6, 'melee');
  raycaster.set(camera.position, camera.getWorldDirection(new THREE.Vector3()));
  raycaster.far = 2.2;
  const hit = raycaster.intersectObjects(enemyTargets, false)[0];
  if (!hit?.object.userData.enemy) return false;
  shotEffects.spawnImpact(hit.point, 'enemy');
  damageEnemy(hit.object.userData.enemy, 55, false, false, { distance: hit.distance });
  return true;
}

function inspectWeapon() {
  if (state.phase !== 'playing' || state.reloading || state.meleeTimer > 0) return false;
  state.inspectTimer = 1.2;
  state.idleTimer = 8;
  return true;
}

function damagePlayer(amount, source = null) {
  if (state.phase !== 'playing') return;
  let damage = amount * DIFFICULTIES[state.difficulty].damage;
  const absorbed = Math.min(state.armor, damage * .6);
  state.armor -= absorbed;
  damage -= absorbed;
  if (damage > 0) advanceMission('damage');
  state.health = Math.max(0, state.health - damage);
  state.runStats.waveDamage += damage;
  playImpact();
  if (source) {
    const incoming = new THREE.Vector3().subVectors(source, camera.position);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const angle = Math.atan2(forward.x * incoming.z - forward.z * incoming.x, forward.x * incoming.x + forward.z * incoming.z);
    hud.damageDirection.style.transform = `translateX(-50%) rotate(${angle}rad)`;
    hud.damageDirection.classList.add('active');
    state.damageDirectionTimer = .65;
  }
  if (!state.settings.reduceShake) {
    state.damageKick += .012;
    camera.rotation.x -= .012;
  }
  hud.damage.classList.add('active');
  setTimeout(() => hud.damage.classList.remove('active'), 90);
  updateHud();
  if (state.health > 0) return;
  finishRun(false);
}

function finishRun(victory) {
  if (state.runRecorded) return;
  state.runRecorded = true;
  progress = recordRun(progress, {
    ...state.runStats,
    playTime: state.runTime + (state.phase === 'playing' ? (performance.now() - state.runStarted) / 1000 : 0),
    deaths: victory ? 0 : 1,
    wave: state.wave,
    score: state.score
  });
  persistProgress();
  setPhase(victory ? 'victory' : 'gameover');
  $('#final-wave').textContent = state.wave;
  $('#final-score').textContent = state.score.toLocaleString();
  $('#victory-mode').textContent = MODES[state.mode].label;
  $('#victory-score').textContent = state.score.toLocaleString();
  controls.unlock();
}

function damageObjective(amount) {
  state.objectiveHp = Math.max(0, state.objectiveHp - amount * DIFFICULTIES[state.difficulty].damage);
  updateHud();
  if (state.objectiveHp <= 0) finishRun(false);
}

function beginExtraction() {
  state.extracting = true;
  state.extractionTimer = 15;
  state.objective = new THREE.Mesh(
    new THREE.TorusGeometry(3.8, .16, 7, 48),
    new THREE.MeshBasicMaterial({ color: 0x66efff })
  );
  state.objective.rotation.x = Math.PI / 2;
  state.objective.position.set(25, .12, 25);
  objectiveLayer.add(state.objective);
  createWave(state.wave + 1, state.difficulty).forEach(spawnEnemy);
  announce('REACH EXTRACTION ZONE', 3);
}

function completeWave() {
  state.wavePending = true;
  state.score += state.wave * 250;
  if (state.runStats.waveDamage === 0) state.runStats.untouchedWaves += 1;
  if (state.mode === 'extraction' && state.wave >= 3) {
    beginExtraction();
    state.wavePending = false;
    return;
  }
  if ((state.mode === 'hunt' && state.wave >= 3) || (state.mode === 'defense' && state.wave >= 5) || (state.mode === 'chaos' && state.wave >= 5)) {
    finishRun(true);
    return;
  }
  const perks = pickPerks(state.rng);
  document.querySelectorAll('[data-upgrade]').forEach((button, index) => {
    button.dataset.upgrade = perks[index].id;
    button.querySelector('strong').textContent = perks[index].name;
    button.querySelector('span').textContent = perks[index].description;
  });
  setPhase('upgrade');
  controls.unlock();
  updateHud();
}

function alertSquad(source) {
  for (const member of enemies) {
    if (member === source || member.squadId !== source.squadId) continue;
    member.lastKnownPlayerPosition.copy(source.lastKnownPlayerPosition);
    member.memoryTimer = Math.max(member.memoryTimer, 3);
    if (!member.seesPlayer) member.combatState = 'investigate';
  }
}

function updateAnimals(delta) {
  for (const animal of animals) {
    const fromPlayer = animalDirection.subVectors(animal.group.position, camera.position);
    fromPlayer.y = 0;
    const distance = fromPlayer.length();
    if ((animal.type === 'deer' || animal.type === 'rabbit' || animal.type === 'wolf') && distance < 10) animal.state = 'flee';
    if (animal.type === 'bird' && playerNoise.timer > 0 && playerNoise.type === 'gunshot') animal.state = 'flee';
    if (animal.state === 'flee') {
      animal.group.position.addScaledVector(fromPlayer.normalize(), animal.speed * delta);
      if (animal.type === 'bird') animal.group.position.y = Math.min(10, animal.group.position.y + delta * 2.5);
    }
    if (animal.state === 'charge') {
      const towardPlayer = fromPlayer.multiplyScalar(-1).normalize();
      animal.group.position.addScaledVector(towardPlayer, animal.speed * 1.8 * delta);
      animal.chargeTimer -= delta;
      if (distance < 1.2 && animal.chargeTimer > 0) {
        damagePlayer(10, animal.group.position);
        animal.chargeTimer = 0;
      }
      if (animal.chargeTimer <= 0) animal.state = 'flee';
    }
    if (animal.type === 'bird') animal.body.rotation.x = Math.sin(performance.now() * .02) * .35;
    animal.group.position.x = THREE.MathUtils.clamp(animal.group.position.x, -37, 37);
    animal.group.position.z = THREE.MathUtils.clamp(animal.group.position.z, -37, 37);
  }
}

function updateEnemies(delta) {
  const difficulty = DIFFICULTIES[state.difficulty];
  for (const enemy of [...enemies]) {
    enemy.perceptionTimer -= delta;
    enemy.memoryTimer = Math.max(0, enemy.memoryTimer - delta);
    if (enemy.perceptionTimer <= 0) {
      const distanceToPlayer = enemy.group.position.distanceTo(camera.position);
      sightOrigin.copy(enemy.group.position);
      sightOrigin.y += 1.2;
      sightDirection.subVectors(camera.position, sightOrigin);
      raycaster.set(sightOrigin, sightDirection.normalize());
      raycaster.far = distanceToPlayer;
      enemy.seesPlayer = distanceToPlayer < 38 && !raycaster.intersectObjects(coverTargets, false).length;
      if (enemy.seesPlayer) {
        enemy.lastKnownPlayerPosition.copy(camera.position);
        enemy.memoryTimer = memorySeconds(state.difficulty);
        enemy.combatState = 'engage';
        alertSquad(enemy);
      } else if (playerNoise.timer > 0 && canHear(enemy.group.position.distanceTo(playerNoise.position), playerNoise.radius)) {
        enemy.lastKnownPlayerPosition.copy(playerNoise.position);
        enemy.memoryTimer = Math.max(enemy.memoryTimer, 3);
        enemy.combatState = 'investigate';
        enemy.heardNoise = playerNoise.type;
        alertSquad(enemy);
      }
      enemy.perceptionTimer = state.difficulty === 'hard' ? .12 : .25;
    }
    const target = enemyTarget.copy(state.mode === 'defense' && state.objective ? state.objective.position : enemy.memoryTimer > 0 ? enemy.lastKnownPlayerPosition : enemy.patrolTarget);
    if (state.difficulty === 'hard' && enemy.seesPlayer) {
      const prediction = camera.getWorldDirection(enemyPrediction);
      prediction.y = 0;
      const side = enemySide.set(-prediction.z, 0, prediction.x);
      target.addScaledVector(prediction, (Number(keys.has('KeyW')) - Number(keys.has('KeyS'))) * 1.5);
      target.addScaledVector(side, (Number(keys.has('KeyD')) - Number(keys.has('KeyA'))) * 1.5);
    }
    enemyDirection.subVectors(target, enemy.group.position);
    enemyDirection.y = 0;
    const distance = enemyDirection.length();
    const direction = enemyDirection.normalize();
    if (enemy.memoryTimer === 0) enemy.combatState = 'patrol';
    const config = enemy.config;
    enemy.coverDecisionTimer -= delta;
    enemy.squadCommandTimer = Math.max(0, enemy.squadCommandTimer - delta);
    if (!enemy.squadCommandTimer) enemy.squadCommand = null;
    enemy.commandCooldown -= delta;
    if (config.commander && state.difficulty !== 'easy' && enemy.commandCooldown <= 0) {
      const commands = state.difficulty === 'hard'
        ? enemy.health < enemy.maxHealth * .35 ? ['retreat'] : distance > 18 ? ['suppress', 'push'] : ['flank-left', 'flank-right', 'push']
        : ['push', 'retreat'];
      const command = commands[Math.floor(state.rng() * commands.length)];
      // ponytail: squad size is capped at five, so a linear broadcast is the complete solution here.
      for (const member of enemies.filter(({ squadId }) => squadId === enemy.squadId)) {
        member.squadCommand = command;
        member.squadCommandTimer = 4;
      }
      enemy.commandCooldown = 6;
      announce(`COMMANDER · ${command.toUpperCase().replace('-', ' ')}`, .8);
    }
    const commanded = Boolean(enemy.squadCommand);
    let movement;

    if (config.behavior === 'rush') movement = distance > config.range * .85 ? 1 : 0;
    else if (config.behavior === 'flank') movement = distance > config.range * .75 ? .8 : 0;
    else if (config.behavior === 'hold') movement = distance > config.range * .82 ? 1 : distance < config.range * .42 ? -.65 : 0;
    else if (config.behavior === 'support') movement = distance > 9 ? 1 : distance < 4 ? -.5 : 0;
    else movement = distance > config.range * .72 ? 1 : distance < config.range * .35 ? -.35 : 0;
    if (enemy.personality === 'aggressive') movement = Math.max(1, movement);
    if (enemy.personality === 'cautious' && distance < config.range * .75) movement = -.7;
    if (enemy.personality === 'coward' && enemy.health < enemy.maxHealth * .4) movement = -1;
    if (state.difficulty === 'hard' && enemy.health < enemy.maxHealth * .22 && !enemy.boss) movement = -1;
    if (enemy.squadCommand === 'retreat') movement = -1;
    if (enemy.squadCommand === 'push') movement = Math.max(1.25, movement);
    if (enemy.squadCommand === 'suppress') movement = 0;

    const chaosSpeed = state.chaosModifier === 'fast-enemies' ? 2 : 1;
    const squadSpeed = commanded ? 1.15 : 1;
    let moveDirection = direction;
    if (enemy.personality === 'flanker' && state.difficulty !== 'easy') moveDirection = enemyMovement.set(-direction.z * enemy.strafe, 0, direction.x * enemy.strafe);
    if (enemy.squadCommand === 'flank-left') moveDirection = enemyMovement.set(-direction.z, 0, direction.x);
    if (enemy.squadCommand === 'flank-right') moveDirection = enemyMovement.set(direction.z, 0, -direction.x);
    if (enemy.coverPoint) {
      const coverDirection = enemyCoverDirection.set(enemy.coverPoint.x - enemy.group.position.x, 0, enemy.coverPoint.z - enemy.group.position.z);
      const coverDistance = coverDirection.length();
      if (coverDistance > .45) {
        moveDirection = coverDirection.normalize();
        movement = 1;
        enemy.combatState = 'take-cover';
      } else {
        movement = 0;
        enemy.combatState = 'engage';
      }
    }
    enemy.avoidanceTimer = Math.max(0, enemy.avoidanceTimer - delta);
    if (enemy.avoidanceTimer > 0) {
      moveDirection = enemy.avoidanceDirection;
      movement = Math.max(.8, Math.abs(movement));
    }
    const startX = enemy.group.position.x;
    const startZ = enemy.group.position.z;
    const movementStep = movement * config.speed * difficulty.speed * chaosSpeed * squadSpeed * delta;
    enemy.group.position.addScaledVector(moveDirection, movementStep);
    if (config.behavior !== 'rush' && distance < config.range * 1.1) {
      const strafeSpeed = config.behavior === 'flank' ? 2.2 : .75;
      enemy.group.position.x += -direction.z * enemy.strafe * delta * strafeSpeed;
      enemy.group.position.z += direction.x * enemy.strafe * delta * strafeSpeed;
    }
    if (!config.flying && positionBlocked(enemy.group.position.x, enemy.group.position.z, enemy.boss ? .7 : .42)) {
      const attemptedX = enemy.group.position.x - startX;
      const attemptedZ = enemy.group.position.z - startZ;
      enemy.group.position.set(startX, enemy.group.position.y, startZ);
      for (const [cosine, sine] of collisionSteering) {
        const candidateX = startX + attemptedX * cosine - attemptedZ * sine;
        const candidateZ = startZ + attemptedX * sine + attemptedZ * cosine;
        if (positionBlocked(candidateX, candidateZ, enemy.boss ? .7 : .42)) continue;
        enemy.group.position.set(candidateX, enemy.group.position.y, candidateZ);
        enemy.avoidanceDirection.set(candidateX - startX, 0, candidateZ - startZ).normalize();
        enemy.avoidanceTimer = .75;
        break;
      }
    }
    const desiredYaw = Math.atan2(target.x - enemy.group.position.x, target.z - enemy.group.position.z);
    const yawDelta = Math.atan2(Math.sin(desiredYaw - enemy.group.rotation.y), Math.cos(desiredYaw - enemy.group.rotation.y));
    enemy.group.rotation.y += THREE.MathUtils.clamp(yawDelta, -delta * 4, delta * 4);
    const lodDistance = enemy.group.position.distanceTo(camera.position);
    const lowDetail = lodDistance > enemyLodDistance;
    enemy.detailMeshes.forEach((mesh) => { mesh.visible = !lowDetail; });
    enemy.accessories.forEach((mesh) => { mesh.visible = !lowDetail && lodDistance < 18; });
    enemy.lowMesh.visible = lowDetail;
    if (enemy.bossSignature) enemy.bossSignature.visible = true;
    if (enemy.weakPoint) enemy.weakPoint.visible = true;
    enemy.animationTime += delta * (2 + Math.abs(movement) * config.speed * 2.5);
    enemy.fireTimer = Math.max(0, enemy.fireTimer - delta);
    const stride = Math.sin(enemy.animationTime) * Math.min(.65, Math.abs(movement) * .65);
    enemy.arms[0].rotation.x = stride + (enemy.fireTimer ? -.35 : 0);
    enemy.arms[1].rotation.x = -stride + (enemy.fireTimer ? -.35 : 0);
    enemy.legs[0].rotation.x = -stride;
    enemy.legs[1].rotation.x = stride;
    enemy.group.rotation.z = THREE.MathUtils.lerp(enemy.group.rotation.z, enemy.hitTimer > 0 ? enemy.strafe * .08 : 0, Math.min(1, delta * 18));
    if (enemy.bossSignature) enemy.bossSignature.rotation.y += delta * (.8 + enemy.phase * .35);
    enemy.attackTimer -= delta;
    enemy.abilityTimer -= delta;
    enemy.hitTimer -= delta;
    if (enemy.traits.includes('regeneration')) enemy.health = Math.min(enemy.maxHealth, enemy.health + enemy.maxHealth * .008 * delta);
    if (enemy.hitTimer <= 0) enemy.group.children[0].material.emissive.setHex(enemy.emissive);
    enemy.lowMesh.material.emissive.copy(enemy.group.children[0].material.emissive);

    if (enemy.pendingAttack) {
      enemy.telegraphTimer -= delta;
      enemy.group.children[0].material.emissive.setHex(enemy.telegraphTimer % .2 < .1 ? 0xff6a23 : enemy.emissive);
      enemy.lowMesh.material.emissive.copy(enemy.group.children[0].material.emissive);
      if (enemy.telegraphTimer <= 0) {
        if (state.rng() < enemy.pendingAttack.accuracy) {
          if (enemy.pendingAttack.objective) damageObjective(enemy.pendingAttack.damage);
          else damagePlayer(enemy.pendingAttack.damage, enemy.group.position);
        }
        enemy.pendingAttack = null;
      }
      continue;
    }

    if (enemy.boss && config.ability === 'summon' && enemy.abilityTimer <= 0 && enemies.length < 60) {
      for (let index = 0; index < 2; index += 1) {
        const drone = spawnEnemy('drone', enemies.length + index);
        drone.group.position.copy(enemy.group.position);
        drone.group.position.x += index ? 2 : -2;
      }
      enemy.abilityTimer = 12;
      announce('DRONE WAVE', 1.2);
    }
    if (enemy.boss && config.ability === 'teleport' && enemy.abilityTimer <= 0) {
      enemy.group.position.set(
        THREE.MathUtils.clamp(camera.position.x + (state.rng() - .5) * 18, -32, 32),
        0,
        THREE.MathUtils.clamp(camera.position.z + (state.rng() - .5) * 18, -32, 32)
      );
      enemy.abilityTimer = 5;
      announce('PHANTOM SHIFT', .8);
    }

    if (config.medic && enemy.attackTimer <= 0) {
      const patient = enemies.find((other) => other !== enemy && other.health < other.maxHealth && other.group.position.distanceTo(enemy.group.position) < 9);
      if (patient) {
        patient.health = Math.min(patient.maxHealth, patient.health + 18);
        patient.group.children[0].material.emissive.setHex(0x35ff9a);
        patient.hitTimer = .15;
        enemy.attackTimer = config.fireDelay * difficulty.fireDelay;
        continue;
      }
    }

    if (enemy.seesPlayer && distance <= config.range && enemy.attackTimer <= 0) {
      sightOrigin.copy(enemy.group.position);
      sightOrigin.y += 1.2;
      sightDirection.subVectors(target, sightOrigin);
      const sightDistance = sightDirection.length();
      raycaster.set(sightOrigin, sightDirection.normalize());
      raycaster.far = sightDistance;
      if (raycaster.intersectObjects(coverTargets, false).length) {
        if (state.difficulty !== 'easy' && !enemy.boss && config.range > 3 && enemy.coverDecisionTimer <= 0) {
          if (enemy.coverPoint) {
            enemy.coverPoint.occupancy = null;
            enemy.coverPoint.danger += 1;
          }
          enemy.coverPoint = chooseCover(coverPoints, enemy.group.position, target);
          if (enemy.coverPoint) enemy.coverPoint.occupancy = enemy.id;
          enemy.coverDecisionTimer = state.difficulty === 'hard' ? .35 : .7;
        }
        enemy.attackTimer = .2;
        continue;
      }
      enemy.attackTimer = config.fireDelay * difficulty.fireDelay * (.82 + state.rng() * .36);
      enemy.fireTimer = .12;
      const weatherAccuracy = WEATHER[state.run.weather].visibility;
      const accuracy = config.behavior === 'rush' && config.range < 3 ? 1 : (difficulty.accuracy + (enemy.traits.includes('accurate') ? .18 : 0) + (commanded ? .1 : 0)) * weatherAccuracy * Math.max(.45, 1 - distance / 40);
      if (enemy.boss) {
        enemy.telegraphTimer = .9;
        enemy.pendingAttack = { accuracy, damage: config.damage, objective: state.mode === 'defense' };
        enemy.attackTimer += enemy.telegraphTimer;
        announce(`${config.label} ATTACK`, .75);
        continue;
      }
      if (state.rng() < accuracy) {
        if (state.mode === 'defense') damageObjective(config.damage);
        else damagePlayer(config.damage, enemy.group.position);
      }
    }
  }

  if (!enemies.length && !state.wavePending && !state.extracting && state.phase === 'playing') completeWave();
}

function updateObjective(delta) {
  if (!state.extracting) return;
  if (camera.position.distanceTo(state.objective.position) < 4.2) {
    state.extractionTimer -= delta;
    hud.message.textContent = `EXTRACTING · ${Math.max(0, Math.ceil(state.extractionTimer))}`;
    if (state.extractionTimer <= 0) finishRun(true);
  } else {
    hud.message.textContent = 'REACH EXTRACTION ZONE';
  }
  updateHud();
}

const STAND_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.12;
const GRAVITY = 20;
const JUMP_SPEED = 7.2;

function vaultTarget() {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  direction.y = 0;
  return findVaultTarget(
    camera.position,
    direction,
    coverTargets.map(({ userData }) => {
      const { min, max } = userData.collisionBox;
      return { minX: min.x, minY: min.y, minZ: min.z, maxX: max.x, maxY: max.y, maxZ: max.z };
    }),
  );
}

function updatePlayer(delta) {
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  const moving = forward || right;
  const sprinting = !state.crouching && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
  state.footstepTimer = Math.max(0, state.footstepTimer - delta);
  if (moving && state.grounded && state.footstepTimer === 0) {
    emitPlayerNoise(keys.has('ShiftLeft') || keys.has('ShiftRight') ? 10 : 6, 'footstep');
    state.footstepTimer = state.crouching ? .7 : .38;
  }
  const length = Math.hypot(forward, right) || 1;
  state.crouching = state.grounded && (state.crouchToggled || keys.has('ControlLeft') || keys.has('ControlRight'));
  controls.pointerSpeed = state.settings.sensitivity * (state.ads ? state.settings.adsSensitivity : 1);
  const action = nearestAction();
  hud.interaction.textContent = action?.kind === 'interaction' ? `[E] ${action.item.label}` : action ? `[E] OPEN ${action.item.quality.toUpperCase()} CACHE` : '';

  if (state.jumpRequested && state.grounded && !state.crouching) {
    const target = forward > 0 ? vaultTarget() : null;
    if (target) {
      state.vault = { duration: .45, elapsed: 0, startX: camera.position.x, startZ: camera.position.z, ...target };
      state.grounded = false;
      state.verticalVelocity = 0;
    } else {
      state.grounded = false;
      state.verticalVelocity = JUMP_SPEED;
    }
  } else if (state.jumpRequested && state.airJumps > 0 && !state.vault) {
    state.verticalVelocity = JUMP_SPEED;
    state.airJumps -= 1;
  }
  state.jumpRequested = false;

  if (state.vault) {
    state.vault.elapsed += delta;
    const progress = Math.min(1, state.vault.elapsed / state.vault.duration);
    const eased = progress * progress * (3 - 2 * progress);
    camera.position.x = THREE.MathUtils.lerp(state.vault.startX, state.vault.x, eased);
    camera.position.z = THREE.MathUtils.lerp(state.vault.startZ, state.vault.z, eased);
    state.playerY = Math.sin(progress * Math.PI) * state.vault.apex;
    if (progress === 1) {
      state.vault = null;
      state.playerY = 0;
      state.grounded = true;
      state.airJumps = state.doubleJump;
      state.landingTimer = .18;
    }
  } else {
    const baseSpeed = sprinting ? 9 * (1 + state.sprintLevel * .15) : state.crouching ? 3.2 : 5.8;
    const airControl = state.grounded ? 1 : .35;
    const chaosSpeed = state.chaosModifier === 'fast-player' ? 2 : 1;
    const speed = baseSpeed * airControl * (currentWeapon().movePenalty ?? 1) * (1 + state.moveLevel * .1) * chaosSpeed;
    const startX = camera.position.x;
    const startZ = camera.position.z;
    controls.moveForward((forward / length) * speed * delta);
    controls.moveRight((right / length) * speed * delta);
    let nextX = THREE.MathUtils.clamp(camera.position.x, -37, 37);
    let nextZ = THREE.MathUtils.clamp(camera.position.z, -37, 37);
    if (positionBlocked(nextX, nextZ)) {
      if (!positionBlocked(nextX, startZ)) nextZ = startZ;
      else if (!positionBlocked(startX, nextZ)) nextX = startX;
      else [nextX, nextZ] = [startX, startZ];
    }
    camera.position.x = nextX;
    camera.position.z = nextZ;

    if (!state.grounded) {
      state.verticalVelocity -= (state.chaosModifier === 'low-gravity' ? GRAVITY * .35 : GRAVITY) * delta;
      state.playerY += state.verticalVelocity * delta;
      if (state.playerY <= 0) {
        state.playerY = 0;
        state.verticalVelocity = 0;
        state.grounded = true;
        state.airJumps = state.doubleJump;
        state.landingTimer = .18;
      }
    }
  }
  state.landingTimer = Math.max(0, state.landingTimer - delta);
  state.eyeHeight = THREE.MathUtils.lerp(state.eyeHeight, state.crouching ? CROUCH_HEIGHT : STAND_HEIGHT, Math.min(1, delta * 14));
  camera.position.y = state.playerY + state.eyeHeight;
  playerShadowRig.position.set(camera.position.x, state.playerY, camera.position.z);
  playerShadowRig.rotation.y = camera.rotation.y;

  const weapon = currentWeapon();
  const targetFov = state.ads ? (weapon.adsFov ?? Math.max(40, state.settings.fov - 16)) : state.settings.fov;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, delta * 12));
  camera.updateProjectionMatrix();
  const bob = moving && state.grounded ? Math.sin(performance.now() * .011) * .012 : 0;
  const landingKick = state.landingTimer ? Math.sin(state.landingTimer / .18 * Math.PI) * .055 : 0;
  const targetX = state.ads ? .015 : .34;
  const reloadMotion = state.reloading ? Math.sin((1 - state.reloadTimer / Math.max(.01, state.reloadDuration)) * Math.PI) : 0;
  const boltMotion = state.boltTimer > 0 ? Math.sin((1 - state.boltTimer / Math.max(.01, weapon.boltCycle)) * Math.PI) : 0;
  const inspectMotion = state.inspectTimer > 0 ? Math.sin((1.2 - state.inspectTimer) / 1.2 * Math.PI) : 0;
  const meleeMotion = state.meleeTimer > 0 ? Math.sin((.35 - state.meleeTimer) / .35 * Math.PI) : 0;
  const idleMotion = state.idleTimer === 0 ? Math.sin(performance.now() * .0012) * .08 : 0;
  gun.position.x = THREE.MathUtils.lerp(gun.position.x, targetX, Math.min(1, delta * 12));
  gun.position.y = THREE.MathUtils.lerp(gun.position.y, -.28 + bob - landingKick - state.weaponKick - state.equipTimer * .7 - (sprinting && moving ? .12 : 0), Math.min(1, delta * 22));
  gun.rotation.z = THREE.MathUtils.lerp(gun.rotation.z, reloadMotion * (weapon.ammo ? .55 : -.72) + boltMotion * .22 + inspectMotion * 1.15 + idleMotion + (sprinting && moving ? -.32 : 0), Math.min(1, delta * 14));
  gun.rotation.x = THREE.MathUtils.lerp(gun.rotation.x, reloadMotion * .35 - boltMotion * .18 + inspectMotion * .25 - meleeMotion * .75 + (sprinting && moving ? -.22 : 0), Math.min(1, delta * 14));
  weaponModel.update({ reload: reloadMotion, bolt: Math.max(boltMotion, state.muzzleTimer > 0 ? 1 : 0), heat: weapon.overheat ? weapon.heat / 100 : state.muzzleTimer > 0 ? .3 : 0, time: performance.now() / 1000 });
  state.weaponKick = THREE.MathUtils.lerp(state.weaponKick, 0, Math.min(1, delta * 16));
  const profile = RECOIL_PROFILES[weapon.recoil];
  const pitchRecovery = Math.min(state.recoilPitch, profile.recovery * delta);
  const yawRecovery = Math.sign(state.recoilYaw) * Math.min(Math.abs(state.recoilYaw), profile.recovery * .65 * delta);
  const damageRecovery = Math.min(state.damageKick, .09 * delta);
  camera.rotation.x -= pitchRecovery;
  camera.rotation.y -= yawRecovery;
  camera.rotation.x += damageRecovery;
  state.recoilPitch -= pitchRecovery;
  state.recoilYaw -= yawRecovery;
  state.damageKick -= damageRecovery;
}

function triggerArenaShift() {
  const features = state.worldFeatures;
  if (!features?.arenaWalls.length) return false;
  features.arenaShifted = !features.arenaShifted;
  features.arenaShiftTimer = 90;
  announce('ARENA SHIFT', 2);
  return true;
}

function updateWorldFeatures(delta) {
  const features = state.worldFeatures;
  if (!features) return;
  features.portalCooldown = Math.max(0, features.portalCooldown - delta);
  const doorTarget = camera.position.distanceTo(features.door.position) < 5 ? 5 : 1.5;
  features.door.position.y = THREE.MathUtils.lerp(features.door.position.y, doorTarget, Math.min(1, delta * 5));
  features.door.userData.collisionBox.setFromObject(features.door);
  features.elevator.position.y = THREE.MathUtils.lerp(features.elevator.position.y, features.elevatorTarget, Math.min(1, delta * 2));
  features.elevator.userData.collisionBox.setFromObject(features.elevator);
  features.movingPlatform.position.x = 12 + Math.sin(performance.now() * .0007) * 5;
  features.movingPlatform.userData.collisionBox.setFromObject(features.movingPlatform);
  features.arenaShiftTimer -= delta;
  if (features.arenaShiftTimer <= 0) triggerArenaShift();
  for (const wall of features.arenaWalls) {
    const target = arenaShiftPosition(wall.userData.shiftIndex, features.arenaShifted);
    wall.position.x = THREE.MathUtils.lerp(wall.position.x, target.x, Math.min(1, delta * .7));
    wall.position.z = THREE.MathUtils.lerp(wall.position.z, target.z, Math.min(1, delta * .7));
    wall.rotation.y = THREE.MathUtils.lerp(wall.rotation.y, target.rotation, Math.min(1, delta * .7));
    wall.userData.collisionBox.setFromObject(wall);
    const shiftedPoints = coverPointsForBox(wall.userData.collisionBox, 0);
    wall.userData.coverPoints.forEach((point, index) => Object.assign(point, shiftedPoints[index]));
  }
  if (!features.portalCooldown) {
    const portalIndex = features.portals.findIndex((portal) => portal.position.distanceTo(camera.position) < 2);
    if (portalIndex >= 0) {
      const destination = features.portals[1 - portalIndex].position;
      camera.position.set(destination.x + (portalIndex ? -2.5 : 2.5), camera.position.y, destination.z);
      features.portalCooldown = 1;
      announce('PORTAL TRANSIT', .7);
    }
  }
  if (features.trapTimer > 0) {
    features.trapTimer -= delta;
    features.trap.material.emissiveIntensity = 2;
    for (const enemy of [...enemies]) {
      if (enemy.group.position.distanceTo(features.trap.position) < 4) damageEnemy(enemy, 500, false, true);
    }
  } else features.trap.material.emissiveIntensity = .25;
  if (features.turretActive && enemies.length) {
    features.turretTimer -= delta;
    const target = enemies.reduce((closest, enemy) => enemy.group.position.distanceTo(features.turret.position) < closest.group.position.distanceTo(features.turret.position) ? enemy : closest);
    features.turret.lookAt(target.group.position.x, features.turret.position.y, target.group.position.z);
    if (features.turretTimer <= 0 && target.group.position.distanceTo(features.turret.position) < 22) {
      features.turretTimer = .4;
      damageEnemy(target, 18, false, true);
    }
  }
}

function updateTimers(delta) {
  shotEffects.update(delta);
  playerNoise.timer = Math.max(0, playerNoise.timer - delta);
  state.equipTimer = Math.max(0, state.equipTimer - delta);
  state.boltTimer = Math.max(0, state.boltTimer - delta);
  state.inspectTimer = Math.max(0, state.inspectTimer - delta);
  state.meleeTimer = Math.max(0, state.meleeTimer - delta);
  state.idleTimer = Math.max(0, state.idleTimer - delta);
  if (state.regeneration && state.health > 0) state.health = Math.min(state.maxHealth, state.health + state.regeneration * 1.5 * delta);
  state.healthCueTimer = Math.max(0, state.healthCueTimer - delta);
  if (state.health > 0 && state.health / state.maxHealth <= .25 && state.healthCueTimer === 0) {
    playHealthCue();
    state.healthCueTimer = 1.1;
  }
  for (const enemy of [...dyingEnemies]) {
    enemy.deathTimer -= delta;
    const progress = 1 - Math.max(0, enemy.deathTimer) / enemy.deathDuration;
    if (enemy.deathVariant === 0) enemy.group.rotation.x = progress * 1.35;
    if (enemy.deathVariant === 1) enemy.group.rotation.x = -progress * 1.35;
    if (enemy.deathVariant === 2) enemy.group.rotation.z = progress * 1.35;
    if (enemy.deathVariant === 3) enemy.group.rotation.z = -progress * 1.35;
    if (enemy.deathVariant === 4) enemy.group.scale.multiplyScalar(1 - delta * .8);
    if (enemy.deathTimer <= 0) {
      dyingEnemies.splice(dyingEnemies.indexOf(enemy), 1);
      disposeEnemy(enemy);
    }
  }
  state.comboTimer = Math.max(0, state.comboTimer - delta);
  if (state.comboTimer === 0 && state.comboKills) {
    state.comboKills = 0;
    updateHud();
  }
  if (state.mission) {
    state.mission.time -= delta;
    if (state.mission.id === 'hold' && Math.hypot(camera.position.x, camera.position.z) <= 4) advanceMission('hold', delta);
    if (state.mission?.id === 'no-damage') advanceMission('survive', delta);
    if (state.mission && state.mission.time <= 0) {
      announce(`MISSION FAILED · ${state.mission.label}`, 1.5);
      state.mission = null;
      updateHud();
    }
  }
  if (state.damageDirectionTimer > 0) {
    state.damageDirectionTimer -= delta;
    if (state.damageDirectionTimer <= 0) hud.damageDirection.classList.remove('active');
  }
  state.weapons.forEach((weaponState, slot) => {
    if (WEAPONS[state.loadout[slot]].overheat) weaponState.heat = Math.max(0, weaponState.heat - delta * 28);
  });
  if (currentWeapon().overheat) {
    state.heatHudTimer -= delta;
    if (state.heatHudTimer <= 0) {
      state.heatHudTimer = .1;
      updateHud();
    }
  }
  if (state.reloading) {
    state.reloadTimer -= delta;
    if (state.reloadTimer <= 0) finishReload();
  }
  if (state.messageTimer > 0) {
    state.messageTimer -= delta;
    if (state.messageTimer <= 0) hud.message.textContent = '';
  }
  if (state.muzzleTimer > 0) {
    state.muzzleTimer -= delta;
    if (state.muzzleTimer <= 0) muzzle.intensity = 0;
  }
  if (state.weatherParticles) {
    state.weatherParticles.position.y -= delta * 14;
    if (state.weatherParticles.position.y < -12) state.weatherParticles.position.y = 12;
  }
  if (state.run.weather === 'storm') {
    state.weatherCueTimer -= delta;
    if (state.weatherCueTimer <= 0) {
      playWeather('storm');
      sun.intensity = 6;
      state.lightningTimer = .08;
      state.weatherCueTimer = 5 + state.rng() * 7;
    }
  }
  if (state.lightningTimer > 0) {
    state.lightningTimer -= delta;
    if (state.lightningTimer <= 0) applyTime(state.run.time);
  }
  if (state.mode === 'chaos' && !state.daily && !state.custom?.modifier) {
    state.chaosTimer -= delta;
    state.chaosEffectTimer -= delta;
    if (state.chaosEffectTimer <= 0) state.chaosModifier = null;
    if (state.chaosTimer <= 0) {
      const modifier = ROTATING_CHAOS_MODIFIERS[Math.floor(state.rng() * ROTATING_CHAOS_MODIFIERS.length)];
      state.chaosModifier = modifier.id;
      state.chaosTimer = 28;
      state.chaosEffectTimer = 18;
      if (modifier.id === 'random-weapon') switchWeapon(Math.floor(state.rng() * state.loadout.length));
      announce(modifier.label, 2.5);
    }
  }
}

function monitorPerformance(delta) {
  if (state.phase !== 'playing') return;
  state.performanceTime += delta;
  state.performanceFrames += 1;
  if (state.performanceTime < 10) return;
  const fps = state.performanceFrames / state.performanceTime;
  state.performanceTime = 0;
  state.performanceFrames = 0;
  if (fps >= 45 || state.performanceLevel >= 3) return;
  state.performanceLevel += 1;
  applyGraphicsSettings();
  announce(`PERFORMANCE MODE ${state.performanceLevel}`, 1.5);
}

const diagnostic = diagnosticMode ? {
  complete: false,
  elapsed: 0,
  frameTimes: [],
  mode: diagnosticMode,
  potentialStuckAgents: 0,
  movement: new Map(),
  positions: new Map(),
  report: null,
  startMemoryMb: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
  target: 0,
} : null;

function runtimeMetrics() {
  const particles = state.weatherParticles ? Math.min(state.weatherParticles.geometry.drawRange.count, state.weatherParticles.geometry.attributes.position.count) : 0;
  return {
    drawCalls: renderer.info.render.calls,
    enemies: enemies.length,
    memoryMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 100) / 100 : null,
    particles,
    textureMemoryEstimateMb: renderer.info.memory.textures * 4,
    triangles: renderer.info.render.triangles,
  };
}

function addStressEnemies(target) {
  while (enemies.length < target) spawnEnemy('grunt', enemies.length, { suppressElite: true });
  diagnostic.target = target;
  diagnostic.positions = new Map(enemies.map((enemy) => [enemy.id, enemy.group.position.clone()]));
  diagnostic.movement = new Map(enemies.map((enemy) => [enemy.id, 0]));
  updateHud();
}

function sampleAgentMovement() {
  for (const enemy of enemies) {
    const previous = diagnostic.positions.get(enemy.id);
    if (!previous) {
      diagnostic.positions.set(enemy.id, enemy.group.position.clone());
      diagnostic.movement.set(enemy.id, 0);
      continue;
    }
    diagnostic.movement.set(enemy.id, (diagnostic.movement.get(enemy.id) ?? 0) + previous.distanceTo(enemy.group.position));
    previous.copy(enemy.group.position);
  }
}

function checkPotentialStuckAgents() {
  for (const enemy of enemies) {
    const distanceToPlayer = enemy.group.position.distanceTo(camera.position);
    const moved = diagnostic.movement.get(enemy.id) ?? 0;
    if (distanceToPlayer > enemy.config.range * 1.1 && moved < .25) {
      diagnostic.potentialStuckAgents += 1;
    }
  }
}

function startDiagnostic() {
  $('#seed').value = `DIAGNOSTIC-${diagnostic.mode.toUpperCase()}`;
  $('#map').value = 'verdant';
  $('#modifier-policy').value = 'normal';
  startGame();
  clearEnemies();
  state.health = 100000;
  state.maxHealth = 100000;
  state.run.weather = 'storm';
  buildMap(state.run);
  if (diagnostic.mode === 'benchmark') {
    state.weatherParticles?.geometry.setDrawRange(0, 120);
    for (let index = 0; index < 20; index += 1) spawnEnemy('grunt', index, { suppressElite: true });
    for (let index = 0; index < 4; index += 1) spawnEnemy('grunt', 20 + index, { forceElite: true });
    spawnEnemy('heavy', 24, { boss: true, bossType: 'juggernaut' });
    for (const [x, z, color] of [[-8, -8, 0xff6030], [8, -8, 0x30a0ff], [0, 9, 0xc8ff54]]) {
      const light = new THREE.PointLight(color, 5, 16);
      light.position.set(x, 3, z);
      world.add(light);
    }
    diagnostic.target = 25;
  } else {
    addStressEnemies(STRESS_TARGETS[0]);
  }
  updateHud();
}

function updateDiagnostic(frameDelta) {
  if (!diagnostic || diagnostic.complete) return;
  diagnostic.elapsed += frameDelta;
  diagnostic.frameTimes.push(frameDelta * 1000);
  if (diagnostic.mode === 'ai-stress') {
    sampleAgentMovement();
    const target = stressTarget(diagnostic.elapsed);
    if (target !== diagnostic.target) {
      checkPotentialStuckAgents();
      addStressEnemies(target);
    }
  }
  const duration = diagnostic.mode === 'benchmark' ? 10 : STRESS_TARGETS.length * 5;
  if (diagnostic.elapsed < duration) return;
  if (diagnostic.mode === 'ai-stress') checkPotentialStuckAgents();
  const metrics = runtimeMetrics();
  diagnostic.report = {
    ...summarizePerformance(diagnostic.frameTimes, metrics),
    durationSeconds: Math.round(diagnostic.elapsed * 100) / 100,
    memoryGrowthMb: metrics.memoryMb === null || diagnostic.startMemoryMb === null ? null : Math.round((metrics.memoryMb - diagnostic.startMemoryMb) * 100) / 100,
    mode: diagnostic.mode,
    pathfindingStalls: 'not-applicable-direct-steering',
    potentialStuckAgents: diagnostic.potentialStuckAgents,
  };
  diagnostic.complete = true;
}

if (diagnostic) {
  window.__GAME_DIAGNOSTICS__ = {
    getState: () => ({ complete: diagnostic.complete, elapsed: diagnostic.elapsed, mode: diagnostic.mode, report: diagnostic.report, target: diagnostic.target }),
  };
}

const debugEnabled = query.has('debug') || testMode;
const debugOverlay = debugEnabled ? document.body.appendChild(document.createElement('pre')) : null;
if (debugOverlay) debugOverlay.id = 'debug-overlay';
let debugTimer = 0;
function updateDebug(delta) {
  if (!debugOverlay) return;
  debugTimer -= delta;
  if (debugTimer > 0) return;
  debugTimer = .25;
  const memory = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : 'n/a';
  const position = camera.position.toArray().map((value) => value.toFixed(1)).join(', ');
  const states = Object.entries(Object.groupBy(enemies, (enemy) => enemy.type)).map(([type, list]) => `${type}:${list.length}`).join(' ');
  const particles = state.weatherParticles ? Math.min(state.weatherParticles.geometry.drawRange.count, state.weatherParticles.geometry.attributes.position.count) : 0;
  const diagnosticText = diagnostic ? `\nMode ${diagnostic.mode}\nElapsed ${diagnostic.elapsed.toFixed(1)}s\nTarget ${diagnostic.target}\nReport ${diagnostic.report ? JSON.stringify(diagnostic.report) : 'running'}` : '';
  debugOverlay.textContent = `FPS ${Math.round(1 / Math.max(delta, .001))}\nDraw calls ${renderer.info.render.calls}\nTriangles ${renderer.info.render.triangles}\nEnemies ${enemies.length}\nParticles ${particles}\nMemory ${memory}\nPlayer ${position}\nAI ${states || 'none'}${diagnosticText}`;
}

function simulate(delta) {
  if (state.phase !== 'playing' || (!controls.isLocked && !testMode)) return;
  updateTimers(delta);
  updateWorldFeatures(delta);
  updateAnimals(delta);
  updatePlayer(delta);
  updateEnemies(delta);
  updateObjective(delta);
  if (state.fireHeld && currentWeapon().automatic) fire();
}

let lastRenderAt = 0;
function animate(time) {
  if (state.settings.fpsLimit && time - lastRenderAt < 1000 / state.settings.fpsLimit) return;
  lastRenderAt = time;
  timer.update();
  const frameDelta = timer.getDelta();
  const delta = Math.min(frameDelta, .05);
  monitorPerformance(frameDelta);
  updateDiagnostic(frameDelta);
  updateDebug(delta);
  advanceSimulation(frameDelta, simulate);
  const danger = enemies.some(({ boss }) => boss) ? 'boss' : enemies.some(({ traits }) => traits.length) ? 'elite' : state.phase === 'playing' ? 'combat' : 'exploration';
  setMusicIntensity(state.phase === 'playing' ? Math.min(1, enemies.length / 15) : 0, danger);
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

$('#start').addEventListener('click', startGame);
$('#retry').addEventListener('click', startGame);
$('#victory-retry').addEventListener('click', startGame);
$('#restart').addEventListener('click', startGame);
$('#resume').addEventListener('click', () => { if (testMode) setPhase('playing'); else controls.lock(); });
$('#copy-seed').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.run.seed);
    $('#copy-seed').textContent = 'Seed Copied';
  } catch {
    $('#copy-seed').textContent = `Seed: ${state.run.seed}`;
  }
});

function applyGraphicsSettings() {
  const ultraAvailable = capabilities.profile === 'high' || capabilities.webgpu;
  if (state.settings.quality === 'ultra' && !ultraAvailable) {
    state.settings.quality = 'high';
    $('#setting-quality').value = 'high';
  }
  const activeProfile = state.settings.quality === 'auto' ? capabilities.profile : state.settings.quality;
  const profile = GRAPHICS_PROFILES[activeProfile];
  enemyLodDistance = Math.max(12, profile.enemyLodDistance - state.performanceLevel * 4);
  renderer.setPixelRatio(Math.min(devicePixelRatio * profile.resolutionScale * state.settings.resolutionScale / 100, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = profile.shadows && state.settings.shadows && state.performanceLevel < 2;
  renderer.toneMapping = state.settings.postProcessing ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  camera.far = state.performanceLevel >= 3 ? Math.min(70, profile.drawDistance) : profile.drawDistance;
  camera.updateProjectionMatrix();
  if (state.weatherParticles) {
    const adaptiveLimit = state.performanceLevel >= 1 ? 150 : profile.particles;
    state.weatherParticles.geometry.setDrawRange(0, Math.min(profile.particles * state.settings.particleScale / 100, adaptiveLimit, state.weatherParticles.geometry.attributes.position.count));
  }
  $('#quality-value').textContent = `${state.settings.quality.toUpperCase()} · ${activeProfile.toUpperCase()}`;
}

function applySettings() {
  state.settings = {
    colorblind: $('#setting-colorblind').checked,
    crosshair: $('#setting-crosshair').value,
    fov: Number($('#setting-fov').value),
    hitSize: Number($('#setting-hit-size').value),
    quality: $('#setting-quality').value,
    sensitivity: Number($('#setting-sensitivity').value),
    adsSensitivity: Number($('#setting-ads-sensitivity').value),
    toggleAds: $('#setting-toggle-ads').checked,
    toggleCrouch: $('#setting-toggle-crouch').checked,
    resolutionScale: Number($('#setting-resolution').value),
    shadows: $('#setting-shadows').checked,
    particleScale: Number($('#setting-particles').value),
    postProcessing: $('#setting-post').checked,
    fpsLimit: Number($('#setting-fps').value),
    masterVolume: Number($('#setting-master').value),
    musicVolume: Number($('#setting-music').value),
    sfxVolume: Number($('#setting-sfx').value),
    uiVolume: Number($('#setting-ui').value),
    reduceFlash: $('#setting-reduce-flash').checked,
    reduceShake: $('#setting-reduce-shake').checked,
    subtitles: $('#setting-subtitles').checked
  };
  controls.pointerSpeed = state.settings.sensitivity;
  setAudioSettings({ master: state.settings.masterVolume, music: state.settings.musicVolume, sfx: state.settings.sfxVolume, ui: state.settings.uiVolume });
  applyGraphicsSettings();
  document.body.classList.toggle('colorblind', state.settings.colorblind);
  document.body.classList.toggle('reduce-flash', state.settings.reduceFlash);
  $('#fov-value').textContent = state.settings.fov;
  $('#sensitivity-value').textContent = state.settings.sensitivity.toFixed(1);
  $('#ads-sensitivity-value').textContent = state.settings.adsSensitivity.toFixed(2);
  $('#resolution-value').textContent = `${state.settings.resolutionScale}%`;
  $('#particle-value').textContent = `${state.settings.particleScale}%`;
  hud.hit.style.setProperty('--hit-scale', state.settings.hitSize / 100);
  document.querySelectorAll('#crosshair i').forEach((line) => { line.style.background = state.settings.crosshair; });
  persistProgress();
}

for (const input of document.querySelectorAll('#settings-panel input, #settings-panel select')) input.addEventListener('input', applySettings);
$('#open-settings').addEventListener('click', () => openPanel('settings-panel'));
$('#menu-settings').addEventListener('click', () => openPanel('settings-panel'));
$('#close-settings').addEventListener('click', closePanel);
$('#open-controls').addEventListener('click', () => openPanel('controls-panel'));
$('#menu-controls').addEventListener('click', () => openPanel('controls-panel'));
$('#close-controls').addEventListener('click', closePanel);
$('#statistics').addEventListener('click', () => {
  const summary = summarizeProgress(progress);
  const labels = {
    playTime: 'Total Play Time', kills: 'Total Kills', deaths: 'Total Deaths', headshots: 'Headshots', accuracy: 'Accuracy',
    highestWave: 'Highest Wave', highestScore: 'Highest Score', favoriteWeapon: 'Favorite Weapon', mostUsedWeapon: 'Most Used Weapon',
    bossKills: 'Boss Kills', eliteKills: 'Elite Kills'
  };
  const list = $('#stats-list');
  list.replaceChildren();
  for (const [key, value] of Object.entries(summary)) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = labels[key];
    detail.textContent = value;
    row.append(term, detail);
    list.append(row);
  }
  const unlocked = ACHIEVEMENTS.filter(({ id }) => progress.achievements.includes(id)).map(({ name }) => name);
  $('#achievement-list').textContent = unlocked.length ? `Unlocked · ${unlocked.join(' · ')}` : '尚未解鎖成就';
  openPanel('statistics-panel');
});
$('#close-statistics').addEventListener('click', closePanel);
for (const [button, panel] of [['loadout', 'loadout-panel'], ['armory', 'armory-panel'], ['credits', 'credits-panel']]) {
  $(`#${button}`).addEventListener('click', () => openPanel(panel));
}
$('#challenges').addEventListener('click', () => {
  $('#challenge-detail').textContent = describeDaily(todayChallenge());
  openPanel('challenges-panel');
});
document.querySelectorAll('.close-menu-panel').forEach((button) => button.addEventListener('click', closePanel));
for (const button of document.querySelectorAll('.menu-button')) {
  button.addEventListener('click', () => {
    clearEnemies();
    clearObjective();
    setPhase('menu');
    controls.unlock();
  });
}

function applyPerk(upgrade) {
  if (upgrade === 'damage') state.damageLevel += 1;
  else if (upgrade === 'critical') state.criticalLevel += 1;
  else if (upgrade === 'fire-rate') state.fireRateLevel += 1;
  else if (upgrade === 'health') {
    state.maxHealth += 20;
    state.health = state.maxHealth;
  } else if (upgrade === 'armor') state.armor = Math.min(100, state.armor + 25);
  else if (upgrade === 'regeneration') state.regeneration += 1;
  else if (upgrade === 'movement') state.moveLevel += 1;
  else if (upgrade === 'double-jump') {
    state.doubleJump = 1;
    state.airJumps = 1;
  } else if (upgrade === 'sprint') state.sprintLevel += 1;
  else if (upgrade === 'reload') state.reloadLevel += 1;
  else if (upgrade === 'ammo') state.weapons.forEach((weaponState) => { weaponState.reserve = Math.round(weaponState.reserve * 1.3); });
  else if (upgrade === 'pickup') state.pickupLevel += 1;
  else if (upgrade === 'explosive-kill') state.explosiveLevel += 1;
  else if (upgrade === 'chain-lightning') state.chainLevel += 1;
  else if (upgrade === 'penetration') state.penetrationLevel += 1;
  else if (upgrade === 'lifesteal') state.lifesteal += 1;
  else return false;
  updateHud();
  return true;
}

for (const button of document.querySelectorAll('[data-upgrade]')) {
  button.addEventListener('click', () => {
    const upgrade = button.dataset.upgrade;
    if (!applyPerk(upgrade)) return;
    state.runStats.waveDamage = 0;
    state.wave += 1;
    spawnWave();
    setPhase('playing');
    if (!testMode) controls.lock();
  });
}

controls.addEventListener('lock', () => {
  if (state.phase === 'paused') setPhase('playing');
});
controls.addEventListener('unlock', () => {
  state.fireHeld = false;
  state.ads = false;
  if (state.phase === 'playing') setPhase('paused');
});

document.addEventListener('keydown', (event) => {
  const panel = document.querySelector('.modal:not(.hidden)');
  if (panel && event.code === 'Tab') {
    const items = [...panel.querySelectorAll('button, input, select, summary, a[href]')].filter((item) => !item.disabled && item.getClientRects().length);
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    return;
  }
  if (event.code === 'Escape') {
    if (panel?.querySelector('#close-settings, #close-controls, #close-statistics, .close-menu-panel')) { event.preventDefault(); closePanel(); }
    else if (state.phase === 'playing') { setPhase('paused'); if (controls.isLocked) controls.unlock(); }
    return;
  }
  if (state.phase !== 'playing' || event.target.closest('input, select, textarea, button, [contenteditable="true"]')) return;
  keys.add(event.code);
  if (event.code === 'Space' && !event.repeat) {
    state.jumpRequested = true;
    event.preventDefault();
  }
  if ((event.code === 'ControlLeft' || event.code === 'ControlRight') && !event.repeat && state.settings.toggleCrouch) state.crouchToggled = !state.crouchToggled;
  if (event.code === 'KeyR') reload();
  if (event.code === 'KeyE' && !event.repeat) interactNearby();
  if (event.code === 'KeyF' && !event.repeat) inspectWeapon();
  if (event.code === 'KeyV' && !event.repeat) melee();
  if (event.code.startsWith('Digit') && !event.repeat) switchWeapon(Number(event.code.slice(-1)) - 1);
});
document.addEventListener('wheel', (event) => {
  if (state.phase !== 'playing' || !event.deltaY || event.ctrlKey) return;
  event.preventDefault();
  const slots = state.loadout.map((weapon, slot) => ({ weapon, slot })).filter(({ weapon }) => state.chaosModifier !== 'shotgun-only' || WEAPONS[weapon].category === 'SHOTGUN');
  const next = (slots.findIndex(({ slot }) => slot === state.weaponIndex) + Math.sign(event.deltaY) + slots.length) % slots.length;
  if (slots[next]) switchWeapon(slots[next].slot);
}, { passive: false });
document.addEventListener('keyup', (event) => keys.delete(event.code));
document.addEventListener('mousedown', (event) => {
  if (state.phase !== 'playing' || !controls.isLocked && !testMode) return;
  if (event.button === 0) {
    state.fireHeld = true;
    fire();
  }
  if (event.button === 2) state.ads = state.settings.toggleAds ? !state.ads : true;
});
document.addEventListener('mouseup', (event) => {
  if (event.button === 0) state.fireHeld = false;
  if (event.button === 2 && !state.settings.toggleAds) state.ads = false;
});
document.addEventListener('contextmenu', (event) => { if (state.phase === 'playing') event.preventDefault(); });
window.addEventListener('blur', () => {
  keys.clear();
  state.jumpRequested = false;
  state.fireHeld = false;
  state.ads = false;
  if (state.phase === 'playing') {
    setPhase('paused');
    controls.unlock();
  }
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

for (const [id, label] of Object.entries(ENEMY_TYPES)) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = label.label;
  $('#custom-enemy-type').append(option);
}
WEAPONS.forEach((weapon, index) => {
  const option = document.createElement('option');
  option.value = index;
  option.textContent = weapon.name;
  $('#custom-weapon').append(option);
});
for (let slot = 0; slot < 5; slot += 1) {
  const label = document.createElement('label');
  label.textContent = `Slot ${slot + 1} · 按鍵 ${slot + 1}`;
  const select = document.createElement('select');
  for (const [index, weapon] of WEAPONS.entries()) select.add(new Option(`${weapon.category} · ${weapon.name}`, String(index), false, weapon.id === preferredLoadout[slot]));
  select.addEventListener('change', saveLoadout);
  label.append(select);
  $('#loadout-slots').append(label);
}
function saveLoadout() {
  preferredLoadout = [...document.querySelectorAll('#loadout-slots select')].map((select) => WEAPONS[Number(select.value)].id);
  persistProgress();
  updateLoadoutSummary();
}

function updateLoadoutSummary() {
  $('#loadout-summary').textContent = preferredLoadout.map((id, slot) => `${slot + 1} · ${WEAPONS.find((weapon) => weapon.id === id).name}`).join(' / ');
}
updateLoadoutSummary();

for (const category of [...new Set(WEAPONS.map(({ category }) => category)), 'ATTACHMENT']) $('#armory-category').add(new Option(category, category));
for (const [index, weapon] of WEAPONS.entries()) {
  const card = document.createElement('article');
  card.dataset.category = weapon.category;
  const icon = document.createElement('span');
  const title = document.createElement('strong');
  const detail = document.createElement('small');
  icon.className = 'weapon-icon';
  icon.style.setProperty('--weapon-color', `#${weapon.color.toString(16).padStart(6, '0')}`);
  title.textContent = weapon.name;
  detail.textContent = `${weapon.category} · DMG ${weapon.damage}${weapon.pellets ? ` × ${weapon.pellets}` : ''} · RPM ${weapon.rate} · ${weapon.overheat ? 'HEAT' : `MAG ${weapon.magazine}`} · 射程 ${weapon.falloff}m`;
  const equip = document.createElement('button');
  equip.textContent = '裝備至所選欄位';
  equip.setAttribute('aria-label', `裝備 ${weapon.name}`);
  equip.dataset.weapon = weapon.id;
  equip.addEventListener('click', () => {
    const slot = Number($('#armory-slot').value);
    document.querySelectorAll('#loadout-slots select')[slot].value = String(index);
    saveLoadout();
    $('#armory-status').textContent = `${weapon.name} 已配置至欄位 ${slot + 1}，下一場一般行動生效。`;
  });
  card.append(icon, title, detail, equip);
  $('#armory-list').append(card);
}
for (const attachment of ATTACHMENTS) {
  const card = document.createElement('article');
  card.dataset.category = 'ATTACHMENT';
  const title = document.createElement('strong');
  const detail = document.createElement('small');
  title.textContent = attachment.name;
  detail.textContent = `ATTACHMENT · ${attachment.slot.toUpperCase()} · 局內補給取得`;
  card.append(title, detail);
  $('#armory-list').append(card);
}
for (const modifier of CHAOS_MODIFIERS) {
  const option = document.createElement('option');
  option.value = modifier.id;
  option.textContent = modifier.label;
  $('#custom-modifier').append(option);
}

function todayChallenge() {
  const now = new Date();
  return createDailyChallenge(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
}

function describeDaily(daily) {
  return `${daily.date} · ${MAPS.find(({ id }) => id === daily.map).name} · ${WEAPONS[daily.weapon].name} · ${CHAOS_MODIFIERS.find(({ id }) => id === daily.modifier).label} · 目標 ${daily.goal} 擊殺`;
}

let previousSetup = null;
const setupIds = ['seed', 'map', 'mode', 'difficulty', 'modifier-policy'];
function updateBriefing() {
  const mode = $('#mode').value;
  $('#briefing-mode').textContent = MODES[mode].label;
  $('#mode-description').textContent = pendingDaily ? `達成 ${pendingDaily.goal} 次擊殺，完成每日挑戰。` : mode === 'hunt' ? '完成 3 波獵殺，每波會加入精英敵人。' : MODES[mode].description;
  $('#briefing-map').textContent = MAPS.find(({ id }) => id === $('#map').value)?.name ?? '隨機戰區';
  $('#briefing-difficulty').textContent = $('#difficulty').selectedOptions[0].textContent;
  const policy = $('#modifier-policy').value;
  $('#briefing-modifier').textContent = pendingDaily ? CHAOS_MODIFIERS.find(({ id }) => id === pendingDaily.modifier).label : policy === 'random' ? '每局隨機規則' : policy === 'custom' && $('#custom-enabled').checked ? $('#custom-modifier').selectedOptions[0].textContent : '無額外規則';
  $('#run-kind').textContent = pendingDaily ? '每日挑戰' : $('#custom-enabled').checked ? '自訂行動' : '一般行動';
  $('#cancel-daily').classList.toggle('hidden', !pendingDaily);
  $('#daily-summary').textContent = pendingDaily ? describeDaily(pendingDaily) : '';
  $('#career-summary').textContent = `最高波次 ${progress.highestWave} · 最高分 ${progress.highestScore.toLocaleString()} · 成就 ${progress.achievements.length}/${ACHIEVEMENTS.length}`;
}

$('#daily').addEventListener('click', () => {
  if (!pendingDaily) previousSetup = { values: setupIds.map((id) => $(`#${id}`).value), custom: $('#custom-enabled').checked };
  pendingDaily = todayChallenge();
  $('#seed').value = pendingDaily.seed;
  $('#map').value = pendingDaily.map;
  $('#mode').value = 'survival';
  $('#difficulty').value = 'normal';
  $('#custom-enabled').checked = false;
  updateBriefing();
});
$('#accept-daily').addEventListener('click', () => { closePanel(); $('#daily').click(); $('#start').focus(); });
$('#cancel-daily').addEventListener('click', () => {
  if (previousSetup) {
    setupIds.forEach((id, index) => { $(`#${id}`).value = previousSetup.values[index]; });
    $('#custom-enabled').checked = previousSetup.custom;
  }
  pendingDaily = null;
  previousSetup = null;
  updateBriefing();
  $('#daily').focus();
});
$('#random-seed').addEventListener('click', () => {
  $('#seed').value = crypto.randomUUID().slice(0, 8).toUpperCase();
  $('#seed').dispatchEvent(new Event('input', { bubbles: true }));
});
$('#modifier-policy').addEventListener('change', () => {
  if ($('#modifier-policy').value === 'custom') {
    $('#custom-enabled').checked = true;
    $('.custom-panel').open = true;
  }
});
for (const input of document.querySelectorAll('#menu input, #menu select')) {
  input.addEventListener(input.id === 'seed' ? 'input' : 'change', () => {
    pendingDaily = null;
    previousSetup = null;
    updateBriefing();
  });
}
for (const panel of document.querySelectorAll('.modal')) {
  const heading = panel.querySelector('h2');
  heading.id = `${panel.id}-title`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', heading.id);
}
function filterArmory() {
  const term = $('#armory-search').value.trim().toLocaleLowerCase();
  const cards = [...$('#armory-list').children];
  const category = $('#armory-category').value;
  for (const card of cards) card.classList.toggle('hidden', !card.textContent.toLocaleLowerCase().includes(term) || category !== 'all' && card.dataset.category !== category);
  const count = cards.filter((card) => !card.classList.contains('hidden')).length;
  $('#armory-count').textContent = `${count} / ${cards.length} 項裝備`;
  $('#armory-empty').classList.toggle('hidden', count !== 0);
}
$('#armory-search').addEventListener('input', filterArmory);
$('#armory-category').addEventListener('change', filterArmory);
filterArmory();

if (testMode) {
  window.__GAME_TEST__ = Object.freeze({
    spawnEnemy(type = 'grunt') {
      if (!ENEMY_TYPES[type]) return null;
      const enemy = spawnEnemy(type, enemies.length);
      updateHud();
      return enemy.id;
    },
    spawnBoss(type = 'juggernaut') {
      const boss = BOSSES.find(({ id }) => id === type);
      if (!boss) return null;
      const enemy = spawnEnemy(boss.enemy, enemies.length, { boss: true, bossType: boss.id });
      updateHud();
      return enemy.id;
    },
    killEnemy(id) {
      const enemy = enemies.find((candidate) => candidate.id === Number(id));
      if (!enemy) return false;
      damageEnemy(enemy, Infinity, false);
      return true;
    },
    setPlayerHP(value = 100) {
      const health = THREE.MathUtils.clamp(Number(value), 0, 10000);
      if (!Number.isFinite(health)) return false;
      state.maxHealth = Math.max(state.maxHealth, health);
      state.health = health;
      updateHud();
      if (health === 0) finishRun(false);
      return true;
    },
    hurtPlayer(amount = 10, x = camera.position.x, z = camera.position.z - 4) {
      damagePlayer(Number(amount) || 0, new THREE.Vector3(Number(x) || 0, camera.position.y, Number(z) || 0));
    },
    setWeapon(value = 0) {
      const index = Number.isInteger(Number(value)) ? Number(value) : WEAPONS.findIndex(({ name }) => name.toLowerCase() === String(value).toLowerCase());
      if (!WEAPONS[index]) return false;
      state.loadout[state.weaponIndex] = index;
      state.weapons[state.weaponIndex] = { ammo: WEAPONS[index].magazine, reserve: WEAPONS[index].reserve, heat: 0 };
      switchWeapon(state.weaponIndex, true);
      return true;
    },
    unlockWeapon(value) { return this.setWeapon(value); },
    setWave(value = 1) { state.wave = THREE.MathUtils.clamp(Math.round(Number(value) || 1), 1, 999); updateHud(); },
    setMap(value) {
      if (!MAPS.some(({ id }) => id === value)) return false;
      state.run.map = value;
      buildMap(state.run);
      updateHud();
      return true;
    },
    setWeather(value) {
      if (!WEATHER[value]) return false;
      state.run.weather = value;
      buildMap(state.run);
      updateHud();
      return true;
    },
    setTime(value) {
      if (!['dawn', 'day', 'sunset', 'night'].includes(value)) return false;
      applyTime(value);
      syncFlashlight();
      updateHud();
      return true;
    },
    setModifier(value = null) {
      if (value && !CHAOS_MODIFIERS.some(({ id }) => id === value)) return false;
      state.chaosModifier = value;
      return true;
    },
    getLootBoxes: () => state.lootBoxes.map(({ key, opened, quality, mesh }) => ({ key, opened, quality, position: mesh.position.toArray() })),
    getInteractions: () => state.interactables.map(({ key, label, used, mesh }) => ({ key, label, used, position: mesh.position.toArray() })),
    getAnimals: () => animals.map(({ type, state: animalState, group }) => ({ type, state: animalState, position: group.position.toArray() })),
    emitNoise(type = 'gunshot', radius = 20) { emitPlayerNoise(Number(radius) || 0, String(type)); },
    interact: interactNearby,
    getAttachments: () => [...state.attachments],
    grantAttachment(id) {
      if (!ATTACHMENTS.some((attachment) => attachment.id === id) || state.attachments.includes(id)) return false;
      state.attachments.push(id);
      syncFlashlight();
      return true;
    },
    applyPerk,
    getWeaponModel: () => ({
      id: weaponModel.group.name,
      uuid: weaponModel.group.uuid,
      cacheSize: weaponModels.size,
      magazineY: weaponModel.magazine.position.y,
      boltZ: weaponModel.bolt.position.z,
      muzzle: weaponModel.muzzle.getWorldPosition(new THREE.Vector3()).toArray(),
      attachments: ATTACHMENTS.filter(({ id }) => weaponModel.group.getObjectByName(id)?.visible).map(({ id }) => id),
      tracerStarts: shotEffects.group.children.filter((object) => object.isLine && object.visible).map((object) => [...object.geometry.attributes.position.array.slice(0, 3)]),
      geometries: renderer.info.memory.geometries,
    }),
    getRenderState: () => ({ background: scene.background.getHexString(), toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, pixelRatio: renderer.getPixelRatio(), sun: sun.intensity, flashlight: flashlight.intensity }),
    readCenterPixel() {
      renderer.render(scene, camera);
      const pixel = new Uint8Array(4);
      const context = renderer.getContext();
      context.readPixels(Math.floor(context.drawingBufferWidth / 2), Math.floor(context.drawingBufferHeight / 2), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      return [...pixel];
    },
    openLoot: openNearbyLoot,
    startMission(type) { return beginMission(type); },
    fire: () => fire(true),
    melee,
    inspectWeapon,
    reload,
    ads(value = true) { state.ads = Boolean(value); },
    teleportPlayer(x = 0, z = 0, yaw = camera.rotation.y) {
      state.playerY = 0;
      state.verticalVelocity = 0;
      state.vault = null;
      state.grounded = true;
      camera.position.set(THREE.MathUtils.clamp(Number(x) || 0, -37, 37), STAND_HEIGHT, THREE.MathUtils.clamp(Number(z) || 0, -37, 37));
      camera.rotation.set(0, Number(yaw) || 0, 0);
    },
    getEnemies: () => enemies.map(({ id, type, health, traits, bossType, bossSignature, weakPoint, lowMesh, phase, armorBroken, telegraphTimer, combatState, personality, coverPoint, memoryTimer, seesPlayer, heardNoise, squadId, squadRole, squadCommand, lastKnownPlayerPosition, group }) => ({ id, type, health, traits: [...traits], bossType, hasBossSignature: Boolean(bossSignature), signatureVisible: Boolean(bossSignature?.visible), weakPointVisible: Boolean(weakPoint?.visible), lowDetail: lowMesh.visible, phase, armorBroken, telegraphing: telegraphTimer > 0, combatState, personality, coverPoint: coverPoint?.id ?? null, memoryTimer, seesPlayer, heardNoise, squadId, squadRole, squadCommand, lastKnownPlayerPosition: lastKnownPlayerPosition.toArray(), position: group.position.toArray() })),
    damageEnemy(id, amount = 1) {
      const enemy = enemies.find((candidate) => candidate.id === Number(id));
      if (!enemy) return false;
      damageEnemy(enemy, Math.max(0, Number(amount) || 0), false);
      return true;
    },
    setEnemyPosition(id, x = 0, z = 0) {
      const enemy = enemies.find((candidate) => candidate.id === Number(id));
      if (!enemy) return false;
      enemy.group.position.set(Number(x) || 0, enemy.config.flying ? 3 : 0, Number(z) || 0);
      enemy.group.updateMatrixWorld(true);
      return true;
    },
    triggerArenaShift,
    getPlayer: () => ({ health: state.health, maxHealth: state.maxHealth, position: camera.position.toArray(), weapon: currentWeapon().name, weaponQuality: currentWeapon().quality, ammo: currentWeapon().ammo, reserve: currentWeapon().reserve, reloading: state.reloading, ads: state.ads, crouching: state.crouching, grounded: state.grounded, vaulting: Boolean(state.vault), verticalVelocity: state.verticalVelocity }),
    getGameState: () => ({ phase: state.phase, mode: state.mode, wave: state.wave, score: state.score, run: { ...state.run }, modifier: state.chaosModifier, recoilShot: state.recoilShot, effects: shotEffects.activeCount(), effectCapacity: shotEffects.capacity, comboKills: state.comboKills, environmentKills: state.runStats.environmentKills, mission: state.mission ? { ...state.mission } : null, arenaShifted: state.worldFeatures?.arenaShifted ?? false, boltCycling: state.boltTimer > 0 })
  });
}

if (testMode) state.settings = { ...state.settings, quality: 'low', shadows: false, postProcessing: false };
resetWeapons();
syncWeaponModel();
$('#setting-quality').querySelector('[value="ultra"]').disabled = capabilities.profile !== 'high' && !capabilities.webgpu;
$('#setting-fov').value = state.settings.fov;
$('#setting-sensitivity').value = state.settings.sensitivity;
$('#setting-ads-sensitivity').value = state.settings.adsSensitivity;
$('#setting-toggle-ads').checked = state.settings.toggleAds;
$('#setting-toggle-crouch').checked = state.settings.toggleCrouch;
$('#setting-resolution').value = state.settings.resolutionScale;
$('#setting-shadows').checked = state.settings.shadows;
$('#setting-particles').value = state.settings.particleScale;
$('#setting-post').checked = state.settings.postProcessing;
$('#setting-fps').value = state.settings.fpsLimit;
$('#setting-master').value = state.settings.masterVolume;
$('#setting-music').value = state.settings.musicVolume;
$('#setting-sfx').value = state.settings.sfxVolume;
$('#setting-ui').value = state.settings.uiVolume;
$('#setting-hit-size').value = state.settings.hitSize;
$('#setting-quality').value = state.settings.quality;
$('#setting-crosshair').value = state.settings.crosshair;
$('#setting-colorblind').checked = state.settings.colorblind;
$('#setting-reduce-flash').checked = state.settings.reduceFlash;
$('#setting-reduce-shake').checked = state.settings.reduceShake;
$('#setting-subtitles').checked = state.settings.subtitles;
applySettings();
$('#seed').value = Date.now().toString(36).toUpperCase();
updateBriefing();
if (diagnostic) startDiagnostic();
updateHud();
$('#release-version').textContent = `v${APP_VERSION}${BUILD_SHA ? ` · ${BUILD_SHA}` : ''}`;
async function finishLoading() {
  const stages = [[10, 'Core ready'], [30, 'Shaders ready'], [50, 'Loading Player Animations...'], [70, 'Starting Weapon ready'], [90, `Loading ${MAPS.find(({ id }) => id === state.run.map).name}...`], [100, 'Preparing Combat...']];
  for (const [progressValue, label] of stages) {
    $('#loading-progress').value = progressValue;
    $('#loading-status').textContent = label;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  $('#loading-status').textContent = `Ready · ${capabilities.profile.toUpperCase()} · ${capabilities.webgpu ? 'WebGPU' : capabilities.webgl2 ? 'WebGL 2' : 'WebGL'}`;
  loadingScreen.classList.add('hidden');
  window.removeEventListener('error', showCoreLoadError);
  window.removeEventListener('unhandledrejection', showCoreLoadError);
}
finishLoading();
