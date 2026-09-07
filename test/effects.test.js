import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createShotEffects } from '../src/effects/ShotEffects.ts';

test('reused tracers remain inside their updated bounds and camera frustum', () => {
  const effects = createShotEffects(1, 1, 1, 1);
  const line = effects.group.children.find((object) => object.isLine);
  const position = line.geometry.getAttribute('position');
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.x = 1000;
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );

  effects.spawnTracer(new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, 0, -10), 0xffffff);
  assert.equal(frustum.intersectsObject(line), false);
  const sphere = line.geometry.boundingSphere;
  effects.update(.1);
  assert.equal(effects.activeCount(), 0);

  for (const x of [1000, 1001]) {
    const start = new THREE.Vector3(x, 0, -5);
    const end = new THREE.Vector3(x, 0, -10);
    effects.spawnTracer(start, end, 0xffffff);
    assert.equal(line.geometry.getAttribute('position'), position);
    assert.equal(line.geometry.boundingSphere, sphere);
    assert.ok(sphere.containsPoint(start));
    assert.ok(sphere.containsPoint(end));
    assert.ok(frustum.intersectsObject(line));
    assert.equal(effects.activeCount(), 1);
    effects.clear();
    assert.equal(effects.activeCount(), 0);
  }
});

test('casing ejection follows the supplied world direction and preserves the default', () => {
  const origin = new THREE.Vector3(3, 4, 5);
  for (const direction of [undefined, new THREE.Vector3(0, 0, 2), new THREE.Vector3(-1, 0, 0)]) {
    const effects = createShotEffects(1, 1, 1, 1);
    const originalDirection = direction?.clone();
    effects.spawnCasing(origin, direction);
    const casing = effects.group.children.find((object) => object.visible);
    effects.update(.1);
    const displacement = casing.position.clone().sub(origin);
    const expected = (direction?.clone().normalize() ?? new THREE.Vector3(1, 0, 0)).multiplyScalar(.12);
    expected.y += (1.7 - .98) * .1;
    assert.ok(displacement.distanceTo(expected) < 1e-12);
    assert.deepEqual(direction, originalDirection);
    effects.clear();
    effects.spawnCasing(origin, direction);
    assert.equal(effects.group.children.find((object) => object.visible), casing);
    effects.update(.8);
    assert.equal(effects.activeCount(), 0);
  }
});
