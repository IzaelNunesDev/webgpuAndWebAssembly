import { NodeMaterial } from 'three/webgpu';
import {
    uniform,
    uniformArray,
    vec3,
    float,
    sin,
    cos,
    sqrt,
    dot,
    mix,
    clamp,
    positionWorld,
    normalWorld,
    cameraPosition,
    time,
    wgslFn,
} from 'three/tsl';
import * as THREE from 'three';
import type { WaveDefinition } from '../game/types';

// Gerstner wave displacement node
const gerstnerWave = (pos: any, direction: any, steepness: any, wavelength: any, speed: any, t: any) => {
    const k = float(2.0 * 3.14159).div(wavelength);
    const c = sqrt(float(9.81).div(k)).mul(speed);
    const f = k.mul(dot(direction, pos).sub(c.mul(t)));
    const a = steepness.div(k);
    return vec3(
        direction.x.mul(a).mul(cos(f)),
        a.mul(sin(f)),
        direction.y.mul(a).mul(cos(f))
    );
};

export class OceanMaterial extends NodeMaterial {
    constructor(waveData: WaveDefinition[]) {
        super();

        const directions = uniformArray(
            waveData.map(w => {
                if (w.direction instanceof THREE.Vector2) return w.direction;
                const d = w.direction as { x: number; y: number };
                return new THREE.Vector2(d.x, d.y);
            }),
            'vec2'
        );
        const steepnesses = uniformArray(waveData.map(w => w.steepness), 'float');
        const wavelengths  = uniformArray(waveData.map(w => w.wavelength), 'float');
        const speeds       = uniformArray(waveData.map(w => w.speed), 'float');

        // Vertex displacement
        const p = positionWorld.xz;
        let finalPos = positionWorld;
        for (let i = 0; i < waveData.length; i++) {
            finalPos = finalPos.add(
                gerstnerWave(
                    p,
                    directions.element(i),
                    steepnesses.element(i),
                    wavelengths.element(i),
                    speeds.element(i),
                    time
                )
            );
        }
        this.positionNode = finalPos;

        // Color uniforms
        const deepColor    = uniform(vec3(0.02, 0.10, 0.22));
        const shallowColor = uniform(vec3(0.05, 0.38, 0.55));
        const foamColor    = uniform(vec3(0.88, 0.94, 1.00));
        const sunDir       = uniform(new THREE.Vector3(0.55, 0.70, -0.45).normalize());
        const sunColor     = uniform(vec3(1.0, 0.97, 0.88));

        const colorFn = wgslFn(`
            fn oceanColor(
                worldPos: vec3f,
                camPos:   vec3f,
                n:        vec3f,
                deep:     vec3f,
                shallow:  vec3f,
                foam:     vec3f,
                sun:      vec3f,
                sunCol:   vec3f,
                t:        f32
            ) -> vec3f {
                let viewDir = normalize(camPos - worldPos);
                let dist    = distance(camPos, worldPos);

                // Profundidade aparente — mais escuro ao longe
                let depth = clamp(dist * 0.012, 0.0, 1.0);
                var base  = mix(shallow, deep, depth);

                // Fresnel — horizonte fica mais reflexivo
                let nv      = max(dot(n, viewDir), 0.0);
                let fresnel = pow(1.0 - nv, 4.0);

                // Reflexo do céu
                let skyHoriz = vec3f(0.62, 0.82, 1.00);
                let skyZen   = vec3f(0.18, 0.44, 0.72);
                let skyRef   = mix(skyHoriz, skyZen, clamp(n.y, 0.0, 1.0));
                base = mix(base, skyRef, fresnel * 0.55);

                // Subsurface scattering nas cristas
                let sss    = max(0.0, dot(sun, n)) * max(0.0, worldPos.y * 0.18 + 0.1);
                let sssCol = vec3f(0.05, 0.55, 0.45);
                base = base + sssCol * sss * 0.35;

                // Especular principal (Blinn-Phong)
                let h1    = normalize(viewDir + sun);
                let spec1 = pow(max(dot(n, h1), 0.0), 160.0) * sunCol * 0.85;

                // Lóbulo largo (clarão difuso)
                let spec2 = pow(max(dot(n, h1), 0.0), 28.0) * sunCol * 0.10;

                // Espuma APENAS nas cristas mais altas (y > ~0.65)
                // O noise evita bordas retas artificiais
                let noiseOff = sin(worldPos.x * 1.4 + t * 0.9) * 0.08
                             + cos(worldPos.z * 1.7 + t * 0.7) * 0.06;
                let foamMask = smoothstep(0.62, 0.95, worldPos.y + noiseOff);

                // Filamentos finos de espuma (rastros de vento) — muito sutis
                let lace      = abs(sin(worldPos.x * 3.2 + t * 1.3) * cos(worldPos.z * 2.9 + t * 1.0));
                let laceFoam  = smoothstep(0.78, 0.95, lace) * 0.12 * foamMask;

                return base + spec1 + spec2 + foam * (foamMask * 0.18 + laceFoam);
            }
        `);

        this.colorNode = colorFn({
            worldPos: positionWorld,
            camPos:   cameraPosition,
            n:        normalWorld,
            deep:     deepColor,
            shallow:  shallowColor,
            foam:     foamColor,
            sun:      sunDir,
            sunCol:   sunColor,
            t:        time,
        }) as any;

        // Opacidade via TSL separada para evitar conflito de tipo
        const distToCam = cameraPosition.sub(positionWorld).length();
        this.opacityNode = clamp(mix(float(0.82), float(0.98), distToCam.mul(0.008)), float(0.8), float(1.0)) as any;
        this.transparent = true;
    }
}
