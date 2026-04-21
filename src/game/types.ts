import * as THREE from 'three';

export type ControlMode = 'onFoot' | 'shipHelm' | 'mastControl' | 'swimming' | 'freeCamera' | 'onNpcBoat' | 'npcHelm';

export type WaveDefinition = {
    amp: number;
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

export type PlayerState = {
    position: [number, number, number];
};

export type PlayerControlState = {
    move: [number, number, number];
};

export type PhysicsUpdate = {
    type: 'update';
    isWasm: boolean;
    boat: BoatState;
    player?: PlayerState;
    ocean: OceanSample;
    timestamp: number;
};

export type PhysicsReady = {
    type: 'ready';
    isWasm: boolean;
};

export type PhysicsMessage = PhysicsUpdate | PhysicsReady;
