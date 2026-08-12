export function bossPhase(health: number, maximum: number) {
  const ratio = maximum > 0 ? health / maximum : 0;
  if (ratio <= .1) return 4;
  if (ratio <= .4) return 3;
  if (ratio <= .7) return 2;
  return 1;
}
