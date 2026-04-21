import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DEFAULT_WAVES } from './waves';
import { MeshStandardNodeMaterial } from 'three/webgpu';

const BASE = '/assets/boats/pirate/';
const OCEAN_DEPTH = 10.0;

// Node name key (without trailing _0, lowercase) → texture filename
const TEXTURE_MAP: Record<string, string> = {
    ship_rug:           'b235a5fcbe2e40f6b751f79beb1fa68e_RGB_Rug.png',
    ship_wood_trims:    '64705f77da8448fd8f61c8a4878d5b6c_RGB_Wood_Trims.png',
    ship_wood_planks:   '5ca1c55d2187494ea908622555baca49_RGB_Wood_Planks.png',
    ship_wood_painted:  '53a8d42e47ed460d8c282a737f570fc8_RGB_Wood_Painted.png',
    ship_sails:         '16c68dd1db694887b6ab9a3a1405b1ea_A_Sails.png',
    ship_building_mats: 'd7f0991069ef470baa33e024288ca612_RGB_Building_Mats.png',
    ship_emissive:      '451ae17a36e24a559e027655317d1e6b_RGB_Emissive.png',
    ship_foliage_02:    '616e5610cd4946f79947f361002c8213_RGB_Foliage_02.png',
    ship_foliage:       '9793da75063845df9c2e3e0588c76e19_RGB_Foliage.png',
    ship_bits_bobs:     'af6229a83c0241f19f7be821c0517042_RGB_Bits_Bobs.png',
};

