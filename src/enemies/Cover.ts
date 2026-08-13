export interface CoverPoint {
  id: number;
  x: number;
  z: number;
  normalX: number;
  normalZ: number;
  height: number;
  leftPeek: boolean;
  rightPeek: boolean;
  danger: number;
  occupancy: number | null;
}

export function coverPointsForBox(box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }, firstId = 0) {
  const inset = .22;
  const offset = .65;
  const height = box.max.y - box.min.y;
  const sides = [
    [box.min.x + inset, box.min.z - offset, 0, -1], [box.max.x - inset, box.min.z - offset, 0, -1],
    [box.min.x + inset, box.max.z + offset, 0, 1], [box.max.x - inset, box.max.z + offset, 0, 1],
    [box.min.x - offset, box.min.z + inset, -1, 0], [box.min.x - offset, box.max.z - inset, -1, 0],
    [box.max.x + offset, box.min.z + inset, 1, 0], [box.max.x + offset, box.max.z - inset, 1, 0],
  ];
  return sides.map(([x, z, normalX, normalZ], index): CoverPoint => ({ id: firstId + index, x, z, normalX, normalZ, height, leftPeek: index % 2 === 0, rightPeek: index % 2 === 1, danger: 0, occupancy: null }));
}

export function chooseCover(points: CoverPoint[], agent: { x: number; z: number }, threat: { x: number; z: number }) {
  let best: CoverPoint | null = null;
  let bestScore = -Infinity;
  for (const point of points) {
    if (point.occupancy !== null || point.height < .7) continue;
    const distance = Math.hypot(point.x - agent.x, point.z - agent.z);
    if (distance > 18) continue;
    const threatX = threat.x - point.x;
    const threatZ = threat.z - point.z;
    const threatLength = Math.hypot(threatX, threatZ) || 1;
    const protection = -(point.normalX * threatX + point.normalZ * threatZ) / threatLength;
    const score = protection * 8 + Math.min(point.height, 2) * 2 - distance * .35 - point.danger * 3;
    if (score > bestScore) [best, bestScore] = [point, score];
  }
  return best;
}
