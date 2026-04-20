import * as THREE from 'three';
import type { WaveDefinition } from './types';

export const DEFAULT_WAVES: WaveDefinition[] = [
    { direction: new THREE.Vector2(1.0, 0.0).normalize(), steepness: 0.18, wavelength: 26.0, speed: 0.92 },
    { direction: new THREE.Vector2(0.92, 0.18).normalize(), steepness: 0.15, wavelength: 18.0, speed: 1.03 },
    { direction: new THREE.Vector2(0.76, 0.42).normalize(), steepness: 0.12, wavelength: 14.0, speed: 1.12 },
    { direction: new THREE.Vector2(0.54, 0.62).normalize(), steepness: 0.11, wavelength: 10.5, speed: 1.2 },
    { direction: new THREE.Vector2(0.28, 0.82).normalize(), steepness: 0.1, wavelength: 8.5, speed: 1.28 },
    { direction: new THREE.Vector2(-0.08, 1.0).normalize(), steepness: 0.08, wavelength: 6.5, speed: 1.35 },
];
