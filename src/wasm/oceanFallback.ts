import { DEFAULT_WAVES } from '../game/waves';
import type { BoatState, OceanSample, ShipControlState } from '../game/types';

export class OceanSimulator {
    time = 0;
    private boat = {
        x: 0,
        y: 1.8,
        z: 0,
        yaw: 0,
        vx: 0,
        vz: 0,
        vy: 0,
        yawVelocity: 0,
    };
    private helm: ShipControlState = { throttle: 0, rudder: 0, sail: 0.65, anchor: false };

    setControls(helm: ShipControlState) {
        this.helm = { ...helm };
    }

    step(dt: number) {
        this.time += dt;
        const forwardX = -Math.sin(this.boat.yaw);
        const forwardZ = -Math.cos(this.boat.yaw);
        const speed = Math.hypot(this.boat.vx, this.boat.vz);
        const sailFactor = 0.4 + this.helm.sail * 0.6;
        const thrust = this.helm.throttle * sailFactor * 7.5;
        const drag = this.helm.anchor ? 3.4 : 0.5;
        const turnRate = this.helm.rudder * speed * 0.08;

        this.boat.vx += forwardX * thrust * dt;
        this.boat.vz += forwardZ * thrust * dt;
        this.boat.vx *= Math.max(0, 1 - drag * dt);
        this.boat.vz *= Math.max(0, 1 - drag * dt);
        this.boat.yawVelocity = this.boat.yawVelocity * Math.max(0, 1 - 3.5 * dt) + turnRate * dt * 8;
        this.boat.yaw += this.boat.yawVelocity;

        this.boat.x += this.boat.vx * dt;
        this.boat.z += this.boat.vz * dt;

        const sample = this.sampleOcean(this.boat.x, this.boat.z);
        this.boat.y += (sample.height + 1.8 - this.boat.y) * Math.min(1, dt * 3);

        return {
            boat: this.getBoatState(),
            ocean: sample,
        };
    }

    getBoatState(): BoatState {
        const halfYaw = this.boat.yaw * 0.5;
        return {
            transform: [this.boat.x, this.boat.y, this.boat.z, 0, Math.sin(halfYaw), 0, Math.cos(halfYaw)],
            speed: Math.hypot(this.boat.vx, this.boat.vz),
            helm: { ...this.helm },
        };
    }

    sampleOcean(x: number, z: number): OceanSample {
        const center = this.displacement(x, z, this.time);
        const dx = this.displacement(x + 0.1, z, this.time);
        const dz = this.displacement(x, z + 0.1, this.time);

        const tangentX = {
            x: dx.x - center.x,
            y: dx.y - center.y,
            z: dx.z - center.z,
        };
        const tangentZ = {
            x: dz.x - center.x,
            y: dz.y - center.y,
            z: dz.z - center.z,
        };

        const normal = normalize(cross(tangentZ, tangentX));
        let jacobian = 1;

        for (const wave of DEFAULT_WAVES) {
            const k = (2 * Math.PI) / wave.wavelength;
            const c = Math.sqrt(9.81 / k) * wave.speed;
            const f = k * (wave.direction.x * x + wave.direction.y * z - c * this.time);
            const a = wave.steepness / k;
            jacobian -= k * a * Math.cos(f) * 0.08;
        }

        return {
            height: center.y,
            normal: [normal.x, Math.max(normal.y, 0.08), normal.z],
            jacobian,
        };
    }

    private displacement(x: number, z: number, time: number) {
        const point = { x, y: 0, z };

        for (const wave of DEFAULT_WAVES) {
            const k = (2 * Math.PI) / wave.wavelength;
            const c = Math.sqrt(9.81 / k) * wave.speed;
            const f = k * (wave.direction.x * x + wave.direction.y * z - c * time);
            const a = wave.steepness / k;

            point.x += wave.direction.x * a * Math.cos(f);
            point.y += a * Math.sin(f);
            point.z += wave.direction.y * a * Math.cos(f);
        }

        return point;
    }
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function normalize(v: { x: number; y: number; z: number }) {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}
