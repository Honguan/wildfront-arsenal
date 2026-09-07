import * as THREE from 'three';

export function createShotEffects(tracerCapacity = 24, impactCapacity = 32, casingCapacity = 20, explosionCapacity = 6) {
  const group = new THREE.Group();
  const impactGeometry = new THREE.SphereGeometry(.045, 5, 4);
  const tracers = Array.from({ length: tracerCapacity }, () => {
    const position = new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry().setAttribute('position', position);
    const object = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffd889, transparent: true, opacity: 0, depthWrite: false }));
    object.visible = false;
    group.add(object);
    return { object, life: 0 };
  });
  const impacts = Array.from({ length: impactCapacity }, () => {
    const object = new THREE.Mesh(impactGeometry, new THREE.MeshBasicMaterial({ color: 0xffc45c, transparent: true, opacity: 0, depthWrite: false }));
    object.visible = false;
    group.add(object);
    return { object, life: 0 };
  });
  const casingGeometry = new THREE.CylinderGeometry(.018, .018, .08, 5);
  const casings = Array.from({ length: casingCapacity }, () => {
    const object = new THREE.Mesh(casingGeometry, new THREE.MeshBasicMaterial({ color: 0xc99c4c }));
    object.visible = false;
    group.add(object);
    return { object, life: 0, velocity: new THREE.Vector3() };
  });
  const explosionGeometry = new THREE.SphereGeometry(1, 12, 8);
  const explosions = Array.from({ length: explosionCapacity }, () => {
    const object = new THREE.Mesh(explosionGeometry, new THREE.MeshBasicMaterial({ color: 0xff7b2f, transparent: true, opacity: 0, depthWrite: false }));
    object.visible = false;
    group.add(object);
    return { object, life: 0 };
  });
  const fadingEffects = [...tracers, ...impacts];
  const allEffects = [...fadingEffects, ...casings, ...explosions];
  let tracerIndex = 0;
  let impactIndex = 0;
  let casingIndex = 0;
  let explosionIndex = 0;

  return {
    group,
    capacity: tracerCapacity + impactCapacity + casingCapacity + explosionCapacity,
    spawnTracer(start: THREE.Vector3, end: THREE.Vector3, color: number) {
      const effect = tracers[tracerIndex++ % tracers.length];
      const position = effect.object.geometry.getAttribute('position') as THREE.BufferAttribute;
      position.setXYZ(0, start.x, start.y, start.z);
      position.setXYZ(1, end.x, end.y, end.z);
      position.needsUpdate = true;
      effect.object.geometry.computeBoundingSphere();
      effect.object.material.color.setHex(color);
      effect.object.material.opacity = .85;
      effect.object.visible = true;
      effect.life = .07;
    },
    spawnImpact(point: THREE.Vector3, surface = 'concrete') {
      const effect = impacts[impactIndex++ % impacts.length];
      effect.object.position.copy(point);
      effect.object.material.color.setHex({ enemy: 0xff5e55, metal: 0xffd36b, wood: 0xb47a3c, glass: 0x83eaff, concrete: 0xb9aa91 }[surface] ?? 0xffc45c);
      effect.object.material.opacity = 1;
      effect.object.visible = true;
      effect.life = .13;
    },
    spawnCasing(origin: THREE.Vector3, direction?: THREE.Vector3) {
      const phase = casingIndex++;
      const effect = casings[phase % casings.length];
      effect.object.position.copy(origin);
      effect.object.rotation.set(phase, phase * .7, phase * .3);
      const speed = 1.2 + Math.sin(phase) * .35;
      if (direction) effect.velocity.copy(direction).normalize().multiplyScalar(speed);
      else effect.velocity.set(speed, 0, 0);
      effect.velocity.y += 1.45 + Math.cos(phase) * .25;
      effect.velocity.z += Math.sin(phase * 2) * .35;
      effect.object.visible = true;
      effect.life = .7;
    },
    spawnExplosion(point: THREE.Vector3) {
      const effect = explosions[explosionIndex++ % explosions.length];
      effect.object.position.copy(point);
      effect.object.scale.setScalar(.2);
      effect.object.material.opacity = .75;
      effect.object.visible = true;
      effect.life = .24;
    },
    update(delta: number) {
      for (const effect of fadingEffects) {
        if (!effect.object.visible) continue;
        effect.life -= delta;
        effect.object.material.opacity = Math.max(0, effect.life * 8);
        if (effect.life <= 0) effect.object.visible = false;
      }
      for (const effect of casings) {
        if (!effect.object.visible) continue;
        effect.life -= delta;
        effect.velocity.y -= 9.8 * delta;
        effect.object.position.addScaledVector(effect.velocity, delta);
        effect.object.rotation.x += delta * 10;
        if (effect.life <= 0) effect.object.visible = false;
      }
      for (const effect of explosions) {
        if (!effect.object.visible) continue;
        effect.life -= delta;
        effect.object.scale.addScalar(delta * 10);
        effect.object.material.opacity = Math.max(0, effect.life * 3);
        if (effect.life <= 0) effect.object.visible = false;
      }
    },
    clear() {
      for (const effect of allEffects) effect.object.visible = false;
    },
    activeCount() {
      let count = 0;
      for (const { object } of allEffects) if (object.visible) count += 1;
      return count;
    },
  };
}