// Diorama-only nodes that don't make sense in an open ocean — hide them.
// This also prevents them from inflating the bounding box used for auto-scaling.
// (sky_sky_0 alone spans 30 900 model-units; sand tiles span 32 000 — both would
//  crush the scale to ≈0.0007 and make the ship invisible.)
const HIDE_KEYWORDS = [
    'sky', 'sand', 'rock', 'water', 'terrain', 'ground', 'backdrop', 'environment', 
    'no_shad', 'sand_caustics', 'sand_tile', 'rock_tile', 'rocks_unique', 'water_light'
];

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
    private loaded = false;

    constructor(scene: THREE.Scene, x = 0, z = -20) {
        this.root.position.set(x, 0, z);
        scene.add(this.root);
        this.load();
    }

    private load() {
        const texLoader = new THREE.TextureLoader();
        const cache: Record<string, THREE.Texture> = {};

        const getTex = (file: string): THREE.Texture => {
            if (!cache[file]) {
                const t = texLoader.load(BASE + file);
                t.colorSpace = THREE.SRGBColorSpace;
                t.flipY = false; // GLTF UV convention
                cache[file] = t;
            }
            return cache[file];
        };

        new GLTFLoader().load(
            BASE + 'boat.gltf',
            (gltf) => {
                const model = gltf.scene;

                // ── 1. Hide diorama parts and apply ship textures ────────────────
                model.traverse((obj) => {
                    const lc = obj.name.toLowerCase();
                    
                    // Hide any object whose name contains a diorama keyword
                    const isDiorama = HIDE_KEYWORDS.some(kw => lc.includes(kw));
                    if (isDiorama) {
                        obj.visible = false;
                        obj.traverse((child) => { child.visible = false; });
                        return;
                    }
                    if (!(obj instanceof THREE.Mesh)) return;

                    const key = lc.replace(/_0$/, '');
                    const texFile = TEXTURE_MAP[key];
                    if (texFile) {
                        const isSail = key === 'ship_sails';
                        obj.material = new MeshStandardNodeMaterial({
                            color:       0xffffff,
                            map:         getTex(texFile),
                            roughness:   0.82,
                            metalness:   0.05,
                            transparent: isSail,
                            alphaTest:   isSail ? 0.35 : 0,
                            side:        isSail ? THREE.DoubleSide : THREE.FrontSide,
                        });
                    }
                    obj.castShadow    = true;
                    obj.receiveShadow = true;
                });

                // ── 2. Auto-scale using ONLY visible ship meshes ─────────────────
                // Cannot use Box3.setFromObject because Three.js traverses invisible
                // children too — the diorama meshes span 32 000 model-units and would
                // crush the computed scale to ~0.0007, making the ship invisible.
                const shipBox = new THREE.Box3();
                model.traverse((obj) => {
                    if (obj instanceof THREE.Mesh && obj.visible) {
                        const lc = obj.name.toLowerCase();
                        const key = lc.replace(/_0$/, '');
                        if (TEXTURE_MAP[key]) {
                            shipBox.expandByObject(obj);
                        }
                    }
                });

                if (shipBox.isEmpty()) {
                    console.warn('[NpcBoat] shipBox empty after texture filtering — falling back to visible meshes');
                    model.traverse((obj) => {
                        // Critical check: only include visible meshes that ARE NOT background/water
                        if (obj instanceof THREE.Mesh && obj.visible) {
                            const lc = obj.name.toLowerCase();
                            const isBg = HIDE_KEYWORDS.some(kw => lc.includes(kw)) || lc.includes('mesh');
                            if (!isBg) shipBox.expandByObject(obj);
                        }
                    });
                }

                if (shipBox.isEmpty()) {
                    console.warn('[NpcBoat] Still empty — using full model bounding box (potentially inaccurate)');
                    model.traverse((obj) => {
                        if (obj instanceof THREE.Mesh && obj.visible) shipBox.expandByObject(obj);
                    });
                }

                if (shipBox.isEmpty()) {
                    console.error('[NpcBoat] No meshes found at all');
                    this.root.add(model);
                    this.loaded = true;
                    return;
                }

                const size = new THREE.Vector3();
                shipBox.getSize(size);

                // Use the longest horizontal axis for length reference (~22 m target)
                const longestHoriz = Math.max(size.x, size.z);
                const scale = 80 / longestHoriz;
                model.scale.setScalar(scale);

                // ── 3. Centre the model horizontally; place keel at y = 0 ────────
                // Re-sample bbox after scaling
                const scaledBox = new THREE.Box3();
                model.traverse((obj) => {
                    if (obj instanceof THREE.Mesh && obj.visible) {
                        scaledBox.expandByObject(obj);
                    }
                });

                const centre = new THREE.Vector3();
                scaledBox.getCenter(centre);

                // Shift horizontally to centre, then set y so keel touches y=0
                model.position.x -= centre.x;
                model.position.z -= centre.z;
                model.position.y  = -scaledBox.min.y; // lift keel to waterline

                // Rotate so the ship's Z-axis (fore-aft) faces away from origin
                model.rotation.y = Math.PI;

                this.root.add(model);
                this.loaded = true;

                const scaledSize = size.clone().multiplyScalar(scale);
                console.log(`[NpcBoat] loaded — scale=${scale.toFixed(4)}, size=${scaledSize.toArray().map(v => v.toFixed(1)).join(' × ')} m`);
            },
            undefined,
            (err) => console.error('[NpcBoat] GLTF load failed:', err)
        );
    }

    /** Call every frame from the main update loop. */
    update(dt: number, time: number) {
        if (!this.loaded) return;

        const x = this.root.position.x;
        const z = this.root.position.z;

        // Sample wave height at centre + 4 probes for pitch / roll
        const d = 8;
        const hf = sampleWaveHeight(x,     z - d, time);
        const hb = sampleWaveHeight(x,     z + d, time);
        const hl = sampleWaveHeight(x - d, z,     time);
        const hr = sampleWaveHeight(x + d, z,     time);
        const hy = (hf + hb + hl + hr) * 0.25;

        this.root.position.y += (hy - this.root.position.y) * Math.min(1, dt * 3);
        this.root.rotation.x += (-(hf - hb) / (d * 2) - this.root.rotation.x) * Math.min(1, dt * 2);
        this.root.rotation.z += ( (hr - hl) / (d * 2) - this.root.rotation.z) * Math.min(1, dt * 2);

        // Gentle slow drift so it doesn't look static
        this.root.position.x += Math.sin(time * 0.07) * 0.002;
        this.root.position.z += Math.cos(time * 0.05) * 0.002;
    }
}
