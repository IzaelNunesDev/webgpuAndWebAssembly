import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { DEFAULT_WAVES } from './waves';

const BASE        = '/assets/boats/npc/';
const OCEAN_DEPTH = 10.0;
const PROBE_DIST  = 20;

const MAX_SPEED    = 10;   // m/s at full throttle
const TURN_RATE    = 0.45; // rad/s at full rudder
const SPEED_INERTIA = 0.97;

// How high the phantom deck sits above the root origin.
// Increase if the player sinks into the hull, decrease if they float above.
export const NPC_DECK_HEIGHT = 10;

// Horizontal radius (root-centred) used for boarding and deck collision.
// Big enough to cover the full hull footprint regardless of model orientation.
const BOARD_RADIUS = 42;
const DECK_RADIUS  = 50; // slightly wider so player doesn't fall off the edge

function sampleWaveHeight(x: number, z: number, time: number): number {
    let y = 0;
    for (const w of DEFAULT_WAVES) {
        const k = (2 * Math.PI) / w.wavelength;
        const c = Math.sqrt(9.81 / k * Math.tanh(k * OCEAN_DEPTH)) * w.speed;
        const f = k * (w.direction.x * x + w.direction.y * z - c * time);
        y += (w.steepness / k) * Math.sin(f);
    }
    return y;
}

export class NpcBoat {
    readonly root = new THREE.Group();

    // External controls
    rudder   = 0;
    throttle = 0;

    // Physics
    private yaw   = 0;
    private speed = 0;
    private smoothY     = 0;
    private smoothPitch = 0;
    private smoothRoll  = 0;
    private physicsReady = false;

    constructor(scene: THREE.Scene, x = 0, z = -20) {
        this.root.position.set(x, 0, z);
        scene.add(this.root);
        this.load();
    }

    // ── Public geometry helpers ────────────────────────────────────────────

    /** Can the player board from this world position? (works before model loads) */
    canBoard(worldPos: THREE.Vector3): boolean {
        const dx = worldPos.x - this.root.position.x;
        const dz = worldPos.z - this.root.position.z;
        return dx * dx + dz * dz < BOARD_RADIUS * BOARD_RADIUS;
    }

    /** Is the player still above the deck footprint? (for floor collision) */
    isAboveDeck(worldPos: THREE.Vector3): boolean {
        const dx = worldPos.x - this.root.position.x;
        const dz = worldPos.z - this.root.position.z;
        return dx * dx + dz * dz < DECK_RADIUS * DECK_RADIUS;
    }

    /**
     * World Y of the phantom deck surface.
     * Tilts with the boat so the floor follows pitch and roll.
     */
    deckFloorY(): number {
        // Take the "up" direction rotated by the boat quaternion.
        // NPC_DECK_HEIGHT along that direction gives the deck world Y offset.
        const up = new THREE.Vector3(0, NPC_DECK_HEIGHT, 0)
            .applyQuaternion(this.root.quaternion);
        return this.root.position.y + up.y;
    }

    /** World position to spawn the player when boarding. */
    boardingPos(eyeHeight: number): THREE.Vector3 {
        return new THREE.Vector3(
            this.root.position.x,
            this.deckFloorY() + eyeHeight,
            this.root.position.z,
        );
    }

    // ── Private loading ────────────────────────────────────────────────────

    private load() {
        const mtlLoader = new MTLLoader();
        mtlLoader.setPath(BASE);

        mtlLoader.load('boat.mtl', (materials) => {
            materials.preload();

            for (const name of Object.keys(materials.materials)) {
                const mat = materials.materials[name] as THREE.MeshPhongMaterial;
                if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
            }

            const objLoader = new OBJLoader();
            objLoader.setMaterials(materials);
            objLoader.setPath(BASE);

            objLoader.load('boat.obj', (model) => {
                model.traverse((obj) => {
                    if (!(obj instanceof THREE.Mesh)) return;
                    obj.castShadow    = true;
                    obj.receiveShadow = true;
                });

                // Scale longest horizontal axis to 80 units
                const box  = new THREE.Box3().setFromObject(model);
                const size = new THREE.Vector3();
                box.getSize(size);
                const longest = Math.max(size.x, size.z);
                const scale   = longest > 0 ? 80 / longest : 1;
                model.scale.setScalar(scale);

                // Centre horizontally; keel at y = 0 (root origin)
                const scaledBox = new THREE.Box3().setFromObject(model);
                const centre    = new THREE.Vector3();
                scaledBox.getCenter(centre);
                model.position.x -= centre.x;
                model.position.z -= centre.z;
                model.position.y  = -scaledBox.min.y;

                // Bow points away from world origin
                model.rotation.y = Math.PI;

                this.root.add(model);

                const s = size.clone().multiplyScalar(scale);
                console.log(
                    `[NpcBoat] loaded — scale=${scale.toFixed(3)} ` +
                    `dims=${s.x.toFixed(1)}×${s.y.toFixed(1)}×${s.z.toFixed(1)}`
                );
            },
            undefined,
            (err) => console.error('[NpcBoat] OBJ failed:', err));
        },
        undefined,
        (err) => console.error('[NpcBoat] MTL failed:', err));
    }

    // ── Update ────────────────────────────────────────────────────────────

    update(dt: number, time: number) {
        const x = this.root.position.x;
        const z = this.root.position.z;

        if (!this.physicsReady) {
            this.smoothY     = sampleWaveHeight(x, z, time);
            this.smoothPitch = 0;
            this.smoothRoll  = 0;
            this.physicsReady = true;
        }

        // ── Steering + movement ──────────────────────────────────────────
        const effectiveRudder = this.rudder * Math.min(1, Math.abs(this.speed) / 2);
        this.yaw += effectiveRudder * TURN_RATE * dt;

        const targetSpeed = this.throttle * MAX_SPEED;
        this.speed = this.speed * SPEED_INERTIA +
                     (targetSpeed - this.speed * SPEED_INERTIA) * Math.min(1, dt * 1.2);

        // Bow is in root-local -Z after the model's π rotation → move in -Z
        this.root.position.x -= Math.sin(this.yaw) * this.speed * dt;
        this.root.position.z -= Math.cos(this.yaw) * this.speed * dt;

        // ── Wave physics ─────────────────────────────────────────────────
        const nx = this.root.position.x;
        const nz = this.root.position.z;
        const d  = PROBE_DIST;

        const hC = sampleWaveHeight(nx,     nz,     time);
        const hF = sampleWaveHeight(nx,     nz - d, time); // bow
        const hB = sampleWaveHeight(nx,     nz + d, time); // stern
        const hL = sampleWaveHeight(nx - d, nz,     time);
        const hR = sampleWaveHeight(nx + d, nz,     time);

        const alphaY    = 1 - Math.exp(-1.2  * dt); // height: τ ≈ 0.8 s
        const alphaTilt = 1 - Math.exp(-0.35 * dt); // tilt:   τ ≈ 2.9 s

        this.smoothY     += (hC - this.smoothY) * alphaY;
        this.smoothPitch += (-(hF - hB) / (2 * d) - this.smoothPitch) * alphaTilt;
        this.smoothRoll  += ( (hR - hL) / (2 * d) - this.smoothRoll)  * alphaTilt;

        this.root.rotation.order = 'YXZ';
        this.root.position.y  = this.smoothY;
        this.root.rotation.y  = this.yaw;
        this.root.rotation.x  = this.smoothPitch;
        this.root.rotation.z  = this.smoothRoll;
    }
}
