import * as THREE from 'three';

export type ControlMode = 'onFoot' | 'shipHelm' | 'swimming' | 'freeCamera';

export type WaveDefinition = {
    direction: THREE.Vector2;
    steepness: number;
    wavelength: number;
    speed: number;
};

export type ShipControlState = {
    throttle: number;
    rudder: number;
    sail: number;
    anchor: boolean;
};

export type BoatState = {
    transform: [number, number, number, number, number, number, number];
    speed: number;
    helm: ShipControlState;
};

export type OceanSample = {
    height: number;
    normal: [number, number, number];
    jacobian: number;
};

export type PhysicsUpdate = {
    type: 'update';
    isWasm: boolean;
    boat: BoatState;
    ocean: OceanSample;
    timestamp: number;
};

export type PhysicsReady = {
    type: 'ready';
    isWasm: boolean;
};

export type PhysicsMessage = PhysicsUpdate | PhysicsReady;
