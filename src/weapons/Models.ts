import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeaponDefinition } from '../data/content-manifest.ts';

// Overall length, receiver width and magazine height preserve each weapon's silhouette.
const dimensions: Record<string, [number, number, number]> = {
  p9: [.55, .105, .17], 'heavy-revolver': [.68, .12, .15], 'machine-pistol': [.6, .11, .26],
  'smg-9': [.82, .13, .24], 'vector-smg': [.75, .17, .29], 'heavy-smg': [.9, .16, .22],
  'ar-4': [1.08, .14, .23], 'burst-rifle': [1.12, .15, .19], 'heavy-ar': [1.17, .175, .25],
  'tactical-rifle': [1.04, .135, .2], 'pump-shotgun': [1.2, .13, .1], 'auto-shotgun': [1.06, .18, .28],
  'bolt-sniper': [1.4, .13, .11], 'semi-auto-sniper': [1.35, .155, .19], dmr: [1.27, .14, .18],
  'battle-rifle': [1.19, .165, .23], lmg: [1.25, .21, .27], minigun: [1.18, .28, .3],
  railgun: [1.38, .2, .18], 'plasma-rifle': [1.02, .22, .22],
};

export function createWeaponModel(weapon: WeaponDefinition) {
  const group = new THREE.Group();
  group.name = weapon.id;
  const [length, width, magHeight] = dimensions[weapon.id] ?? [1.08, .14, .23];
  const pistol = weapon.category === 'PISTOL';
  const revolver = !!weapon.revolverReload;
  const minigun = weapon.id === 'minigun';
  const energy = weapon.category === 'EXPERIMENTAL';
  const front = (pistol ? .08 : .2) - length;
  const bodyLength = pistol ? .3 : .44;
  const bodyZ = pistol ? -.08 : -.18;
  const body = new THREE.MeshStandardMaterial({ color: weapon.color, roughness: .48, metalness: .65 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x252e32, roughness: .32, metalness: .85 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141a1c, roughness: .92, metalness: .05 });
  const glow = new THREE.MeshStandardMaterial({ color: energy ? weapon.color : 0x86cbd4, emissive: energy ? weapon.color : 0x287c88, emissiveIntensity: energy ? .65 : .25, roughness: .22, metalness: .35 });
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = [body, steel, rubber, glow];
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  geometries.add(boxGeometry);
  geometries.add(cylinderGeometry);

  function part(name: string, parent = group) {
    const object = new THREE.Group();
    object.name = name;
    parent.add(object);
    return object;
  }
  function box(parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, tilt = 0) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.rotation.x = tilt;
    parent.add(mesh);
    return mesh;
  }
  function tube(parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number, radius: number, depth: number) {
    const mesh = new THREE.Mesh(cylinderGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, depth, radius);
    mesh.rotation.x = Math.PI / 2;
    parent.add(mesh);
    return mesh;
  }
  const receiver = part('receiver');
  box(receiver, body, 0, 0, bodyZ, width, .14, bodyLength);
  box(receiver, steel, width / 2 + .002, .025, bodyZ, .006, .045, .11);
  box(receiver, rubber, 0, -.17, .015, width * .66, .24, .095, -.2);
  // Open trigger guard: three narrow bars rather than a solid block.
  box(receiver, steel, 0, -.17, -.11, .025, .025, .13);
  box(receiver, steel, 0, -.12, -.17, .025, .1, .025);
  box(receiver, steel, 0, -.105, -.1, .016, .065, .018, .25);
  if (!pistol) {
    box(receiver, rubber, 0, -.015, .115, width * .85, .19, .17);
    const foreEnd = Math.max(front + .08, -.59);
    box(receiver, steel, 0, .015, (foreEnd - .32) / 2, width * .85, .11, -.32 - foreEnd);
    for (let i = 0; i < 4; i++) box(receiver, rubber, 0, -.002, -.34 + (foreEnd + .36) * i / 3, width * .92, .12, .018);
  }
  box(receiver, steel, 0, .087, bodyZ - .03, width * .55, .025, bodyLength * .85);
  box(receiver, steel, 0, .115, bodyZ + bodyLength * .35, .065, .05, .025);
  box(receiver, steel, 0, .107, pistol ? front + .08 : Math.max(front + .09, -.55), .018, .045, .025);

  const bolt = part('bolt');
  if (pistol && !revolver) box(bolt, steel, 0, .055, -.085, width * .94, .065, .32);
  else {
    box(bolt, steel, width * .6, .025, bodyZ + .04, .055, .028, .09);
    if (weapon.boltCycle) tube(bolt, rubber, width * .9, -.005, bodyZ + .055, .027, .04);
  }
  const barrel = part('barrel');
  const barrelRear = pistol ? -.13 : -.4;
  if (minigun) {
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      tube(barrel, steel, Math.cos(angle) * .09, Math.sin(angle) * .09, (front + barrelRear) / 2, .027, barrelRear - front);
    }
    tube(barrel, body, 0, 0, front + .12, .135, .055);
    tube(barrel, steel, 0, 0, -.43, .14, .1);
  } else if (weapon.id === 'railgun') {
    for (const x of [-.075, .075]) {
      box(barrel, steel, x, .02, (front + barrelRear) / 2, .06, .1, barrelRear - front);
      box(barrel, glow, x, .075, (front + barrelRear) / 2, .025, .012, barrelRear - front - .05);
    }
  } else {
    tube(barrel, steel, 0, .025, (front + barrelRear) / 2, energy ? .065 : weapon.category === 'SHOTGUN' ? .037 : .022, barrelRear - front);
    tube(barrel, rubber, 0, .025, front + .003, energy ? .042 : .015, .007);
  }
  if (weapon.shellReload) {
    tube(receiver, steel, 0, -.05, -.67, .023, .47);
    box(bolt, rubber, 0, -.04, -.65, .11, .1, .23);
  }
  if (energy) {
    for (let i = 0; i < 4; i++) box(receiver, glow, width / 2 + .006, .015, -.07 - i * .065, .012, .065, .033);
    if (weapon.overheat) tube(barrel, body, 0, .025, front + .15, .095, .18);
  }

  const magazine = part('magazine');
  magazine.position.set(0, revolver ? .005 : -.12, revolver ? -.12 : pistol ? .015 : -.23);
  if (revolver) tube(magazine, steel, 0, 0, 0, .08, .13);
  else if (weapon.category === 'HEAVY' || weapon.id === 'heavy-smg') {
    tube(magazine, rubber, 0, -.08, 0, minigun ? .16 : .115, width + .03);
    box(magazine, body, 0, -.09, .03, width + .055, magHeight * .65, .1);
  } else {
    box(magazine, rubber, 0, -magHeight / 2, 0, width * .65, magHeight, .105, pistol ? -.2 : .12);
    box(magazine, steel, 0, -magHeight, 0, width * .76, .025, .12);
  }
  if (weapon.id === 'vector-smg') box(receiver, body, 0, -.12, -.15, width, .22, .16);
  if (weapon.category === 'SNIPER' || weapon.id === 'lmg') {
    for (const x of [-.07, .07]) box(receiver, steel, x, -.15, -.71, .022, .22, .025, -.3);
  }

  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, minigun ? 0 : .025, front);
  group.add(muzzle);
  const attachments = new Map<string, THREE.Group>();
  const sightIds = ['red-dot', 'holo', '2x', '4x', '8x'];
  for (const id of ['red-dot', 'holo', '2x', '4x', '8x', 'compensator', 'suppressor', 'long-barrel', 'fast-mag', 'extended-mag', 'vertical-grip', 'angled-grip', 'laser', 'flashlight']) {
    const attachment = part(id);
    attachments.set(id, attachment);
    if (sightIds.includes(id)) {
      box(attachment, steel, 0, .14, -.2, .055, .07, .11);
      if (id === 'red-dot' || id === 'holo') {
        box(attachment, steel, 0, .21, -.2, id === 'holo' ? .11 : .08, .09, .04);
        box(attachment, glow, 0, .21, -.176, id === 'holo' ? .08 : .055, .058, .005);
      } else {
        const size = id === '8x' ? .32 : id === '4x' ? .25 : .18;
        tube(attachment, steel, 0, .21, -.2, .048, size);
        tube(attachment, glow, 0, .21, -.2 + size / 2 + .001, .037, .006);
      }
    } else if (['compensator', 'suppressor', 'long-barrel'].includes(id)) {
      const extension = id === 'suppressor' ? .22 : id === 'long-barrel' ? .18 : .06;
      attachment.userData.extension = extension;
      tube(attachment, steel, 0, muzzle.position.y, front - extension / 2, id === 'suppressor' ? .045 : .03, extension);
      tube(attachment, rubber, 0, muzzle.position.y, front - extension + .002, .018, .005);
    } else if (id === 'flashlight' || id === 'laser') {
      tube(attachment, rubber, width / 2 + .045, -.01, -.35, id === 'flashlight' ? .035 : .018, .14);
      tube(attachment, glow, width / 2 + .045, -.01, -.423, id === 'flashlight' ? .028 : .01, .005);
    } else if (id === 'vertical-grip' || id === 'angled-grip') {
      box(attachment, rubber, 0, -.14, -.47, .05, .18, .055, id === 'angled-grip' ? -.6 : 0);
    } else {
      box(attachment, steel, 0, -magHeight - .02, 0, width * .8, id === 'extended-mag' ? .1 : .035, .13);
      magazine.add(attachment);
    }
    attachment.visible = weapon.category === 'SNIPER' && id === '4x';
  }
  // Bake only siblings: reload, bolt, rotary barrels and attachment visibility stay independent.
  group.traverse(object => {
    const meshes = object.children.filter(child => child instanceof THREE.Mesh) as THREE.Mesh[];
    for (const material of materials) {
      const matching = meshes.filter(mesh => mesh.material === material);
      if (!matching.length) continue;
      const inputs = matching.map(mesh => {
        mesh.updateMatrix();
        return mesh.geometry.clone().applyMatrix4(mesh.matrix);
      });
      const merged = mergeGeometries(inputs);
      inputs.forEach(geometry => geometry.dispose());
      if (!merged) throw new Error(`Cannot merge ${weapon.id} geometry`);
      geometries.add(merged);
      matching.forEach(mesh => object.remove(mesh));
      object.add(new THREE.Mesh(merged, material));
    }
  });
  const magazineRest = magazine.position.clone();
  let previousTime: number | undefined;
  let disposed = false;
  return {
    group, muzzle, magazine, bolt,
    setAttachments(ids: string[]) {
      let sightId = weapon.category === 'SNIPER' ? '4x' : '';
      let barrelId = '';
      for (const id of ids) {
        if (sightIds.includes(id)) sightId = id;
        if (attachments.get(id)?.userData.extension) barrelId = id;
      }
      for (const [id, attachment] of attachments) {
        attachment.visible = sightIds.includes(id) ? id === sightId : attachment.userData.extension ? id === barrelId : ids.includes(id);
      }
      muzzle.position.z = front - (barrelId ? attachments.get(barrelId)!.userData.extension : 0);
    },
    // reload/bolt are motion amplitudes; heat is normalized, time is seconds.
    update(input: { reload: number; bolt: number; heat: number; time: number }) {
      const reload = THREE.MathUtils.clamp(input.reload, 0, 1);
      const cycle = THREE.MathUtils.clamp(input.bolt, 0, 1);
      const heat = THREE.MathUtils.clamp(input.heat, 0, 1);
      magazine.position.copy(magazineRest);
      if (revolver) magazine.position.x -= reload * .14;
      else magazine.position.y -= reload * .25;
      magazine.rotation.z = revolver ? reload * Math.PI * 2 : reload * -.18;
      bolt.position.z = cycle * .085;
      bolt.rotation.z = weapon.boltCycle ? cycle * -.45 : 0;
      const delta = previousTime === undefined ? 0 : Math.max(0, input.time - previousTime);
      previousTime = input.time;
      if (minigun) barrel.rotation.z += delta * 28 * Math.max(cycle, heat);
      glow.emissiveIntensity = (energy ? .65 : .25) + heat * 2;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      group.removeFromParent();
    },
  };
}
