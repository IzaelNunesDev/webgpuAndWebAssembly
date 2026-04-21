import * as THREE from 'three';

export type AvatarState = 'deck' | 'swimming' | 'helm';

// ── Materiais ─────────────────────────────────────────────────────────────────
function mat(hex: string, rough: number, metal = 0) {
    return new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal, fog: false });
}
const M_SKIN    = mat('#c0785a', 0.72);   // pele bronzeada
const M_SLEEVE  = mat('#2c4870', 0.80);   // manga azul marinho
const M_CUFF    = mat('#e8e0d0', 0.75);   // punho de camisa branco
const M_GLOVE   = mat('#7a4e2d', 0.75);   // luva/couro da mão

// ── Helpers de geometria ──────────────────────────────────────────────────────
function cyl(rTop: number, rBot: number, h: number, segs: number, m: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs, 1), m);
    mesh.castShadow = false;
    return mesh;
}
function box(w: number, h: number, d: number, m: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.castShadow = false;
    return mesh;
}

// ── Estrutura de um braço ─────────────────────────────────────────────────────
interface ArmRig {
    root:     THREE.Group;   // âncora na câmera
    shoulder: THREE.Group;   // gira o braço inteiro (oscilação)
    elbow:    THREE.Group;   // dobra o antebraço
    wrist:    THREE.Group;   // inclina a mão / pulso
}

/**
 * Monta um braço FPS completo com manga, antebraço e mão.
 * side = -1 esquerdo, +1 direito.
 *
 * Layout espacial (espaço da câmera, FOV 75°, near 0.04):
 *   root    y ≈ -0.08, z ≈ -0.38  → ombro fica fora do topo da tela
 *   shoulder.rotation.x ≈ 1.4     → braço inclinado ~80° para frente
 *   elbow off-set                  → cotovelo a ~0.3 unidades de z
 *   hand end                       → mão visível no canto inferior da tela
 */
function buildArm(side: -1 | 1): ArmRig {
    const root = new THREE.Group();
    root.position.set(side * 0.30, -0.08, -0.38);

    // Ombro — inclina o braço em direção à câmera
    const shoulder = new THREE.Group();
    shoulder.rotation.x =  1.42;
    shoulder.rotation.z =  side * 0.10;
    root.add(shoulder);

    // ── Manga (braço superior) ── comprimento 0.30
    const sleeveUpper = cyl(0.052, 0.060, 0.30, 14, M_SLEEVE);
    sleeveUpper.position.y = -0.15;
    shoulder.add(sleeveUpper);

    // Cotovelo — ponto de articulação no fim da manga
    const elbow = new THREE.Group();
    elbow.position.y = -0.30;
    elbow.rotation.x = -0.50;   // dobra leve em repouso
    shoulder.add(elbow);

    // ── Antebraço (pele) ── mais fino que a manga
    const forearm = cyl(0.043, 0.052, 0.28, 14, M_SKIN);
    forearm.position.y = -0.14;
    elbow.add(forearm);

    // Punho (cuff da camisa) — anel decorativo
    const cuff = cyl(0.050, 0.050, 0.038, 14, M_CUFF);
    cuff.position.y = -0.27;
    elbow.add(cuff);

    // Pulso
    const wrist = new THREE.Group();
    wrist.position.y = -0.295;
    elbow.add(wrist);

    // ── Mão ──────────────────────────────────────────────────────────────
    // Dorso da mão
    const palm = box(0.095, 0.040, 0.115, M_GLOVE);
    palm.position.set(0, -0.020, 0);
    wrist.add(palm);

    // Palma (face inferior, pele)
    const palmInner = box(0.088, 0.030, 0.108, M_SKIN);
    palmInner.position.set(0, -0.035, 0);
    wrist.add(palmInner);

    // 4 dedos
    const fingerColors = [M_GLOVE, M_GLOVE, M_GLOVE, M_GLOVE];
    for (let i = 0; i < 4; i++) {
        const fingerLen = 0.052 - i * 0.003;
        const f = cyl(0.009, 0.011, fingerLen, 6, fingerColors[i]);
        f.position.set((i - 1.5) * 0.022, -(0.040 + fingerLen * 0.5), 0.024);
        f.rotation.x = 0.12;
        wrist.add(f);

        // Falange distal (ponta arredondada)
        const tip = new THREE.Mesh(
            new THREE.SphereGeometry(0.009, 5, 4),
            fingerColors[i]
        );
        tip.position.set((i - 1.5) * 0.022, -(0.040 + fingerLen), 0.024 + fingerLen * 0.08);
        wrist.add(tip);
    }

    // Polegar — diagonal
    const thumb = cyl(0.012, 0.014, 0.052, 6, M_SKIN);
    thumb.position.set(side * 0.060, -0.028, 0.012);
    thumb.rotation.z = side * 0.55;
    thumb.rotation.x = 0.20;
    wrist.add(thumb);

    return { root, shoulder, elbow, wrist };
}

// ── Controlador ──────────────────────────────────────────────────────────────
export class AvatarController {
    public  mesh   = new THREE.Group();
    public  state: AvatarState = 'deck';
    public  moving = false;
    public  rudder = 0;

