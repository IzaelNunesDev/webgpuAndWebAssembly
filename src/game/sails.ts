import * as THREE from 'three';
import { WIND } from './waves';

import { MeshStandardNodeMaterial } from 'three/webgpu';
import { positionLocal, time, sin, add, mul, sub, uv, vec3 } from 'three/tsl';

export function createRig(boat: THREE.Group) {
  const mast = new THREE.Group();
  mast.name = 'mast';
  mast.position.set(0, 0, -1.5);
  boat.add(mast);

  const woodMat = new MeshStandardNodeMaterial({ color: 0x3a2a1a, roughness: 0.8 });
  const ropeMat = new MeshStandardNodeMaterial({ color: 0x8a7050, roughness: 1.0 });

  // ── Wind Logic in TSL ──
  // Ripple speed
  const windSpeed = time.mul(3.0);

  // Creates a wave based on the X position of the vertex and time
  const windRipple = sin(positionLocal.x.mul(2.0).add(windSpeed)).mul(0.15);

  // UV Mask: The base of the sail (y=0) swings maximum, the top attached to the mast (y=1) swings zero.
  const windMask = sub(1.0, uv().y);
  const displacement = windRipple.mul(windMask);
  const newPosition = positionLocal.add(vec3(0, 0, displacement));

  // Applies the material with the displacement node
  const sailMatMain = new MeshStandardNodeMaterial({
    color: 0xe8e4d8, side: THREE.DoubleSide, roughness: 0.95,
    transparent: true, opacity: 0.97,
  });
  sailMatMain.positionNode = newPosition; // <-- MAGIC HAPPENS HERE

  const sailMatJib = new MeshStandardNodeMaterial({
    color: 0xd8d2c0, side: THREE.DoubleSide, roughness: 0.95,
    transparent: true, opacity: 0.97,
  });
  sailMatJib.positionNode = newPosition; // Applies to the smaller sail as well

  // Mastro principal
  const mastPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 11), woodMat);
  mastPole.position.y = 5.5;
  mast.add(mastPole);

  // Shrouds (cabos laterais de suporte)
  for (const side of [-1, 1] as const) {
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 9.8), ropeMat);
    shroud.position.set(side * 2.1, 0.8, 1.0);
    shroud.rotation.z = side * 0.22;
    shroud.rotation.x = -0.06;
    mast.add(shroud);
  }

  // Forestay (cabo dianteiro)
  const forestay = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 10.5), ropeMat);
  forestay.position.set(0, 0.8, 5.5);
  forestay.rotation.x = 0.52;
  mast.add(forestay);

  // ── VELA MAIOR ──
  const mainYard = new THREE.Group();
  mainYard.position.y = 2.0;
  mast.add(mainYard);

  // Verga superior (gaff)
  const gaff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 4.8), woodMat);
  gaff.rotation.z = Math.PI / 2;
  mainYard.add(gaff);

  const mainSail = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 6.5, 2, 10), sailMatMain);
  mainSail.name = 'mainSail';
  mainSail.position.y = -3.25;
  mainYard.add(mainSail);

  // Boom (verga inferior — fixo no mastro, não no yard)
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 4.8), woodMat);
  boom.rotation.z = Math.PI / 2;
  boom.position.y = 1.2;
  mast.add(boom);

  // ── VELA DE PROA (JIB) ──
  const jibYard = new THREE.Group();
  jibYard.position.set(0, 4.5, 5.5);
  mast.add(jibYard);

  const jibSail = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 4.5, 1, 8), sailMatJib);
  jibSail.name = 'jibSail';
  jibSail.position.y = -2.25;
  jibYard.add(jibSail);

  // Cabo do jib
  const jibstay = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 5.0), ropeMat);
  jibstay.position.set(0, -1.5, 0);
  jibstay.rotation.x = 0.35;
  jibYard.add(jibstay);

  return { mast, mainYard, mainSail, jibYard, jibSail, boom };
}

export function updateRig(rig: any, sailFactor: number, boat: THREE.Group) {
  const f = THREE.MathUtils.clamp(sailFactor, 0, 1);

  // Yard sobe conforme a vela é içada (sem scale para não achatar)
  rig.mainYard.position.y = 1.5 + f * 5.5;
  rig.jibYard.position.y = 1.2 + f * 3.8;

  // Vela pendurada em posição fixa abaixo do yard
  rig.mainSail.position.y = -3.25;
  rig.jibSail.position.y = -2.25;

  rig.mainSail.visible = f > 0.02;
  rig.jibSail.visible = f > 0.02;

  // Inflação pelo vento
  const windAngle = Math.atan2(WIND.z, WIND.x) - boat.rotation.y;
  const belly = Math.sin(windAngle) * 0.28 * f;
  rig.mainSail.rotation.y = belly;
  rig.jibSail.rotation.y = belly * 1.15;

  // Boom levemente inclinado pelo vento
  if (rig.boom) rig.boom.rotation.y = belly * 0.4;
}
