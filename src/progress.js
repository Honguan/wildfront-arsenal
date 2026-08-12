export const ACHIEVEMENTS = [
  { id: 'first-blood', name: 'First Blood', test: (stats) => stats.kills >= 1 },
  { id: 'sharpshooter', name: 'Sharpshooter', test: (stats) => stats.headshots >= 100 },
  { id: 'survivor', name: 'Survivor', test: (stats) => stats.highestWave >= 20 },
  { id: 'untouchable', name: 'Untouchable', test: (stats) => stats.untouchedWaves >= 1 },
  { id: 'arsenal-master', name: 'Arsenal Master', test: (stats) => Object.keys(stats.weaponKills).length >= 20 },
  { id: 'boss-hunter', name: 'Boss Hunter', test: (stats) => Object.keys(stats.bossTypes).length >= 5 }
];

export function createProgress(saved = {}) {
  const progress = {
    playTime: 0,
    kills: 0,
    deaths: 0,
    shots: 0,
    hits: 0,
    headshots: 0,
    highestWave: 0,
    highestScore: 0,
    bossKills: 0,
    eliteKills: 0,
    untouchedWaves: 0,
    weaponShots: {},
    weaponKills: {},
    bossTypes: {},
    achievements: []
  };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return progress;
  for (const key of ['playTime', 'kills', 'deaths', 'shots', 'hits', 'headshots', 'highestWave', 'highestScore', 'bossKills', 'eliteKills', 'untouchedWaves']) {
    if (Number.isFinite(saved[key]) && saved[key] >= 0) progress[key] = saved[key];
  }
  for (const key of ['weaponShots', 'weaponKills', 'bossTypes']) {
    if (saved[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key])) {
      progress[key] = Object.fromEntries(Object.entries(saved[key]).filter(([, count]) => Number.isFinite(count) && count >= 0));
    }
  }
  if (Array.isArray(saved.achievements)) progress.achievements = saved.achievements.filter((id) => typeof id === 'string');
  return progress;
}

export function recordRun(progress, run) {
  const next = createProgress(progress);
  for (const key of ['playTime', 'kills', 'deaths', 'shots', 'hits', 'headshots', 'bossKills', 'eliteKills', 'untouchedWaves']) next[key] += run[key] ?? 0;
  next.highestWave = Math.max(next.highestWave, run.wave ?? 0);
  next.highestScore = Math.max(next.highestScore, run.score ?? 0);
  for (const key of ['weaponShots', 'weaponKills', 'bossTypes']) {
    for (const [weapon, count] of Object.entries(run[key] ?? {})) next[key][weapon] = (next[key][weapon] ?? 0) + count;
  }
  next.achievements = ACHIEVEMENTS.filter(({ test }) => test(next)).map(({ id }) => id);
  return next;
}

export function summarizeProgress(stats) {
  const top = (values) => Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  return {
    playTime: `${Math.floor(stats.playTime / 3600)}h ${Math.floor(stats.playTime % 3600 / 60)}m`,
    kills: stats.kills,
    deaths: stats.deaths,
    headshots: stats.headshots,
    accuracy: stats.shots ? `${Math.round(stats.hits / stats.shots * 100)}%` : '0%',
    highestWave: stats.highestWave,
    highestScore: stats.highestScore,
    favoriteWeapon: top(stats.weaponKills),
    mostUsedWeapon: top(stats.weaponShots),
    bossKills: stats.bossKills,
    eliteKills: stats.eliteKills
  };
}
