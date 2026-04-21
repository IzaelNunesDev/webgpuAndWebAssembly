import * as THREE from 'three';
import type { WaveDefinition } from './types';

// Wind blowing toward ~East-Southeast
export const WIND = { x: 0.85, z: 0.30, speed: 7.0 };

export const DEFAULT_WAVES: WaveDefinition[] = [
    { amp: 1.2, wavelength: 80, steepness: 0.25, direction: new THREE.Vector2(1.0, 0.8).normalize(), speed: 0.92 },
    { amp: 0.8, wavelength: 45, steepness: 0.22, direction: new THREE.Vector2(-0.7, 0.6).normalize(), speed: 1.03 },
    { amp: 0.5, wavelength: 25, steepness: 0.18, direction: new THREE.Vector2(0.3, -0.9).normalize(), speed: 1.12 },
    { amp: 0.3, wavelength: 15, steepness: 0.15, direction: new THREE.Vector2(-0.5, -0.4).normalize(), speed: 1.2 },
];
