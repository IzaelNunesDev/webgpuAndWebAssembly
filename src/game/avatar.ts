import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type AvatarState = 'deck' | 'swimming' | 'climbing';

export class AvatarController {
  public mesh = new THREE.Group();
  private mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  public state: AvatarState = 'deck';

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    const loader = new GLTFLoader();
    loader.load('/assets/hands-fps.glb', (gltf) => {
      this.mesh.add(gltf.scene);
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      gltf.animations.forEach(c => this.actions[c.name] = this.mixer!.clipAction(c));
      this.actions['idle']?.play();
    }, undefined, (error) => {
      console.warn('Avatar mesh not found, using placeholder. Place hands-fps.glb in public/assets/');
      // Placeholder hands (two small boxes)
      const mat = new THREE.MeshStandardMaterial({ color: '#d2b48c' });
      const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), mat);
      leftHand.position.set(-0.2, -0.1, 0);
      const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), mat);
      rightHand.position.set(0.2, -0.1, 0);
      this.mesh.add(leftHand, rightHand);
    });
    camera.add(this.mesh);
    this.mesh.position.set(0, -0.35, -0.25);
  }

  setState(next: AvatarState) {
    if (this.state === next) return;
    this.state = next;
    this.actions['idle']?.stop();
    this.actions['swim']?.stop();
    this.actions[next === 'swimming' ? 'swim' : 'idle']?.play();
  }

  update(dt: number) {
    this.mixer?.update(dt);
  }
}
