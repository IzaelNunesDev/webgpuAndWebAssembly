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
    time
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
        
        const deepColor = uniform(vec3(0.04,0.24,0.36));
        const shallowColor = uniform(vec3(0.16,0.63,0.72));
        
        const vDir = normalize(cameraPosition.sub(positionWorld));
        const nDir = normalWorld;
        
        const f0 = float(0.02);
        const fresnel = f0.add(float(1.0).sub(f0).mul(pow(float(1.0).sub(max(dot(nDir, vDir), 0.0)), 5.0)));
        
        this.colorNode = vec4(mix(deepColor, shallowColor, fresnel), 1.0);
    }
}