    private L: ArmRig;
    private R: ArmRig;
    private t     = 0;
    private phase = 0;

    // Posições default dos roots (salvas para restaurar ao sair do leme)
    private readonly DEFAULT_L = new THREE.Vector3(-0.30, -0.08, -0.38);
    private readonly DEFAULT_R = new THREE.Vector3( 0.30, -0.08, -0.38);

    constructor(_scene: THREE.Scene, camera: THREE.Camera) {
        this.L = buildArm(-1);
        this.R = buildArm( 1);
        this.mesh.add(this.L.root, this.R.root);
        camera.add(this.mesh);
    }

    setState(next: AvatarState) {
        if (this.state === next) return;
        this.state = next;
        // Restaura posição dos ombros ao sair do leme
        if (next !== 'helm') {
            this.L.root.position.copy(this.DEFAULT_L);
            this.R.root.position.copy(this.DEFAULT_R);
        }
    }

    update(dt: number) {
        this.t     += dt;
        this.phase += dt;
        switch (this.state) {
            case 'deck':     this.animateDeck();  break;
            case 'swimming': this.animateSwim();  break;
            case 'helm':     this.animateHelm();  break;
        }
    }

    // ── Deck: idle + caminhada ────────────────────────────────────────────────
    private animateDeck() {
        const swing = this.moving
            ? Math.sin(this.phase * 3.6) * 0.20
            : Math.sin(this.t * 1.1) * 0.012;  // micro-oscilação idle

        const elbowBend = 0.50 + Math.abs(swing) * 0.20;

        this.L.shoulder.rotation.x =  1.42 + swing;
        this.R.shoulder.rotation.x =  1.42 - swing;
        this.L.shoulder.rotation.z = -0.10 + Math.sin(this.t * 0.9) * 0.018;
        this.R.shoulder.rotation.z =  0.10 - Math.sin(this.t * 0.9) * 0.018;
        this.L.elbow.rotation.x    = -elbowBend;
        this.R.elbow.rotation.x    = -elbowBend;

        // Mão levemente relaxada (pulso tombado para fora)
        this.L.wrist.rotation.z =  0.10;
        this.R.wrist.rotation.z = -0.10;
        this.L.wrist.rotation.x =  0.05;
        this.R.wrist.rotation.x =  0.05;

        this.mesh.position.y = this.moving
            ? Math.sin(this.t * 3.6) * 0.008
            : 0;
    }

    // ── Natação: crawl frontal alternado ─────────────────────────────────────
    private animateSwim() {
        const spd = 1.8;
        const lp  = this.t * spd;
        const rp  = lp + Math.PI;

        // Braço esquerdo: ciclo completo
        const lx = Math.cos(lp) * 0.95;
        this.L.shoulder.rotation.x = 1.42 + lx;
        this.L.shoulder.rotation.z = -0.14 + Math.sin(lp) * 0.22;
        this.L.elbow.rotation.x    = -0.50 - Math.max(0, Math.sin(lp + 0.5)) * 0.55;
        this.L.wrist.rotation.x    =  Math.sin(lp) * 0.18;
        this.L.wrist.rotation.z    = -Math.cos(lp) * 0.12;

        // Braço direito: fase oposta
        const rx = Math.cos(rp) * 0.95;
        this.R.shoulder.rotation.x = 1.42 + rx;
        this.R.shoulder.rotation.z =  0.14 - Math.sin(rp) * 0.22;
        this.R.elbow.rotation.x    = -0.50 - Math.max(0, Math.sin(rp + 0.5)) * 0.55;
        this.R.wrist.rotation.x    =  Math.sin(rp) * 0.18;
        this.R.wrist.rotation.z    =  Math.cos(rp) * 0.12;

        this.mesh.position.y = Math.sin(this.t * 1.8) * 0.015 - 0.03;
    }

    // ── Leme: braços estendidos, mãos no volante ──────────────────────────────
    private animateHelm() {
        // Avança os roots para alcançar o volante
        this.L.root.position.set(-0.23, -0.06, -0.50);
        this.R.root.position.set( 0.23, -0.06, -0.50);

        const grip = Math.sin(this.t * 0.7) * 0.022;
        const tilt = this.rudder * 0.28;

        // Ombros sobem e ficam mais fechados
        this.L.shoulder.rotation.x =  0.72;
        this.R.shoulder.rotation.x =  0.72;
        this.L.shoulder.rotation.z = -0.32;
        this.R.shoulder.rotation.z =  0.32;

        // Cotovelos semi-dobrados
        this.L.elbow.rotation.x = -0.72;
        this.R.elbow.rotation.x = -0.72;

        // Pulsos giram com o volante + pequena tensão de aperto
        this.L.wrist.rotation.z =  tilt + grip;
        this.R.wrist.rotation.z = -tilt - grip;
        this.L.wrist.rotation.x =  0.18 + grip * 0.3;
        this.R.wrist.rotation.x =  0.18 + grip * 0.3;
    }
}
