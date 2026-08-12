export function applyArmor(damage: number, durability: number, penetration = .2) {
  if (durability <= 0) return { damage, durability: 0, broken: false };
  const dealt = damage * (.35 + Math.max(0, Math.min(1, penetration)) * .65);
  const remaining = Math.max(0, durability - damage);
  return { damage: dealt, durability: remaining, broken: remaining === 0 };
}
