export const MISSION_DEFINITIONS = [
  { id: 'supply', label: 'SUPPLY DROP', event: 'loot', target: 1, duration: 30 },
  { id: 'elite', label: 'ELITE HUNT', event: 'elite', target: 1, duration: 45 },
  { id: 'hold', label: 'HOLD POSITION', event: 'hold', target: 15, duration: 30 },
  { id: 'no-damage', label: 'NO DAMAGE', event: 'survive', target: 30, duration: 30 },
  { id: 'headshot', label: 'HEADSHOT CHALLENGE', event: 'headshot', target: 5, duration: 45 },
  { id: 'weapon', label: 'WEAPON CHALLENGE', event: 'weapon', target: 5, duration: 45 },
] as const;

export function createMission(random: () => number, weapon: string, forcedId?: string) {
  const definition = MISSION_DEFINITIONS.find(({ id }) => id === forcedId) ?? MISSION_DEFINITIONS[Math.floor(random() * MISSION_DEFINITIONS.length)];
  return { ...definition, label: definition.id === 'weapon' ? `${definition.label} · ${weapon}` : definition.label, weapon, progress: 0, time: definition.duration, failed: false, complete: false };
}

export function progressMission(mission: ReturnType<typeof createMission>, event: string, amount = 1) {
  if (mission.complete || mission.failed) return mission;
  if (mission.id === 'no-damage' && event === 'damage') return { ...mission, failed: true };
  if (event !== mission.event) return mission;
  const progress = Math.min(mission.target, mission.progress + amount);
  return { ...mission, progress, complete: progress >= mission.target };
}
