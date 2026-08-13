export const FACTIONS = ['Frontier Raiders', 'Helix Security', 'Null Automata', 'Rift Hunters'] as const;

export function factionFor(type: string) {
  if (['drone', 'heavy', 'shield'].includes(type)) return 'Null Automata';
  if (['hunter', 'berserker', 'sniper'].includes(type)) return 'Rift Hunters';
  if (['rifleman', 'medic', 'commander'].includes(type)) return 'Helix Security';
  return 'Frontier Raiders';
}

export function createVisualIdentity(type: string, random: () => number) {
  return {
    faction: factionFor(type),
    helmet: Math.floor(random() * 3),
    chest: Math.floor(random() * 3),
    shoulder: Math.floor(random() * 2),
    palette: Math.floor(random() * 3),
  };
}
