export function comboLabel(kills: number) {
  if (kills >= 10) return 'MASSACRE';
  if (kills >= 6) return 'RAMPAGE';
  if (kills >= 4) return 'MULTI KILL';
  if (kills === 3) return 'TRIPLE KILL';
  if (kills === 2) return 'DOUBLE KILL';
  return '';
}

export function scoreKill(base: number, { headshot = false, environment = false, distance = 0, airborne = false, combo = 1 } = {}) {
  const bonuses: string[] = [];
  let subtotal = base;
  if (headshot) { subtotal += 50; bonuses.push('HEADSHOT'); }
  if (environment) { subtotal += 100; bonuses.push('ENVIRONMENT'); }
  if (distance >= 30) { subtotal += 75; bonuses.push('LONGSHOT'); }
  if (distance > 0 && distance <= 3) { subtotal += 25; bonuses.push('CLOSE RANGE'); }
  if (airborne) { subtotal += 75; bonuses.push('AIR KILL'); }
  const multiplier = 1 + Math.min(4, Math.max(0, combo - 1)) * .25;
  return { total: Math.round(subtotal * multiplier), multiplier, bonuses, combo: comboLabel(combo) };
}
