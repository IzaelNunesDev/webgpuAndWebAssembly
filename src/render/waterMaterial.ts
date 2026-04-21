import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    uniform,
    uniformArray,
    vec3,
    color,
    float,
    sin,
    cos,
    dot,
    clamp,
    mix,
    smoothstep,
    positionWorld,
    positionLocal,
    normalWorld,
    cameraPosition,
    time,
} from 'three/tsl';
import * as THREE from 'three';
import type { WaveDefinition } from '../game/types';

const OCEAN_DEPTH = 10.0; // metres — must match ocean.rs / oceanFallback.ts

// Gerstner displacement — wave speed includes shallow-water tanh correction.
// tanhC  = precomputed sqrt(9.81/k * tanh(k*depth)) * speed  (constant per wave)
const gerstnerWave = (pos: any, direction: any, steepness: any, k: any, tanhC: any, t: any) => {
    const f = k.mul(dot(direction, pos).sub(tanhC.mul(t)));
    const a = steepness.div(k);
    return vec3(
        direction.x.mul(a).mul(cos(f)),
        a.mul(sin(f)),
        direction.y.mul(a).mul(cos(f))
    );
};

export class OceanMaterial extends MeshStandardNodeMaterial {
    constructor(waveData: WaveDefinition[]) {
        super({
            roughness: 0.08,
            metalness: 0.1,
            transparent: true,
            opacity: 1.0
        });

        // ── Per-wave uniforms ────────────────────────────────────────────────────
        const directions = uniformArray(
            waveData.map(w => {
                if (w.direction instanceof THREE.Vector2) return w.direction;
                const d = w.direction as { x: number; y: number };
                return new THREE.Vector2(d.x, d.y);
            }),
            'vec2'
        );
        const steepnesses = uniformArray(waveData.map(w => w.steepness), 'float');

        // k = 2π/λ
        const ks = uniformArray(
            waveData.map(w => (2 * Math.PI) / w.wavelength),
            'float'
        );

        // c = sqrt(9.81/k · tanh(k·depth)) · speed  — computed CPU-side once
        const tanhCs = uniformArray(
            waveData.map(w => {
                const k = (2 * Math.PI) / w.wavelength;
                return Math.sqrt(9.81 / k * Math.tanh(k * OCEAN_DEPTH)) * w.speed;
            }),
            'float'
        );

        // ── Vertex displacement ──────────────────────────────────────────────────
        const p = positionWorld.xz;
        let finalPos = positionWorld;
        for (let i = 0; i < waveData.length; i++) {
            finalPos = finalPos.add(
                gerstnerWave(
                    p,
                    directions.element(i),
                    steepnesses.element(i),
                    ks.element(i),
                    tanhCs.element(i),
                    time
                )
            );
        }
        this.positionNode = finalPos;

        // ── Jacobian — compression metric for breaking-wave foam ─────────────────
        let jacobian: any = float(1.0);
        for (let i = 0; i < waveData.length; i++) {
            const ki  = ks.element(i)         as any;
            const ci  = tanhCs.element(i)     as any;
            const si  = steepnesses.element(i) as any;
            const di  = directions.element(i)  as any;
            const fi  = ki.mul(dot(di, p).sub(ci.mul(time)));
            jacobian  = jacobian.sub(si.mul(cos(fi)));
        }

        // ── Cores e Profundidade (Estilo Sea of Thieves) ────────────────────────
        const deepOceanColor = color('#051c2e'); // Azul marinho escuro
        const shallowWaterColor = color('#0bb9d1'); // Ciano tropical brilhante
        const foamColor = color('#f0f8ff'); // Branco levemente azulado
        const sssColor = color('#149684'); // Ciano profundo para espelhamento nas cristas

        // 1. Cor baseada na Altura da Onda (Y)
        const heightFactor = smoothstep(-2.0, 2.0, positionLocal.y);
        const waterBaseColor = mix(deepOceanColor, shallowWaterColor, heightFactor);

        // 2. Fresnel (Cor muda conforme o ângulo da câmera)
        const viewDir = cameraPosition.sub(positionWorld).normalize();
        const fresnel = smoothstep(0.0, 1.0, float(1.0).sub(dot(normalWorld, viewDir)).pow(4.0));
        
        // Mistura a cor base com uma tonalidade mais clara/verde no horizonte/ângulo raso
        const colorWithFresnel = mix(waterBaseColor, shallowWaterColor.mul(1.2), fresnel.mul(0.5));

        // 3. Subsurface Scattering (SSS) nas cristas
        const sunDir = uniform(new THREE.Vector3(0.55, 0.70, -0.45).normalize());
        const sssFactor = dot(sunDir, normalWorld).max(0.0).mul(positionLocal.y.max(0.0).mul(0.2));
        const colorWithSSS = colorWithFresnel.add(sssColor.mul(sssFactor));

        // 4. Adicionando o Jacobiano (Espuma)
        const foamFactor = smoothstep(0.4, 0.0, jacobian); 
        const finalColor = mix(colorWithSSS, foamColor, foamFactor);

        this.colorNode = finalColor;

        // ── Especulares e Transparência Adicionais ───────────────────────────────
        const distToCam = cameraPosition.sub(positionWorld).length();
        this.opacityNode = clamp(distToCam.mul(0.008).mul(float(0.98 - 0.82)).add(float(0.82)), float(0.8), float(1.0)) as any;
    }
}

