import * as THREE from 'three';
import { WIND } from './waves';

export function createRig(boat: THREE.Group) {
  const mast = new THREE.Group();
  mast.name = 'mast';
  mast.position.set(0, 0, -1.5);
  boat.add(mast);

  const mastPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 9),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1a })
  );
  mastPole.position.y = 4.5;
  mast.add(mastPole);

  // VELA MAIOR (principal)
  const mainYard = new THREE.Group();
  mainYard.position.y = 7;
  mast.add(mainYard);

  const mainSail = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 6, 1, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8e4d8, side: THREE.DoubleSide, roughness: 0.9 })
  );
  mainSail.position.y = -3;
  mainYard.add(mainSail);

  // VELA DE PROA (buja)
  const jibYard = new THREE.Group();
  jibYard.position.set(0, 5, 3);
  mast.add(jibYard);

  const jibSail = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 4, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0xd8d2c0, side: THREE.DoubleSide })
  );
  jibSail.position.y = -2;
  jibYard.add(jibSail);

  return { mast, mainYard, mainSail, jibYard, jibSail };
}

export function updateRig(rig: any, sailFactor: number, boat: THREE.Group) {
  const f = THREE.MathUtils.clamp(sailFactor, 0, 1);
  
  // 1. SOBE/DESCE o mastro (não só escala)
  rig.mainYard.position.y = 2 + f * 5; // 0% = recolhida embaixo, 100% = no topo
  rig.jibYard.position.y = 1.5 + f * 3.5;
  
  // 2. Abre a vela
  rig.mainSail.scale.y = f;
  rig.jibSail.scale.y = f;
  rig.mainSail.position.y = -3 * f;
  rig.jibSail.position.y = -2 * f;
  rig.mainSail.visible = f > 0.01;
  rig.jibSail.visible = f > 0.01;

  // 3. Infla com vento
  const windAngle = Math.atan2(WIND.z, WIND.x) - boat.rotation.y;
  const infla = Math.sin(windAngle) * 0.3 * f;
  rig.mainSail.rotation.y = infla;
  rig.jibSail.rotation.y = infla * 1.2;
}
