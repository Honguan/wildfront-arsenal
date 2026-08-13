import { circleIntersectsRectangle } from '../rules.js';

export interface VaultCollisionBox {
  maxX: number;
  maxY: number;
  maxZ: number;
  minX: number;
  minY: number;
  minZ: number;
}

export interface VaultTarget {
  apex: number;
  x: number;
  z: number;
}

export function findVaultTarget(
  position: { x: number; z: number },
  direction: { x: number; z: number },
  boxes: VaultCollisionBox[],
  radius = .42,
): VaultTarget | null {
  const length = Math.hypot(direction.x, direction.z);
  if (!length) return null;
  const xDirection = direction.x / length;
  const zDirection = direction.z / length;
  const blockedBy = (box: VaultCollisionBox, distance: number) => circleIntersectsRectangle(
    position.x + xDirection * distance,
    position.z + zDirection * distance,
    radius,
    box.minX,
    box.maxX,
    box.minZ,
    box.maxZ,
  );

  let obstacle: VaultCollisionBox | undefined;
  let hitDistance = 0;
  for (let distance = .35; distance <= 1.6; distance += .1) {
    const blockers = boxes.filter((box) => blockedBy(box, distance));
    if (!blockers.length) continue;
    if (blockers.length > 1) return null;
    [obstacle] = blockers;
    hitDistance = distance;
    break;
  }
  if (!obstacle || obstacle.minY > .2 || obstacle.maxY > 1.25 || obstacle.maxY < .3) return null;

  let crossedObstacle = false;
  for (let distance = hitDistance; distance <= 3; distance += .1) {
    const blockers = boxes.filter((box) => blockedBy(box, distance));
    if (blockers.some((box) => box !== obstacle)) return null;
    if (blockers.includes(obstacle)) {
      crossedObstacle = true;
      continue;
    }
    if (!crossedObstacle) continue;
    const landingDistance = distance + .15;
    if (boxes.some((box) => blockedBy(box, landingDistance))) return null;
    return {
      apex: obstacle.maxY + .3,
      x: position.x + xDirection * landingDistance,
      z: position.z + zDirection * landingDistance,
    };
  }
  return null;
}
