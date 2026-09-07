import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WEAPONS, ATTACHMENTS } from '../src/data/content-manifest.ts';
import { createWeaponModel } from '../src/weapons/Models.ts';

function visibleBounds(group) {
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  group.traverseVisible(object => {
    if (object.isMesh) bounds.union(new THREE.Box3().setFromObject(object));
  });
  return bounds;
}

test('all 20 weapons have finite geometry, distinct bounds and a muzzle at the barrel end', () => {
  assert.equal(WEAPONS.length, 20);
  const silhouettes = new Set();
  for (const weapon of WEAPONS) {
    const model = createWeaponModel(weapon);
    model.group.traverse(object => {
      if (object.isMesh) {
        for (const value of object.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value), weapon.id);
      }
    });
    const bounds = visibleBounds(model.group);
    assert.ok(bounds.max.z <= .251, weapon.id);
    assert.ok(Math.abs(bounds.min.z - model.muzzle.position.z) < .005, weapon.id);
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.z > .45 && size.z < 1.5, weapon.id);
    silhouettes.add(size.toArray().map(value => value.toFixed(3)).join(','));
    model.dispose();
  }
  assert.equal(silhouettes.size, 20);
});

test('attachments reuse objects, move the muzzle and restore the original muzzle', () => {
  for (const weapon of WEAPONS) {
    const model = createWeaponModel(weapon);
    const originalMuzzle = model.muzzle.position.z;
    const objects = [];
    model.group.traverse(object => objects.push(object));
    for (let iteration = 0; iteration < 3; iteration++) {
      for (const attachment of ATTACHMENTS) {
        model.setAttachments([attachment.id, attachment.id]);
        assert.equal(model.group.getObjectByName(attachment.id).visible, true);
      }
    }
    model.setAttachments(['suppressor', '8x', 'flashlight']);
    assert.ok(Math.abs(model.muzzle.position.z - originalMuzzle + .22) < 1e-10);
    assert.ok(Math.abs(visibleBounds(model.group).min.z - model.muzzle.position.z) < .005);
    const after = [];
    model.group.traverse(object => after.push(object));
    assert.deepEqual(after, objects);
    model.setAttachments([]);
    assert.equal(model.muzzle.position.z, originalMuzzle);
    for (const attachment of ATTACHMENTS) assert.equal(model.group.getObjectByName(attachment.id).visible, weapon.category === 'SNIPER' && attachment.id === '4x');
    model.dispose();
  }
});

test('the latest sight and barrel replace earlier attachments while snipers keep a default scope', () => {
  for (const weapon of WEAPONS) {
    const model = createWeaponModel(weapon);
    const baseMuzzle = model.muzzle.position.z;
    assert.equal(model.group.getObjectByName('4x').visible, weapon.category === 'SNIPER');
    model.setAttachments(['4x', 'red-dot', 'holo', 'compensator', 'suppressor']);
    assert.equal(model.group.getObjectByName('4x').visible, false);
    assert.equal(model.group.getObjectByName('red-dot').visible, false);
    assert.equal(model.group.getObjectByName('holo').visible, true);
    assert.equal(model.group.getObjectByName('compensator').visible, false);
    assert.equal(model.group.getObjectByName('suppressor').visible, true);
    assert.ok(Math.abs(model.muzzle.position.z - baseMuzzle + .22) < 1e-10);
    model.setAttachments(['suppressor', 'long-barrel', '8x']);
    assert.equal(model.group.getObjectByName('holo').visible, false);
    assert.equal(model.group.getObjectByName('8x').visible, true);
    assert.equal(model.group.getObjectByName('suppressor').visible, false);
    assert.equal(model.group.getObjectByName('long-barrel').visible, true);
    assert.ok(Math.abs(model.muzzle.position.z - baseMuzzle + .18) < 1e-10);
    model.setAttachments([]);
    assert.equal(model.group.getObjectByName('4x').visible, weapon.category === 'SNIPER');
    assert.equal(model.group.getObjectByName('8x').visible, false);
    model.dispose();
  }
});

test('minigun accumulates forward rotation, holds on stop and resumes without resetting', () => {
  const model = createWeaponModel(WEAPONS.find(weapon => weapon.id === 'minigun'));
  const barrel = model.group.getObjectByName('barrel');
  const frame = (time, heat) => model.update({ reload: 0, bolt: 0, heat, time });
  frame(10, 1);
  frame(10.1, 1);
  const firingAngle = barrel.rotation.z;
  assert.ok(firingAngle > 0);
  frame(10.2, .1);
  assert.ok(barrel.rotation.z > firingAngle);
  const stoppedAngle = barrel.rotation.z;
  frame(10.3, 0);
  frame(11, 0);
  assert.equal(barrel.rotation.z, stoppedAngle);
  frame(11.1, .3);
  assert.ok(Math.abs(barrel.rotation.z - stoppedAngle - .84) < 1e-10);
  model.dispose();
});

test('reload, bolt and heat animations return to rest without creating resources', () => {
  for (const weapon of WEAPONS) {
    const model = createWeaponModel(weapon);
    const magazine = model.magazine.position.clone();
    model.update({ reload: .8, bolt: 1, heat: 1, time: 4 });
    assert.ok(model.magazine.position.distanceTo(magazine) > .1);
    assert.equal(model.bolt.position.z, .085);
    model.update({ reload: 0, bolt: 0, heat: 0, time: 5 });
    assert.deepEqual(model.magazine.position, magazine);
    assert.equal(Math.abs(model.magazine.rotation.z), 0);
    assert.equal(model.bolt.position.z, 0);
    assert.equal(Math.abs(model.bolt.rotation.z), 0);
    assert.equal(model.group.getObjectByName('barrel').rotation.z, 0);
    model.dispose();
  }
});

test('dispose releases each owned rendered geometry and material once, including hidden attachments', () => {
  const model = createWeaponModel(WEAPONS[0]);
  const resources = new Set();
  model.group.traverse(object => {
    if (object.isMesh) {
      resources.add(object.geometry);
      resources.add(object.material);
    }
  });
  const counts = new Map();
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  const parent = new THREE.Group();
  parent.add(model.group);
  model.dispose();
  model.dispose();
  assert.equal(model.group.parent, null);
  assert.equal(counts.size, resources.size);
  for (const count of counts.values()) assert.equal(count, 1);
});
