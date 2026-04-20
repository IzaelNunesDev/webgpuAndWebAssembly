import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { InputController } from './game/input';
import { Hud } from './game/hud';
import type { BoatState, ControlMode, PhysicsMessage, ShipControlState } from './game/types';
import { DEFAULT_WAVES } from './game/waves';
import { OceanMaterial } from './render/waterMaterial';
import './style.css';

type RendererLike = {
    domElement: HTMLCanvasElement;
    setSize(width: number, height: number): void;
    renderAsync?(scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
    render(scene: THREE.Scene, camera: THREE.Camera): void;
};

const WALK_SPEED = 2.5;
const RUN_SPEED = 4.5;
const SWIM_SPEED = 1.9;
const SWIM_SPRINT = 3.2;
const JUMP_IMPULSE = 4.5;
const COYOTE_TIME = 0.15;
const PLAYER_EYE_HEIGHT = 1.7;

class OceanEngine {
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    private readonly renderer: RendererLike;
    private readonly input: InputController;
    private readonly hud = new Hud();
    private readonly worker = new Worker(new URL('./wasm/physicsWorker.ts', import.meta.url), { type: 'module' });
    private readonly clock = new THREE.Clock();
    private readonly playerVelocity = new THREE.Vector3();
    private readonly playerWorld = new THREE.Vector3(0, 3, 6);
    private readonly playerLocal = new THREE.Vector3(0, PLAYER_EYE_HEIGHT, 6);
    private readonly boatQuaternion = new THREE.Quaternion();
    private readonly boatPosition = new THREE.Vector3();
    private readonly tmpForward = new THREE.Vector3();
    private readonly tmpRight = new THREE.Vector3();
    private readonly tmpMove = new THREE.Vector3();
    private readonly oceanSample = { height: 0, normal: [0, 1, 0] as [number, number, number], jacobian: 1 };
    private readonly shipControls: ShipControlState = { throttle: 0, rudder: 0, sail: 0.65, anchor: false };
    private readonly boatMesh: THREE.Group;
    private readonly oceanMesh: THREE.Mesh;
    private mode: ControlMode = 'onFoot';
    private yaw = 0;
    private pitch = -0.12;
    private lastGroundedAt = performance.now() / 1000;
    private boatState: BoatState = {
        transform: [0, 0, 0, 0, 0, 0, 1],
        speed: 0,
        helm: { ...this.shipControls },
    };

    constructor() {
        this.renderer = this.createRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        this.input = new InputController(this.renderer.domElement);
        this.renderer.domElement.addEventListener('click', () => this.input.requestPointerLock());

        this.scene.background = new THREE.Color('#07131d');
        this.scene.fog = new THREE.FogExp2('#7aa8c4', 0.012);

        this.hud.setMode(this.mode);
        this.boatMesh = this.createBoat();
        this.oceanMesh = this.createOcean();

        this.setupScene();
        this.bindEvents();
        this.initWorker();
        this.animate();
    }

    private createRenderer(): RendererLike {
        if ('gpu' in navigator) {
            this.hud.setRenderLabel('Three.js WebGPURenderer');
            return new WebGPURenderer({ antialias: true }) as unknown as RendererLike;
        }

        this.hud.setRenderLabel('Three.js WebGLRenderer');
        return new THREE.WebGLRenderer({ antialias: true });
    }

    private setupScene() {
        const ambient = new THREE.AmbientLight(0x7aa0b5, 0.85);
        const sun = new THREE.DirectionalLight(0xfff2c2, 1.9);
        sun.position.set(120, 180, 45);
        this.scene.add(ambient, sun);

        const sky = new THREE.Mesh(
            new THREE.SphereGeometry(900, 32, 16),
            new THREE.MeshBasicMaterial({ color: '#88b9d4', side: THREE.BackSide })
        );
        this.scene.add(sky, this.boatMesh, this.oceanMesh);

        this.camera.position.copy(this.playerWorld);
    }

    private createBoat() {
        const group = new THREE.Group();

        const hull = new THREE.Mesh(
            new THREE.BoxGeometry(6, 2.2, 18),
            new THREE.MeshStandardMaterial({ color: '#6a3f24', roughness: 0.72, metalness: 0.08 })
        );
        hull.position.y = 0.8;
        group.add(hull);

        const deck = new THREE.Mesh(
            new THREE.BoxGeometry(5.5, 0.25, 14),
            new THREE.MeshStandardMaterial({ color: '#9b6b3f', roughness: 0.9 })
        );
        deck.position.y = 2;
        group.add(deck);

        const mast = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.22, 11, 12),
            new THREE.MeshStandardMaterial({ color: '#caa472' })
        );
        mast.position.set(0, 7, -1);
        group.add(mast);

        const sail = new THREE.Mesh(
            new THREE.PlaneGeometry(5.5, 6.5, 16, 16),
            new THREE.MeshStandardMaterial({ color: '#e9e1cf', side: THREE.DoubleSide, roughness: 1 })
        );
        sail.position.set(0, 6.4, 0.2);
        sail.rotation.y = Math.PI;
        group.add(sail);

        const helm = new THREE.Mesh(
            new THREE.TorusGeometry(0.65, 0.08, 8, 20),
            new THREE.MeshStandardMaterial({ color: '#c48d55', metalness: 0.15, roughness: 0.6 })
        );
        helm.position.set(0, 3.2, 6.2);
        helm.rotation.y = Math.PI / 2;
        helm.name = 'helm';
        group.add(helm);

        group.position.set(0, 0, 0);
        return group;
    }

    private createOcean() {
        const geometry = new THREE.PlaneGeometry(1200, 1200, 256, 256);
        geometry.rotateX(-Math.PI / 2);

        const material = new OceanMaterial(DEFAULT_WAVES);
        const ocean = new THREE.Mesh(geometry, material);
        ocean.receiveShadow = false;
        return ocean;
    }

    private bindEvents() {
        window.addEventListener('resize', () => this.onResize());

        this.worker.onmessage = (event: MessageEvent<PhysicsMessage>) => {
            if (event.data.type === 'ready') {
                this.hud.setEngineLabel(event.data.isWasm ? 'WASM (Rapier3D)' : 'JS (Fallback)', event.data.isWasm ? 'active' : 'warning');
                return;
            }

            if (event.data.type === 'update') {
                this.boatState = event.data.boat;
                this.oceanSample.height = event.data.ocean.height;
                this.oceanSample.normal = event.data.ocean.normal;
                this.oceanSample.jacobian = event.data.ocean.jacobian;
                this.syncBoatTransform();
                this.hud.setBoatState(this.boatState);
            }
        };
    }

    private initWorker() {
        const wasmUrl = new URL('../wasm-pkg/ocean_wasm_bg.wasm', import.meta.url).href;
        this.worker.postMessage({ type: 'init', wasmUrl });
    }

    private syncBoatTransform() {
        const [x, y, z, qx, qy, qz, qw] = this.boatState.transform;
        this.boatPosition.set(x, y, z);
        this.boatQuaternion.set(qx, qy, qz, qw);
        this.boatMesh.position.copy(this.boatPosition);
        this.boatMesh.quaternion.copy(this.boatQuaternion);
    }

    private animate = () => {
        requestAnimationFrame(this.animate);

        const dt = Math.min(this.clock.getDelta(), 0.033);
        this.update(dt);

        if (this.renderer.renderAsync) {
            void this.renderer.renderAsync(this.scene, this.camera);
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        this.input.endFrame();
    };

    private update(dt: number) {
        this.updateModeTransitions();
        this.updateLook();
        this.updatePlayer(dt);
        this.updateShipControls();
        this.pushControlsToWorker();
    }

    private updateModeTransitions() {
        if (this.input.triggered('KeyQ')) {
            this.mode = this.mode === 'freeCamera' ? 'onFoot' : 'freeCamera';
            this.hud.setMode(this.mode);
        }

        if (this.input.triggered('KeyE')) {
            if (this.mode === 'shipHelm') {
                this.mode = 'onFoot';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT, 6);
                this.hud.setMode(this.mode);
            } else if (this.mode === 'swimming' && this.isNearBoatLadder()) {
                this.mode = 'onFoot';
                this.playerLocal.set(-1.8, PLAYER_EYE_HEIGHT, 7.6);
                this.hud.setMode(this.mode);
            } else if (this.isNearHelm()) {
                this.mode = 'shipHelm';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 1.2, 7.4);
                this.hud.setMode(this.mode);
            }
        }

        this.input.syncMode(this.mode);
    }

    private updateLook() {
        const look = this.input.consumeLook();
        this.yaw += look.yaw;
        this.pitch = this.input.clampPitch(this.pitch + look.pitch);

        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
    }

    private updatePlayer(dt: number) {
        if (this.mode === 'shipHelm') {
            const helmOffset = new THREE.Vector3(0, PLAYER_EYE_HEIGHT + 1.2, 7.4).applyQuaternion(this.boatQuaternion);
            this.camera.position.copy(this.boatPosition).add(helmOffset);
            return;
        }

        if (this.mode === 'freeCamera') {
            this.updateFreeCamera(dt);
            return;
        }

        const seconds = performance.now() / 1000;
        const speed = this.mode === 'swimming'
            ? (this.input.pressedNow('ShiftLeft') ? SWIM_SPRINT : SWIM_SPEED)
            : (this.input.pressedNow('ShiftLeft') ? RUN_SPEED : WALK_SPEED);

        this.tmpForward.set(0, 0, -1).applyEuler(this.camera.rotation);
        this.tmpForward.y = 0;
        this.tmpForward.normalize();
        this.tmpRight.crossVectors(this.tmpForward, new THREE.Vector3(0, 1, 0)).normalize();

        const forwardAxis = this.input.axis('KeyS', 'KeyW');
        const strafeAxis = this.input.axis('KeyA', 'KeyD');
        this.tmpMove.copy(this.tmpForward).multiplyScalar(forwardAxis).add(this.tmpRight.multiplyScalar(strafeAxis));

        if (this.tmpMove.lengthSq() > 0) {
            this.tmpMove.normalize().multiplyScalar(speed);
        }

        if (this.mode === 'swimming') {
            this.playerVelocity.x = THREE.MathUtils.damp(this.playerVelocity.x, this.tmpMove.x, 10, dt);
            this.playerVelocity.z = THREE.MathUtils.damp(this.playerVelocity.z, this.tmpMove.z, 10, dt);

            if (this.input.triggered('Space')) {
                this.playerVelocity.y = -1.4;
            } else {
                const targetYVelocity = 0.65;
                this.playerVelocity.y = THREE.MathUtils.damp(this.playerVelocity.y, targetYVelocity, 2.5, dt);
            }

            this.playerWorld.addScaledVector(this.playerVelocity, dt);
            this.playerWorld.y = Math.max(this.playerWorld.y, this.oceanSample.height + 0.18);
        } else {
            this.playerVelocity.x = this.tmpMove.x;
            this.playerVelocity.z = this.tmpMove.z;
            this.playerVelocity.y -= 9.81 * dt;

            if (this.isOnDeck()) {
                this.lastGroundedAt = seconds;
                if (this.playerVelocity.y < 0) this.playerVelocity.y = 0;
            }

            if (this.input.triggered('Space') && seconds - this.lastGroundedAt < COYOTE_TIME) {
                this.playerVelocity.y = JUMP_IMPULSE;
            }

            this.playerWorld.addScaledVector(this.playerVelocity, dt);

            const deckHeight = this.sampleDeckHeight() + PLAYER_EYE_HEIGHT;
            if (this.playerWorld.y < deckHeight) {
                this.playerWorld.y = deckHeight;
                this.playerVelocity.y = 0;
            }

            if (this.playerWorld.distanceTo(this.boatPosition) > 14 || this.playerWorld.y < this.oceanSample.height + 0.6) {
                this.mode = 'swimming';
                this.hud.setMode(this.mode);
            }
        }

        if (this.mode !== 'swimming') {
            this.playerLocal.copy(this.playerWorld.clone().sub(this.boatPosition).applyQuaternion(this.boatQuaternion.clone().invert()));
        }

        this.camera.position.copy(this.playerWorld);
    }

    private updateFreeCamera(dt: number) {
        const flySpeed = this.input.pressedNow('ShiftLeft') ? 10 : 5;
        this.tmpForward.set(0, 0, -1).applyEuler(this.camera.rotation).normalize();
        this.tmpRight.crossVectors(this.tmpForward, new THREE.Vector3(0, 1, 0)).normalize();
        this.tmpMove.set(0, 0, 0);
        this.tmpMove.addScaledVector(this.tmpForward, this.input.axis('KeyS', 'KeyW'));
        this.tmpMove.addScaledVector(this.tmpRight, this.input.axis('KeyA', 'KeyD'));
        this.tmpMove.y += this.input.axis('KeyC', 'Space');

        if (this.tmpMove.lengthSq() > 0) {
            this.tmpMove.normalize();
            this.camera.position.addScaledVector(this.tmpMove, flySpeed * dt);
        }
    }

    private updateShipControls() {
        if (this.mode !== 'shipHelm') return;

        const throttleInput = this.input.axis('KeyS', 'KeyW');
        const hasBoost = throttleInput > 0 && this.input.pressedNow('ShiftLeft');
        this.shipControls.throttle = THREE.MathUtils.clamp(throttleInput * (hasBoost ? 1.2 : 1), -0.35, 1.2);
        this.shipControls.rudder = this.input.axis('KeyD', 'KeyA');

        if (this.input.triggered('KeyR')) {
            this.shipControls.sail = this.shipControls.sail > 0.1 ? 0 : 1;
        }

        if (this.input.triggered('KeyF')) {
            this.shipControls.anchor = !this.shipControls.anchor;
        }
    }

    private pushControlsToWorker() {
        this.worker.postMessage({
            type: 'controls',
            mode: this.mode,
            ship: this.shipControls,
            player: { x: this.playerWorld.x, y: this.playerWorld.y, z: this.playerWorld.z },
        });
    }

    private isNearHelm() {
        const helmWorld = new THREE.Vector3(0, 3.2, 6.2).applyQuaternion(this.boatQuaternion).add(this.boatPosition);
        return this.playerWorld.distanceTo(helmWorld) < 2.3;
    }

    private isNearBoatLadder() {
        const ladderWorld = new THREE.Vector3(-2.3, 1.2, 8.1).applyQuaternion(this.boatQuaternion).add(this.boatPosition);
        return this.playerWorld.distanceTo(ladderWorld) < 2.0;
    }

    private isOnDeck() {
        const local = this.playerWorld.clone().sub(this.boatPosition).applyQuaternion(this.boatQuaternion.clone().invert());
        return Math.abs(local.x) < 3 && local.z > -8 && local.z < 9 && Math.abs(local.y - PLAYER_EYE_HEIGHT - 2) < 1.2;
    }

    private sampleDeckHeight() {
        const deckLocal = new THREE.Vector3(this.playerLocal.x, 2, this.playerLocal.z);
        return deckLocal.applyQuaternion(this.boatQuaternion).add(this.boatPosition).y;
    }

    private onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

new OceanEngine();
