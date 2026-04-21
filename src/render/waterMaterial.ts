import { NodeMaterial } from 'three/webgpu';
import {
    uniform,
    uniformArray,
    vec3,
    vec4,
    float,
    sin,
    cos,
    sqrt,
    dot,
    normalize,
    mix,
    pow,
    max,
    positionWorld,
    normalWorld,
    cameraPosition,
    time,
    wgslFn
} from 'three/tsl';
import * as THREE from 'three';
import type { WaveDefinition } from '../game/types';

// Define the Gerstner node
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
            waveData.map((wave) => {
                if (wave.direction instanceof THREE.Vector2) {
                    return wave.direction;
                }

                const direction = wave.direction as { x: number; y: number };
                return new THREE.Vector2(direction.x, direction.y);
            }),
            'vec2'
        );
        const steepnesses = uniformArray(waveData.map((wave) => wave.steepness), 'float');
        const wavelengths = uniformArray(waveData.map((wave) => wave.wavelength), 'float');
        const speeds = uniformArray(waveData.map((wave) => wave.speed), 'float');
        const t = time;

        const p = positionWorld.xz;
        let finalPos = positionWorld;

        // Sum waves using uniform arrays so the node graph stays compatible with Three r184.
        for (let i = 0; i < waveData.length; i++) {
            finalPos = finalPos.add(
                gerstnerWave(
                    p,
                    directions.element(i),
                    steepnesses.element(i),
                    wavelengths.element(i),
                    speeds.element(i),
                    t
                )
            );
        }

        this.positionNode = finalPos;

        const deepColor = uniform(vec3(0.039, 0.180, 0.290)); // #0a2e4a
        const shallowColor = uniform(vec3(0.118, 0.565, 0.690)); // #1e90b0

        const oceanColorFn = wgslFn(`
            fn getOceanColor(worldPos: vec3f, camPos: vec3f, n: vec3f, deep: vec3f, shallow: vec3f) -> vec3f {
                let viewDir = normalize(camPos - worldPos);
                let dist = distance(camPos, worldPos);
                let depth = clamp(dist * 0.015, 0.0, 1.0);
                let base = mix(shallow, deep, depth);
                let fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);
                return mix(base, vec3f(0.7, 0.85, 1.0), fresnel * 0.4);
            }
        `);

        this.colorNode = oceanColorFn({
            worldPos: positionWorld,
            camPos: cameraPosition,
            n: normalWorld,
            deep: deepColor,
            shallow: shallowColor
        });
    }
}
