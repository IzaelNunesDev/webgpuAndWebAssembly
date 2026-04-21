import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { InputController } from './game/input';
import { Hud } from './game/hud';
import type { BoatState, ControlMode, PhysicsMessage, ShipControlState } from './game/types';
import { DEFAULT_WAVES, WIND } from './game/waves';
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
    private readonly playerWorld = new THREE.Vector3(0, 4.3, 7.0);
    private readonly playerLocal = new THREE.Vector3(0, PLAYER_EYE_HEIGHT + 2.44, 7.0);
    private readonly boatQuaternion = new THREE.Quaternion();
    private readonly boatPosition = new THREE.Vector3();
    private readonly tmpForward = new THREE.Vector3();
    private readonly tmpRight = new THREE.Vector3();
    private readonly tmpMove = new THREE.Vector3();
    private readonly oceanSample = { height: 0, normal: [0, 1, 0] as [number, number, number], jacobian: 1 };
    private readonly shipControls: ShipControlState = { throttle: 0, rudder: 0, sail: 0, anchor: false };
    private readonly boatMesh: THREE.Group;
    private readonly oceanMesh: THREE.Mesh;
    private boomMesh: THREE.Mesh | null = null;
    private mode: ControlMode = 'onFoot';
    private yaw = 0;
    private pitch = -0.12;
    private lastGroundedAt = performance.now() / 1000;
    private boatState: BoatState = {
        transform: [0, 0, 0, 0, 0, 0, 1],
        speed: 0,
        helm: { ...this.shipControls },
    };
    private headBobTime = 0;
    private targetFov = 75;

    constructor() {
        this.renderer = this.createRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(this.renderer.domElement);

        this.input = new InputController(this.renderer.domElement);
        this.renderer.domElement.addEventListener('click', () => this.input.requestPointerLock());

        this.scene.background = new THREE.Color('#07131d');
        this.scene.fog = new THREE.FogExp2('#7aa8c4', 0.012);

        this.hud.setMode(this.mode);
        this.hud.setWind(WIND.x, WIND.z, WIND.speed);
        this.boatMesh = this.createBoat();
        this.boomMesh = this.boatMesh.getObjectByName('boom') as THREE.Mesh | null;
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

        const matDark = new THREE.MeshStandardMaterial({ color: '#5a3520', roughness: 0.75, metalness: 0.05 });
        const matMid = new THREE.MeshStandardMaterial({ color: '#8b5c32', roughness: 0.85 });
        const matLight = new THREE.MeshStandardMaterial({ color: '#b07840', roughness: 0.9 });
        const matRope = new THREE.MeshStandardMaterial({ color: '#c8a86a', roughness: 1.0 });
        const matSail = new THREE.MeshStandardMaterial({ color: '#e9e1cf', side: THREE.DoubleSide, roughness: 1 });

        // Sloop — 20m length, 5m beam, 3.5m tall (2m draft, 1.5m freeboard at center)
        const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 20), matDark);
        hull.position.y = 0;
        group.add(hull);

        // Main deck (mid-ship)
        const mainDeck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 12), matLight);
        mainDeck.position.set(0, 1.9, 0.5);
        group.add(mainDeck);

        // Fore deck (proa elevada +0.4m)
        const foreDeck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 6.5), matLight);
        foreDeck.position.set(0, 2.3, -7.5);
        group.add(foreDeck);

        // Aft deck (popa elevada +0.4m, helm platform)
        const aftDeck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.28, 5.5), matLight);
        aftDeck.position.set(0, 2.3, 7.5);
        group.add(aftDeck);

        // Steps between deck levels
        const aftStep = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 0.6), matMid);
        aftStep.position.set(0, 2.05, 4.6);
        group.add(aftStep);
        const foreStep = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 0.6), matMid);
        foreStep.position.set(0, 2.05, -4.4);
        group.add(foreStep);

        // Escotilha (hatch) — scale perception: you can see depth below deck
        const hatchRim = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 2.3), matMid);
        hatchRim.position.set(-0.5, 1.88, 1.8);
        group.add(hatchRim);
        const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 1.9),
            new THREE.MeshStandardMaterial({ color: '#1e100a', roughness: 0.9 }));
        hatch.position.set(-0.5, 1.96, 1.8);
        group.add(hatch);

        // Mast step
        const mastStep = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 10), matMid);
        mastStep.position.set(0, 2.14, -2.5);
        group.add(mastStep);

        // Main mast — 16m
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 16, 12), matMid);
        mast.position.set(0, 10.14, -2.5);
        group.add(mast);

        // Main yard (verga principal) at ~60% height
        const mainYard = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9.5, 8), matMid);
        mainYard.rotation.z = Math.PI / 2;
        mainYard.position.set(0, 12.0, -2.5);
        group.add(mainYard);

        // Gaff (upper spar)
        const gaff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6.5, 8), matMid);
        gaff.rotation.z = Math.PI / 2;
        gaff.position.set(0, 14.8, -1.2);
        group.add(gaff);

        // Boom (lower spar) — rotates as sail trim / direction control
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 8.5, 8), matMid);
        boom.rotation.z = Math.PI / 2;
        boom.position.set(0, 2.5, -1.2);
        boom.name = 'boom';
        group.add(boom);

        // Mainsail
        const mainsail = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 11, 12, 12), matSail);
        mainsail.position.set(0, 8.6, -1.5);
        group.add(mainsail);

        // Bowsprit (gurupés) angled forward from bow
        const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 7.5, 8), matMid);
        bowsprit.rotation.x = Math.PI / 2 - 0.22;
        bowsprit.position.set(0, 3.1, -13.5);
        group.add(bowsprit);

        // Jib sail (vela de proa)
        const jib = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 7.5, 6, 8), matSail);
        jib.position.set(0, 8.2, -10.5);
        jib.rotation.y = Math.PI;
        group.add(jib);

        // Railings — port and starboard along main deck
        for (const side of [-1, 1] as const) {
            for (let z = -4.0; z <= 4.5; z += 2.2) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), matRope);
                post.position.set(side * 2.35, 2.42, z);
                group.add(post);
            }
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 12), matRope);
            rail.position.set(side * 2.35, 2.89, 0.5);
            group.add(rail);
        }

        // Helm pedestal
        const helmPost = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.9, 8), matMid);
        helmPost.position.set(0, 2.74, 8.5);
        group.add(helmPost);

        // Helm — 1.5m diameter (radius 0.75)
        const helm = new THREE.Mesh(
            new THREE.TorusGeometry(0.75, 0.09, 8, 20),
            new THREE.MeshStandardMaterial({ color: '#c48d55', metalness: 0.15, roughness: 0.6 })
        );
        helm.position.set(0, 3.7, 8.5);
        helm.rotation.x = Math.PI / 2 - 0.2;
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
        this.updateShipControls(dt);
        this.updateBoom();
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
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 2.44, 7.5);
                this.hud.setMode(this.mode);
            } else if (this.mode === 'mastControl') {
                this.mode = 'onFoot';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 2.04, -2.5);
                this.hud.setMode(this.mode);
            } else if (this.mode === 'swimming' && this.isNearBoatLadder()) {
                this.mode = 'onFoot';
                this.playerLocal.set(-1.5, PLAYER_EYE_HEIGHT + 2.44, 9.0);
                this.hud.setMode(this.mode);
            } else if (this.isNearMast()) {
                this.mode = 'mastControl';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 2.04, -2.5);
                this.hud.setMode(this.mode);
            } else if (this.isNearHelm()) {
                this.mode = 'shipHelm';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 2.44, 9.0);
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
        // Dynamic FOV — 68° at helm, 82° sprinting, 75° default
        const hasMoveInput = this.input.axis('KeyS', 'KeyW') !== 0 || this.input.axis('KeyA', 'KeyD') !== 0;
        const isSprinting = this.input.pressedNow('ShiftLeft') && hasMoveInput && this.mode === 'onFoot';
        const desiredFov = this.mode === 'shipHelm' ? 68 : (isSprinting ? 82 : 75);
        this.targetFov = THREE.MathUtils.lerp(this.targetFov, desiredFov, dt * 8);
        this.camera.fov = this.targetFov;
        this.camera.updateProjectionMatrix();

        if (this.mode === 'shipHelm') {
            const helmOffset = new THREE.Vector3(0, PLAYER_EYE_HEIGHT + 2.44, 9.0).applyQuaternion(this.boatQuaternion);
            this.camera.position.copy(this.boatPosition).add(helmOffset);
            return;
        }

        if (this.mode === 'mastControl') {
            const mastOffset = new THREE.Vector3(0, PLAYER_EYE_HEIGHT + 2.04, -2.5).applyQuaternion(this.boatQuaternion);
            this.camera.position.copy(this.boatPosition).add(mastOffset);
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

            if (this.playerWorld.distanceTo(this.boatPosition) > 22 || this.playerWorld.y < this.oceanSample.height + 0.6) {
                this.mode = 'swimming';
                this.hud.setMode(this.mode);
            }
        }

        if (this.mode !== 'swimming') {
            this.playerLocal.copy(this.playerWorld.clone().sub(this.boatPosition).applyQuaternion(this.boatQuaternion.clone().invert()));
        }

        this.camera.position.copy(this.playerWorld);

        // Head-bob when walking/running on deck
        if (this.mode === 'onFoot') {
            const isMoving = this.tmpMove.lengthSq() > 0.01;
            if (isMoving) this.headBobTime += dt * (isSprinting ? 2.0 : 1.8);
            const amp = isMoving ? (isSprinting ? 0.04 : 0.015) : 0;
            if (amp > 0) this.camera.position.y += Math.sin(this.headBobTime) * amp;
        }
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

    private updateShipControls(dt: number) {
        this.shipControls.throttle = 0;

        if (this.mode === 'shipHelm') {
            this.shipControls.rudder = this.input.axis('KeyD', 'KeyA');
            if (this.input.triggered('KeyF')) {
                this.shipControls.anchor = !this.shipControls.anchor;
            }
        } else if (this.mode === 'mastControl') {
            // W/S sobe/desce vela · A/D gira boom (direção)
            const sailDelta = this.input.axis('KeyS', 'KeyW');
            this.shipControls.sail = THREE.MathUtils.clamp(this.shipControls.sail + sailDelta * dt, 0, 1);
            this.shipControls.rudder = this.input.axis('KeyD', 'KeyA');
        } else {
            // Sem controle ativo — leme volta ao centro gradualmente
            this.shipControls.rudder *= Math.max(0, 1 - dt * 3);
        }
    }

    private updateBoom() {
        if (this.boomMesh) {
            // Boom swings ±70° based on rudder/sail trim
            this.boomMesh.rotation.y = THREE.MathUtils.lerp(
                this.boomMesh.rotation.y,
                this.shipControls.rudder * 1.2,
                0.15
            );
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

    private isNearMast() {
        const mastWorld = new THREE.Vector3(0, 2.14, -2.5).applyQuaternion(this.boatQuaternion).add(this.boatPosition);
        return this.playerWorld.distanceTo(mastWorld) < 2.5;
    }

    private isNearHelm() {
        const helmWorld = new THREE.Vector3(0, 3.7, 8.5).applyQuaternion(this.boatQuaternion).add(this.boatPosition);
        return this.playerWorld.distanceTo(helmWorld) < 2.8;
    }

    private isNearBoatLadder() {
        const ladderWorld = new THREE.Vector3(-2.5, 1.0, 9.5).applyQuaternion(this.boatQuaternion).add(this.boatPosition);
        return this.playerWorld.distanceTo(ladderWorld) < 2.5;
    }

    private isOnDeck() {
        const local = this.playerWorld.clone().sub(this.boatPosition).applyQuaternion(this.boatQuaternion.clone().invert());
        return Math.abs(local.x) < 2.4 && local.z > -10.5 && local.z < 10.5 && local.y > 3.0 && local.y < 5.2;
    }

    private sampleDeckHeight() {
        const lz = this.playerLocal.z;
        // Fore/aft elevated decks at y=2.44, main deck at y=2.04
        const deckY = (lz > 4.5 || lz < -4.4) ? 2.44 : 2.04;
        return new THREE.Vector3(this.playerLocal.x, deckY, lz)
            .applyQuaternion(this.boatQuaternion)
            .add(this.boatPosition).y;
    }

    private onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

new OceanEngine();
