import { DEFAULT_WAVES, WIND } from '../game/waves';
import type { BoatState, OceanSample, ShipControlState } from '../game/types';

const PHYSICS_LAMBDA_MIN = 12;

export class OceanSimulator {
    time = 0;
    private boat = {
        x: 0,
        y: 0.1,   // center slightly above waterline so hull visually floats
        z: 0,
        yaw: 0,
        vx: 0,
        vz: 0,
        yawVelocity: 0,
        pitch: 0,
        roll: 0,
    };
    private helm: ShipControlState = { throttle: 0, rudder: 0, sail: 0, anchor: false };

    setControls(helm: ShipControlState) {
        this.helm = { ...helm };
    }

    step(dt: number) {
        this.time += dt;
        const forwardX = -Math.sin(this.boat.yaw);
        const forwardZ = -Math.cos(this.boat.yaw);
        const rightX = Math.cos(this.boat.yaw);
        const rightZ = -Math.sin(this.boat.yaw);
        const speed = Math.hypot(this.boat.vx, this.boat.vz);

        // Wind thrust: efficiency depends on angle between wind and bow
        const sailFactor = this.helm.sail;
        const windDotFwd = WIND.x * forwardX + WIND.z * forwardZ;
        // t=0: headwind (in irons), t=0.5: reaching (fastest), t=1: tailwind (slower)
        const t = (windDotFwd + 1) * 0.5;
        const thrustCoeff = t < 0.15 ? 0 : (0.25 + Math.sin(t * Math.PI) * 0.75);
        const accel = sailFactor * thrustCoeff * WIND.speed * 0.12;

        const drag = this.helm.anchor ? 1.5 : 0.143;
        this.boat.vx += forwardX * accel * dt;
        this.boat.vz += forwardZ * accel * dt;
        this.boat.vx *= Math.max(0, 1 - drag * dt);
        this.boat.vz *= Math.max(0, 1 - drag * dt);

        const newSpeed = Math.hypot(this.boat.vx, this.boat.vz);
        if (newSpeed > 5.5) {
            this.boat.vx = (this.boat.vx / newSpeed) * 5.5;
            this.boat.vz = (this.boat.vz / newSpeed) * 5.5;
        }

        // Steering: rudder field carries boom angle (-1..1)
        // Boom generates turn via sail force + rudder effect
        const windForce = sailFactor * thrustCoeff * WIND.speed;
        const turnRate = this.helm.rudder * (speed * 0.08 + windForce * 0.07);
        this.boat.yawVelocity = this.boat.yawVelocity * Math.max(0, 1 - 3.5 * dt) + turnRate * dt * 8;
        this.boat.yaw += this.boat.yawVelocity;

        this.boat.x += this.boat.vx * dt;
        this.boat.z += this.boat.vz * dt;

        // 4-probe buoyancy — only long waves (λ > 12m) drive pitch/roll
        const hFore = this.samplePhysicsHeight(this.boat.x + forwardX * 8, this.boat.z + forwardZ * 8);
        const hAft  = this.samplePhysicsHeight(this.boat.x - forwardX * 8, this.boat.z - forwardZ * 8);
        const hPort = this.samplePhysicsHeight(this.boat.x - rightX * 1.8,  this.boat.z - rightZ * 1.8);
        const hStbd = this.samplePhysicsHeight(this.boat.x + rightX * 1.8,  this.boat.z + rightZ * 1.8);

        const avgHeight = (hFore + hAft + hPort + hStbd) * 0.25;
        this.boat.y += (avgHeight + 0.1 - this.boat.y) * Math.min(1, dt * 3);

        // Pitch/roll with reduced sensitivity and slow convergence to avoid startup snap
        // Denominator 24/8 → max pitch ~3.5°, max roll ~8° before clamping
        const targetPitch = -(hFore - hAft) / 24;
        const targetRoll  = (hStbd - hPort) / 8.0;
        this.boat.pitch += (targetPitch - this.boat.pitch) * Math.min(1, dt * 2.5);
        this.boat.roll  += (targetRoll  - this.boat.roll)  * Math.min(1, dt * 2.5);
        this.boat.pitch = Math.max(-0.10, Math.min(0.10, this.boat.pitch));
        this.boat.roll  = Math.max(-0.10, Math.min(0.10, this.boat.roll));

        return {
            boat: this.getBoatState(),
            ocean: this.sampleOcean(this.boat.x, this.boat.z),
        };
    }

    getBoatState(): BoatState {
        const [qx, qy, qz, qw] = this.eulerYXZ(this.boat.yaw, this.boat.pitch, this.boat.roll);
        return {
            transform: [this.boat.x, this.boat.y, this.boat.z, qx, qy, qz, qw],
            speed: Math.hypot(this.boat.vx, this.boat.vz),
            helm: { ...this.helm },
        };
    }

    sampleOcean(x: number, z: number): OceanSample {
        const center = this.displacement(x, z, this.time);
        const dx = this.displacement(x + 0.1, z, this.time);
        const dz = this.displacement(x, z + 0.1, this.time);

        const tangentX = { x: dx.x - center.x, y: dx.y - center.y, z: dx.z - center.z };
        const tangentZ = { x: dz.x - center.x, y: dz.y - center.y, z: dz.z - center.z };
        const normal = normalize(cross(tangentZ, tangentX));

        let jacobian = 1;
        for (const wave of DEFAULT_WAVES) {
            const k = (2 * Math.PI) / wave.wavelength;
            const c = Math.sqrt(9.81 / k) * wave.speed;
            const f = k * (wave.direction.x * x + wave.direction.y * z - c * this.time);
            jacobian -= k * (wave.steepness / k) * Math.cos(f) * 0.08;
        }

        return {
            height: center.y,
            normal: [normal.x, Math.max(normal.y, 0.08), normal.z],
            jacobian,
        };
    }

    private samplePhysicsHeight(x: number, z: number): number {
        let y = 0;
        for (const wave of DEFAULT_WAVES) {
            if (wave.wavelength < PHYSICS_LAMBDA_MIN) continue;
            const k = (2 * Math.PI) / wave.wavelength;
            const c = Math.sqrt(9.81 / k) * wave.speed;
            const f = k * (wave.direction.x * x + wave.direction.y * z - c * this.time);
            y += (wave.steepness / k) * Math.sin(f);
        }
        return y;
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

    // Intrinsic YXZ Euler → quaternion (xyzw)
    private eulerYXZ(yaw: number, pitch: number, roll: number): [number, number, number, number] {
        const cy = Math.cos(yaw * 0.5),   sy = Math.sin(yaw * 0.5);
        const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
        const cr = Math.cos(roll * 0.5),  sr = Math.sin(roll * 0.5);
        return [
            cy * sp * cr + sy * cp * sr,
            sy * cp * cr - cy * sp * sr,
            cy * cp * sr - sy * sp * cr,
            cy * cp * cr + sy * sp * sr,
        ];
    }
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(v: { x: number; y: number; z: number }) {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}
