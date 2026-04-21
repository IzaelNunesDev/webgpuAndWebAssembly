import * as THREE from 'three';
import { WebGPURenderer, MeshStandardNodeMaterial } from 'three/webgpu';
import { InputController } from './game/input';
import { Hud } from './game/hud';
import type { BoatState, ControlMode, PhysicsMessage, ShipControlState } from './game/types';
import { DEFAULT_WAVES, WIND } from './game/waves';
import { OceanMaterial } from './render/waterMaterial';
import { hullMaterial, hullWaterLevel } from './render/hullMaterial';
import { createRig, updateRig } from './game/sails';
import { AvatarController } from './game/avatar';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import './style.css';

type RendererLike = {
    domElement: HTMLCanvasElement;
    setSize(width: number, height: number): void;
    init?(): Promise<void>;
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
    private readonly camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.04, 2000);
    private readonly renderer: RendererLike;
    private readonly input: InputController;
    private readonly hud = new Hud();
    private readonly worker = new Worker(new URL('./wasm/physicsWorker.ts', import.meta.url), { type: 'module' });
    private readonly timer = new THREE.Timer();
    private readonly playerVelocity = new THREE.Vector3();
    private readonly playerWorld = new THREE.Vector3(0, 4.3, 7.0);
    private readonly playerLocal = new THREE.Vector3(0, PLAYER_EYE_HEIGHT + 2.44, 7.0);
    private readonly boatQuaternion = new THREE.Quaternion();
    private readonly boatPosition = new THREE.Vector3();
    private readonly tmpForward = new THREE.Vector3();
    private readonly tmpRight = new THREE.Vector3();
    private readonly tmpMove = new THREE.Vector3();
    private readonly oceanSample = { height: 0, normal: [0, 1, 0] as [number, number, number], jacobian: 1 };
    private readonly shipControls: ShipControlState = { throttle: 0, rudder: 0, sail: 0.65, anchor: false };
    private readonly boatMesh: THREE.Group;
    private readonly oceanMesh: THREE.Mesh;
    private readonly avatar: AvatarController;
    private readonly helmMesh: THREE.Object3D | null;
    private readonly compassCanvas: HTMLCanvasElement;
    private readonly compassCtx: CanvasRenderingContext2D;
    private rig: ReturnType<typeof createRig>;
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
    private inWaterMode = false;
    private playerSpawned = false;
    private rudderTarget = 0;
    private rudderCurrent = 0;
    // Rastreia o delta do barco para ancorar o jogador ao barco
    private readonly prevBoatPos = new THREE.Vector3();
    private readonly prevBoatQ   = new THREE.Quaternion();
    private boatDeltaReady = false;

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
        // Limpa quaisquer velas antigas em cache antes de criar o rig
        this.boatMesh.traverse(o => {
            if (o.name.includes('sail') || o.name.includes('Sail')) {
                o.visible = false;
                o.parent?.remove(o);
            }
        });
        this.rig = createRig(this.boatMesh);

        this.oceanMesh = this.createOcean();

        // Adiciona câmera à cena (necessário para avatar FPS se ancorar nela)
        this.scene.add(this.camera);
        this.avatar = new AvatarController(this.scene, this.camera);

        this.helmMesh = this.boatMesh.getObjectByName('helm') ?? null;

        this.compassCanvas = document.createElement('canvas');
        this.compassCanvas.width = 150;
        this.compassCanvas.height = 150;
        this.compassCanvas.style.cssText =
            'position:absolute;bottom:24px;right:24px;border-radius:50%;pointer-events:none;z-index:10;';
        document.body.appendChild(this.compassCanvas);
        this.compassCtx = this.compassCanvas.getContext('2d')!;

        this.setupScene();
        this.bindEvents();
        this.initWorker();
        this.start();
    }

    private async start() {
        if (this.renderer.init) await this.renderer.init();
        this.animate();
    }

    private createRenderer(): RendererLike {
        if ('gpu' in navigator) {
            this.hud.setRenderLabel('Three.js WebGPURenderer');
            const renderer = new WebGPURenderer({ antialias: true });
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.0;
            return renderer as unknown as RendererLike;
        }
        this.hud.setRenderLabel('Three.js WebGLRenderer');
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        return renderer;
    }

    private setupScene() {
        const ambient = new THREE.AmbientLight(0x8aaacc, 0.45);

        // Direção do sol — normalizada para usar no shader do céu também
        const SUN_DIR = new THREE.Vector3(80, 60, -40).normalize();

        const sun = new THREE.DirectionalLight(0xfff6e0, 3.2);
        sun.position.copy(SUN_DIR);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.near = 0.5;
        sun.shadow.camera.far = 400;
        sun.shadow.camera.left = -80;
        sun.shadow.camera.right = 80;
        sun.shadow.camera.top = 80;
        sun.shadow.camera.bottom = -80;
        sun.shadow.bias = -0.0005;

        const fill = new THREE.DirectionalLight(0x4488bb, 0.65);
        fill.position.set(-40, 10, 60);

        this.scene.add(ambient, sun, fill);

        const sky = this.setupEnvironment();

        // Nuvens volumétricas simples
        const cloudMat = new MeshStandardNodeMaterial({
            color: 0xf0f8ff, transparent: true, opacity: 0.88, roughness: 1,
        });
        for (let i = 0; i < 14; i++) {
            const cloud = new THREE.Group();
            const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
            const rr = 130 + Math.random() * 90;
            cloud.position.set(Math.cos(a) * rr, 60 + Math.random() * 35, Math.sin(a) * rr);
            for (let j = 0; j < 5; j++) {
                const blob = new THREE.Mesh(
                    new THREE.SphereGeometry(7 + Math.random() * 7, 7, 5),
                    cloudMat
                );
                blob.position.set(
                    (Math.random() - 0.5) * 16,
                    (Math.random() - 0.5) * 4,
                    (Math.random() - 0.5) * 10
                );
                cloud.add(blob);
            }
            this.scene.add(cloud);
        }

        this.scene.add(this.boatMesh, this.oceanMesh);
        this.camera.position.copy(this.playerWorld);
    }

    private createBoat() {
        const group = new THREE.Group();

        const matDark  = new THREE.MeshStandardMaterial({ color: '#5a3520', roughness: 0.75, metalness: 0.05 });
        const matMid   = new THREE.MeshStandardMaterial({ color: '#8b5c32', roughness: 0.85 });
        const matLight = new THREE.MeshStandardMaterial({ color: '#b07840', roughness: 0.9 });
        const matRope  = new THREE.MeshStandardMaterial({ color: '#c8a86a', roughness: 1.0 });
        void matDark;

        const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 20), hullMaterial);
        hull.castShadow = true;
        hull.receiveShadow = true;
        group.add(hull);

        const mainDeck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 12), matLight);
        mainDeck.position.set(0, 1.9, 0.5);
        mainDeck.receiveShadow = true;
        group.add(mainDeck);

        const foreDeck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 6.5), matLight);
        foreDeck.position.set(0, 2.3, -7.5);
        foreDeck.receiveShadow = true;
        group.add(foreDeck);

        const aftDeck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.28, 5.5), matLight);
        aftDeck.position.set(0, 2.3, 7.5);
        aftDeck.receiveShadow = true;
        group.add(aftDeck);

        const aftStep = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 0.6), matMid);
        aftStep.position.set(0, 2.05, 4.6);
        group.add(aftStep);
        const foreStep = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 0.6), matMid);
        foreStep.position.set(0, 2.05, -4.4);
        group.add(foreStep);

        const hatchRim = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 2.3), matMid);
        hatchRim.position.set(-0.5, 1.88, 1.8);
        group.add(hatchRim);
        const hatch = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.2, 1.9),
            new MeshStandardNodeMaterial({ color: '#1e100a', roughness: 0.9 })
        );
        hatch.position.set(-0.5, 1.96, 1.8);
        group.add(hatch);

        for (const side of [-1, 1] as const) {
            for (let z = -4.0; z <= 4.5; z += 2.2) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), matRope);
                post.position.set(side * 2.35, 2.42, z);
                post.castShadow = true;
                group.add(post);
            }
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 12), matRope);
            rail.position.set(side * 2.35, 2.89, 0.5);
            group.add(rail);
        }

        const helmPost = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.9, 8), matMid);
        helmPost.position.set(0, 2.74, 8.5);
        helmPost.castShadow = true;
        group.add(helmPost);

        // Spokes do volante
        const helmGroup = new THREE.Group();
        helmGroup.name = 'helm';
        helmGroup.position.set(0, 3.7, 8.5);
        helmGroup.rotation.x = Math.PI / 2 - 0.2;

        const rimMat = new THREE.MeshStandardMaterial({ color: '#c48d55', metalness: 0.15, roughness: 0.6 });
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.09, 8, 24), rimMat);
        rim.castShadow = true;
        helmGroup.add(rim);

        const spokeMat = new THREE.MeshStandardMaterial({ color: '#a0703a', roughness: 0.7 });
        for (let i = 0; i < 8; i++) {
            const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.72), spokeMat);
            const a = (i / 8) * Math.PI * 2;
            spoke.position.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0);
            spoke.rotation.z = a + Math.PI / 2;
            helmGroup.add(spoke);
        }
        // Hub central
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10), rimMat);
        hub.rotation.x = Math.PI / 2;
        helmGroup.add(hub);

        group.add(helmGroup);
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
                this.hud.setEngineLabel(
                    event.data.isWasm ? 'WASM (Rapier3D)' : 'JS (Fallback)',
                    event.data.isWasm ? 'active' : 'warning'
                );
                return;
            }
            if (event.data.type === 'update') {
                this.boatState = event.data.boat;
                this.oceanSample.height   = event.data.ocean.height;
                this.oceanSample.normal   = event.data.ocean.normal;
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

        if (!this.boatDeltaReady) {
            // Primeiro frame: inicializa sem delta
            this.boatPosition.set(x, y, z);
            this.boatQuaternion.set(qx, qy, qz, qw);
            this.prevBoatPos.copy(this.boatPosition);
            this.prevBoatQ.copy(this.boatQuaternion);
            this.boatDeltaReady = true;
        } else {
            const newPos = new THREE.Vector3(x, y, z);
            const newQ   = new THREE.Quaternion(qx, qy, qz, qw);

            // ── Aplica o deslocamento do barco ao jogador (onFoot) ──
            if (this.mode === 'onFoot') {
                // Translação: jogador segue o barco
                const dPos = newPos.clone().sub(this.prevBoatPos);
                this.playerWorld.add(dPos);

                // Rotação: jogador gira em torno do centro do barco
                const dQ = this.prevBoatQ.clone().invert().multiply(newQ);
                if (Math.abs(dQ.w) < 0.9999) {
                    const relativeToBoat = this.playerWorld.clone().sub(newPos);
                    relativeToBoat.applyQuaternion(dQ);
                    this.playerWorld.copy(relativeToBoat.add(newPos));
                }
            }

            this.boatPosition.copy(newPos);
            this.boatQuaternion.copy(newQ);
            this.prevBoatPos.copy(newPos);
            this.prevBoatQ.copy(newQ);
        }
        // As transformações do boatMesh agora são aplicadas com interpolação no loop animate/update 
        // para evitar o jitter visual entre os steps da física e a taxa de atualização do monitor.
    }

    private animate = () => {
        requestAnimationFrame(this.animate);
        this.timer.update();
        const dt = Math.min(this.timer.getDelta(), 0.033);
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
        this.input.endFrame();
    };

    private update(dt: number) {
        this.updateModeTransitions();
        this.updateLook();
        this.updatePlayer(dt);
        this.updateShipControls(dt);
        this.updateHelm(dt);
        this.updateWaterMode();
        this.syncAvatarState();
        this.avatar.update(dt);

        hullWaterLevel.value = this.oceanSample.height;

        // 3. Interpolação Visual (Smoothing) 
        // Suaviza o barco em direção aos dados brutos da física (LERP/SLERP)
        // Isso resolve o tremor visual (jitter) e dá sensação de peso.
        this.boatMesh.position.lerp(this.boatPosition, 0.15);
        this.boatMesh.quaternion.slerp(this.boatQuaternion, 0.15);

        updateRig(this.rig, this.shipControls.sail, this.boatMesh);
        this.drawCompass();
        this.pushControlsToWorker();
    }

    private updateWaterMode() {
        const inWater = this.camera.position.y < this.oceanSample.height + 0.3;

        if (inWater && !this.inWaterMode) {
            this.inWaterMode = true;
            this.mode = 'swimming';
            this.hud.setMode(this.mode);
            this.avatar.setState('swimming');
            this.scene.fog = new THREE.FogExp2(0x0a2e4a, 0.035);
            (this.renderer as any).toneMappingExposure = 0.45;

            if (!this.playerSpawned) {
                this.worker.postMessage({
                    type: 'spawnPlayer',
                    pos: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
                });
                this.playerSpawned = true;
            }
        } else if (!inWater && this.inWaterMode) {
            this.inWaterMode = false;
            if (this.mode === 'swimming') {
                this.mode = 'onFoot';
                this.hud.setMode(this.mode);
            }
            this.avatar.setState('deck');
            this.scene.fog = new THREE.FogExp2('#7aa8c4', 0.012);
            (this.renderer as any).toneMappingExposure = 1.0;
        }
    }

    private updateHelm(dt: number) {
        if (!this.helmMesh) return;
        // Gira o volante com o leme
        this.rudderTarget = this.shipControls.rudder;
        this.rudderCurrent = THREE.MathUtils.lerp(this.rudderCurrent, this.rudderTarget, dt * 6);
        // helmMesh.rotation.z é em torno do eixo do volante (já rodado x)
        this.helmMesh.rotation.z = -this.rudderCurrent * Math.PI * 0.6;
    }

    private drawCompass() {
        const ctx = this.compassCtx;
        const size = 150, cx = 75, cy = 75, r = 68;
        ctx.clearRect(0, 0, size, size);

        // Fundo
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(7,15,24,0.78)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(173,216,230,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Heading do barco
        const boatYaw = this.boatMesh.rotation.y;

        // Marcações e letras — rodam com o barco (mundo fixo, ponteiro fixo no topo)
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-boatYaw);

        // Ticks de 10 em 10 graus
        for (let i = 0; i < 36; i++) {
            const a = (i / 36) * Math.PI * 2;
            const major = i % 9 === 0;
            const inner = major ? r - 18 : r - 10;
            ctx.beginPath();
            ctx.moveTo(Math.sin(a) * inner, -Math.cos(a) * inner);
            ctx.lineTo(Math.sin(a) * (r - 3), -Math.cos(a) * (r - 3));
            ctx.strokeStyle = major ? 'rgba(173,216,230,0.9)' : 'rgba(173,216,230,0.3)';
            ctx.lineWidth = major ? 1.5 : 0.8;
            ctx.stroke();
        }

        // Cardeais
        const dirs = [
            { label: 'N', angle: 0,             color: '#ff5555' },
            { label: 'L', angle: Math.PI / 2,   color: '#aaccee' },
            { label: 'S', angle: Math.PI,        color: '#aaccee' },
            { label: 'O', angle: -Math.PI / 2,  color: '#aaccee' },
        ];
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const d of dirs) {
            const x = Math.sin(d.angle) * (r - 26);
            const y = -Math.cos(d.angle) * (r - 26);
            ctx.fillStyle = d.color;
            ctx.fillText(d.label, x, y);
        }
        ctx.restore();

        // Ponteiro fixo (indica proa do barco = sempre para cima)
        ctx.save();
        ctx.translate(cx, cy);
        // Norte do barco = para cima no ponteiro
        ctx.beginPath();
        ctx.moveTo(0, -(r - 20));
        ctx.lineTo(5, -(r - 36));
        ctx.lineTo(-5, -(r - 36));
        ctx.closePath();
        ctx.fillStyle = '#ffd06c';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, (r - 20));
        ctx.lineTo(4, (r - 36));
        ctx.lineTo(-4, (r - 36));
        ctx.closePath();
        ctx.fillStyle = 'rgba(173,216,230,0.5)';
        ctx.fill();

        // Ponto central
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#aaccee';
        ctx.fill();
        ctx.restore();

        // Graus no centro
        const deg = Math.round(((-boatYaw * 180 / Math.PI) % 360 + 360) % 360);
        ctx.fillStyle = '#f5fbff';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(deg + '°', cx, cy + 16);

        // Label de velocidade abaixo da bússola
        ctx.fillStyle = 'rgba(173,216,230,0.8)';
        ctx.font = '10px monospace';
        ctx.fillText(this.boatState.speed.toFixed(1) + ' m/s', cx, cy + 30);
    }

    /** Recalcula playerWorld a partir de playerLocal + transform atual do barco.
     *  Deve ser chamado SEMPRE que playerLocal é setado manualmente (ex: saindo do leme). */
    private snapPlayerToBoat() {
        this.playerWorld.copy(
            this.playerLocal.clone()
                .applyQuaternion(this.boatQuaternion)
                .add(this.boatPosition)
        );
        this.playerVelocity.set(0, 0, 0); // evita voar para longe com velocidade acumulada
    }

    private syncAvatarState() {
        const hasMoveInput =
            this.input.axis('KeyS', 'KeyW') !== 0 ||
            this.input.axis('KeyA', 'KeyD') !== 0;

        // Informa ao avatar se está em movimento (para animação de caminhada)
        this.avatar.moving = hasMoveInput && this.mode === 'onFoot';
        // Passa o ângulo do leme para os pulsos no volante
        this.avatar.rudder = this.rudderCurrent;

        // Estado visual dos braços por modo
        if (this.mode === 'shipHelm') {
            this.avatar.setState('helm');
        } else if (this.mode === 'swimming') {
            this.avatar.setState('swimming');
        } else {
            this.avatar.setState('deck');
        }
    }

    private updateModeTransitions() {
        if (this.input.triggered('KeyZ')) {
            this.mode = this.mode === 'freeCamera' ? 'onFoot' : 'freeCamera';
            this.hud.setMode(this.mode);
        }

        if (this.input.triggered('KeyE')) {
            if (this.mode === 'shipHelm') {
                this.mode = 'onFoot';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 2.44, 8.5);
                this.snapPlayerToBoat();          // ← FIX: sincroniza mundo com local
                this.hud.setMode(this.mode);
            } else if (this.mode === 'mastControl') {
                this.mode = 'onFoot';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 2.04, -1.5);
                this.snapPlayerToBoat();          // ← FIX
                this.hud.setMode(this.mode);
            } else if (this.mode === 'swimming' && this.isNearBoatLadder()) {
                this.mode = 'onFoot';
                this.inWaterMode = false;
                this.avatar.setState('deck');
                this.scene.fog = new THREE.FogExp2('#7aa8c4', 0.012);
                (this.renderer as any).toneMappingExposure = 1.0;
                this.playerLocal.set(-1.5, PLAYER_EYE_HEIGHT + 2.44, 9.0);
                this.snapPlayerToBoat();          // ← FIX
                this.hud.setMode(this.mode);
            } else if (this.isNearMast()) {
                this.mode = 'mastControl';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 2.04, -1.5);
                this.hud.setMode(this.mode);
            } else if (this.isNearHelm()) {
                this.mode = 'shipHelm';
                this.playerLocal.set(0, PLAYER_EYE_HEIGHT + 2.44, 8.5);
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
        const hasMoveInput = this.input.axis('KeyS', 'KeyW') !== 0 || this.input.axis('KeyA', 'KeyD') !== 0;
        const isSprinting = this.input.pressedNow('ShiftLeft') && hasMoveInput && this.mode === 'onFoot';
        const desiredFov = this.mode === 'shipHelm' ? 68 : (isSprinting ? 82 : 75);
        this.targetFov = THREE.MathUtils.lerp(this.targetFov, desiredFov, dt * 8);
        this.camera.fov = this.targetFov;
        this.camera.updateProjectionMatrix();

        if (this.mode === 'shipHelm') {
            // Usa boatMesh (suavizado) em vez de boatPosition (bruto) para evitar jitter na câmera
            const offset = new THREE.Vector3(0, PLAYER_EYE_HEIGHT + 2.44, 9.0).applyQuaternion(this.boatMesh.quaternion);
            this.camera.position.copy(this.boatMesh.position).add(offset);
            return;
        }

        if (this.mode === 'mastControl') {
            const offset = new THREE.Vector3(0, PLAYER_EYE_HEIGHT + 2.04, -1.5).applyQuaternion(this.boatMesh.quaternion);
            this.camera.position.copy(this.boatMesh.position).add(offset);
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
        const strafeAxis  = this.input.axis('KeyA', 'KeyD');
        this.tmpMove.copy(this.tmpForward).multiplyScalar(forwardAxis).add(this.tmpRight.multiplyScalar(strafeAxis));
        if (this.tmpMove.lengthSq() > 0) this.tmpMove.normalize().multiplyScalar(speed);

        if (this.mode === 'swimming') {
            // Natação simples — câmera move diretamente
            this.playerWorld.addScaledVector(this.tmpMove, dt);
            if (this.input.triggered('Space')) this.playerWorld.y += 1.0 * dt * 60;
            if (this.input.pressedNow('KeyC')) this.playerWorld.y -= 0.8 * dt * 60;
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

            const deckH = this.sampleDeckHeight() + PLAYER_EYE_HEIGHT;
            if (this.playerWorld.y < deckH) {
                this.playerWorld.y = deckH;
                this.playerVelocity.y = 0;
            }
        }

        if (this.mode !== 'swimming') {
            this.playerLocal.copy(
                this.playerWorld.clone().sub(this.boatPosition).applyQuaternion(this.boatQuaternion.clone().invert())
            );
        }

        if (this.mode === 'onFoot') {
            // Em vez de usar playerWorld diretamente (que sofre o "jump" da física), 
            // recalculamos a posição da câmera relativa ao mesh suavizado do barco.
            // Isso mantém o jogador visualmente fixo ao convés enquanto o barco balança suavemente.
            const visualWorldPos = this.playerLocal.clone()
                .applyQuaternion(this.boatMesh.quaternion)
                .add(this.boatMesh.position);
            this.camera.position.copy(visualWorldPos);
        } else {
            this.camera.position.copy(this.playerWorld);
        }

        // Head-bob ao caminhar
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
        // Q/E ajusta a vela em qualquer modo (exceto freeCamera)
        if (this.mode !== 'freeCamera') {
            if (this.input.triggered('KeyE') && this.mode !== 'shipHelm' && this.mode !== 'mastControl') {
                // E só ajusta vela em modo genérico (onFoot, swimming) se não for usar para mudar modo
                // (os modos já tratam E em updateModeTransitions)
            }
            if (this.input.triggered('BracketRight')) {
                this.shipControls.sail = Math.min(1.0, this.shipControls.sail + 0.1);
            }
            if (this.input.triggered('BracketLeft')) {
                this.shipControls.sail = Math.max(0.0, this.shipControls.sail - 0.1);
            }
        }

        this.shipControls.throttle = 0;

        if (this.mode === 'shipHelm') {
            this.shipControls.rudder = this.input.axis('KeyD', 'KeyA');
            if (this.input.triggered('KeyF')) {
                this.shipControls.anchor = !this.shipControls.anchor;
            }
        } else if (this.mode === 'mastControl') {
            // W/S contínuo, Q/E em degraus
            if (this.input.triggered('KeyQ')) {
                this.shipControls.sail = Math.max(0.0, this.shipControls.sail - 0.1);
            }
            const sailDelta = this.input.axis('KeyS', 'KeyW');
            this.shipControls.sail = THREE.MathUtils.clamp(this.shipControls.sail + sailDelta * dt * 0.8, 0, 1);
            this.shipControls.rudder = this.input.axis('KeyD', 'KeyA');
        } else {
            this.shipControls.rudder *= Math.max(0, 1 - dt * 3);
        }
    }

    private pushControlsToWorker() {
        const moveX = this.input.axis('KeyA', 'KeyD');
        const moveZ = this.input.axis('KeyW', 'KeyS');
        const moveY = this.input.triggered('Space') ? 1.0 : (this.input.pressedNow('KeyC') ? -1.0 : 0.0);
        this.worker.postMessage({
            type: 'controls',
            mode: this.mode,
            ship: this.shipControls,
            playerMove: [moveX, moveY, moveZ],
        });
    }

    private isNearMast() {
        const w = new THREE.Vector3(0, 2.0, -1.5).applyQuaternion(this.boatQuaternion).add(this.boatPosition);
        return this.playerWorld.distanceTo(w) < 4.0;
    }

    private isNearHelm() {
        const w = new THREE.Vector3(0, 3.7, 8.5).applyQuaternion(this.boatQuaternion).add(this.boatPosition);
        return this.playerWorld.distanceTo(w) < 2.8;
    }

    private isNearBoatLadder() {
        const w = new THREE.Vector3(-2.5, 1.0, 9.5).applyQuaternion(this.boatQuaternion).add(this.boatPosition);
        return this.playerWorld.distanceTo(w) < 2.5;
    }

    private isOnDeck() {
        const local = this.playerWorld.clone().sub(this.boatPosition).applyQuaternion(this.boatQuaternion.clone().invert());
        return Math.abs(local.x) < 2.4 && local.z > -10.5 && local.z < 10.5 && local.y > 3.0 && local.y < 5.2;
    }

    private sampleDeckHeight() {
        const lz = this.playerLocal.z;
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

    private setupEnvironment() {
        // Carrega um mapa de ambiente HDR para iluminação global e reflexos realistas
        const hdrUrl = 'https://threejs.org/examples/textures/equirectangular/blouberg_sunrise_2_1k.hdr';
        
        new RGBELoader().load(hdrUrl, (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.environment = texture;
            this.scene.background = texture;
            this.scene.backgroundBlurriness = 0.02; // Leve desfoque no fundo para profundidade
        });

        // O renderizador automaticamente usará a exposição e tomemapping definidos no construtor
        return null; 
    }
}

new OceanEngine();
