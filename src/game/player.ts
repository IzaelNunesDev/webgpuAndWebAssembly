import * as THREE from 'three';
import type { PlayerState } from './types';

export type PlayerMode = 'deck' | 'swim';

export class PlayerController {
    public mode: PlayerMode = 'deck';
    public capsuleMesh: THREE.Mesh;
    private playerBodyCreated = false;
    private playerState?: PlayerState;

    constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
        // Simple capsule for body visual
        const geometry = new THREE.CapsuleGeometry(0.3, 1.2);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xffdbac, 
            transparent: true, 
            opacity: 0 
        });
        this.capsuleMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.capsuleMesh);
    }

    setPlayerState(state: PlayerState | undefined) {
        this.playerState = state;
    }

    getState() {
        return this.playerState;
    }

    enterWater(worker: Worker, pos: THREE.Vector3, renderer: THREE.Renderer) {
        if (this.mode === 'swim') return;
        this.mode = 'swim';

        if (!this.playerBodyCreated) {
            worker.postMessage({ type: 'spawnPlayer', pos: { x: pos.x, y: pos.y, z: pos.z } });
            this.playerBodyCreated = true;
        }

        this.camera.parent = this.scene;
        // @ts-ignore
        renderer.toneMappingExposure = 0.4; // Darken
        
        // Visual capsule becomes visible
        (this.capsuleMesh.material as THREE.MeshStandardMaterial).opacity = 0.9;
    }

    exitWater(renderer: THREE.Renderer) {
        if (this.mode === 'deck') return;
        this.mode = 'deck';

        // @ts-ignore
        renderer.toneMappingExposure = 1.0; // Normal
        (this.capsuleMesh.material as THREE.MeshStandardMaterial).opacity = 0;
    }

    update(dt: number, oceanHeight: number, scene: THREE.Scene) {
        if (this.mode === 'swim') {
            const under = this.camera.position.y < oceanHeight;

            if (under) {
                // Underwater effect
                scene.fog = new THREE.FogExp2(0x0a2e4a, 0.03);
                // The physics worker handles the "sinking" logic, 
                // but we update visuals here if needed.
            } else {
                // Reset fog (might need to store original fog)
                scene.fog = new THREE.FogExp2('#7aa8c4', 0.012);
            }

            if (this.playerState) {
                const [x, y, z] = this.playerState.position;
                this.camera.position.set(x, y, z);
                this.capsuleMesh.position.set(x, y - 0.6, z);
            }
        }
    }
}
