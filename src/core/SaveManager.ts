import { createProgress, summarizeProgress } from '../progress.js';

export const SAVE_KEY = 'wildfront-save';
export const SAVE_VERSION = 1;
const LEGACY_SAVE_KEY = 'wildfront-progress';

export interface GameSettings {
  colorblind: boolean;
  crosshair: string;
  fov: number;
  hitSize: number;
  quality: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  reduceFlash: boolean;
  reduceShake: boolean;
  sensitivity: number;
  adsSensitivity: number;
  toggleAds: boolean;
  toggleCrouch: boolean;
  resolutionScale: number;
  shadows: boolean;
  particleScale: number;
  postProcessing: boolean;
  fpsLimit: 0 | 30 | 60 | 120;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  uiVolume: number;
  subtitles: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface SaveData {
  version: typeof SAVE_VERSION;
  settings: GameSettings;
  progress: ReturnType<typeof createProgress>;
  statistics: ReturnType<typeof summarizeProgress>;
}

const DEFAULT_SETTINGS: GameSettings = {
  colorblind: false,
  crosshair: '#f5faed',
  fov: 72,
  hitSize: 100,
  quality: 'auto',
  reduceFlash: false,
  reduceShake: false,
  sensitivity: 1,
  adsSensitivity: .75,
  toggleAds: false,
  toggleCrouch: false,
  resolutionScale: 100,
  shadows: true,
  particleScale: 100,
  postProcessing: true,
  fpsLimit: 0,
  masterVolume: 80,
  musicVolume: 55,
  sfxVolume: 80,
  uiVolume: 70,
  subtitles: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberInRange(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function isQuality(value: unknown): value is GameSettings['quality'] {
  return typeof value === 'string' && ['auto', 'low', 'medium', 'high', 'ultra'].includes(value);
}

function normalizeSettings(value: unknown): GameSettings {
  const settings = isRecord(value) ? value : {};
  const quality = isQuality(settings.quality) ? settings.quality : DEFAULT_SETTINGS.quality;
  return {
    colorblind: typeof settings.colorblind === 'boolean' ? settings.colorblind : DEFAULT_SETTINGS.colorblind,
    crosshair: typeof settings.crosshair === 'string' && /^#[\da-f]{6}$/i.test(settings.crosshair) ? settings.crosshair : DEFAULT_SETTINGS.crosshair,
    fov: numberInRange(settings.fov, DEFAULT_SETTINGS.fov, 55, 100),
    hitSize: numberInRange(settings.hitSize, DEFAULT_SETTINGS.hitSize, 70, 160),
    quality,
    reduceFlash: typeof settings.reduceFlash === 'boolean' ? settings.reduceFlash : DEFAULT_SETTINGS.reduceFlash,
    reduceShake: typeof settings.reduceShake === 'boolean' ? settings.reduceShake : DEFAULT_SETTINGS.reduceShake,
    sensitivity: numberInRange(settings.sensitivity, DEFAULT_SETTINGS.sensitivity, .2, 2),
    adsSensitivity: numberInRange(settings.adsSensitivity, DEFAULT_SETTINGS.adsSensitivity, .2, 1),
    toggleAds: typeof settings.toggleAds === 'boolean' ? settings.toggleAds : DEFAULT_SETTINGS.toggleAds,
    toggleCrouch: typeof settings.toggleCrouch === 'boolean' ? settings.toggleCrouch : DEFAULT_SETTINGS.toggleCrouch,
    resolutionScale: numberInRange(settings.resolutionScale, DEFAULT_SETTINGS.resolutionScale, 50, 150),
    shadows: typeof settings.shadows === 'boolean' ? settings.shadows : DEFAULT_SETTINGS.shadows,
    particleScale: numberInRange(settings.particleScale, DEFAULT_SETTINGS.particleScale, 0, 100),
    postProcessing: typeof settings.postProcessing === 'boolean' ? settings.postProcessing : DEFAULT_SETTINGS.postProcessing,
    fpsLimit: [0, 30, 60, 120].includes(Number(settings.fpsLimit)) ? Number(settings.fpsLimit) as GameSettings['fpsLimit'] : DEFAULT_SETTINGS.fpsLimit,
    masterVolume: numberInRange(settings.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 100),
    musicVolume: numberInRange(settings.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 100),
    sfxVolume: numberInRange(settings.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 100),
    uiVolume: numberInRange(settings.uiVolume, DEFAULT_SETTINGS.uiVolume, 0, 100),
    subtitles: typeof settings.subtitles === 'boolean' ? settings.subtitles : DEFAULT_SETTINGS.subtitles,
  };
}

export function createSave(value: unknown = {}): SaveData {
  const source = isRecord(value) ? value : {};
  const savedProgress = source.version === SAVE_VERSION && isRecord(source.progress) ? source.progress : source;
  const progress = createProgress(savedProgress);
  return {
    version: SAVE_VERSION,
    settings: normalizeSettings(source.version === SAVE_VERSION ? source.settings : {}),
    progress,
    statistics: summarizeProgress(progress),
  };
}

export function loadSave(storage: StorageLike): SaveData {
  try {
    const current = storage.getItem(SAVE_KEY);
    if (current) return createSave(JSON.parse(current));
    const legacy = storage.getItem(LEGACY_SAVE_KEY);
    if (!legacy) return createSave();
    const migrated = createSave(JSON.parse(legacy));
    try {
      storage.setItem(SAVE_KEY, JSON.stringify(migrated));
      storage.removeItem(LEGACY_SAVE_KEY);
    } catch {
      return migrated;
    }
    return migrated;
  } catch {
    return createSave();
  }
}

export function saveGame(storage: StorageLike, progress: unknown, settings: unknown): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(createSave({ version: SAVE_VERSION, progress, settings })));
    return true;
  } catch {
    return false;
  }
}
