export function memorySeconds(difficulty: string) {
  return difficulty === 'hard' ? 8 : difficulty === 'normal' ? 5 : 3;
}

export function canHear(distance: number, radius: number) {
  return distance <= radius;
}
