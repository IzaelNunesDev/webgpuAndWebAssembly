import { OceanSimulator } from './oceanFallback';
import type { PhysicsReady, PhysicsUpdate, ShipControlState } from '../game/types';

let state: any;
let simulator = new OceanSimulator();
let lastTime = performance.now();
let wasmEnabled = false;
let pendingControls: ShipControlState = { throttle: 0, rudder: 0, sail: 0.65, anchor: false };

self.onmessage = async (event) => {
    if (event.data.type === 'init') {
        const { wasmUrl } = event.data;

        try {
            const pkg = await import('../../wasm-pkg/ocean_wasm');
            await pkg.default(wasmUrl);
            state = new pkg.GameState();
            wasmEnabled = true;
        } catch (error) {
            console.error('Worker: fallback JS ativado', error);
            wasmEnabled = false;
        }

        const ready: PhysicsReady = { type: 'ready', isWasm: wasmEnabled };
        self.postMessage(ready);
        tick();
    }

    if (event.data.type === 'controls') {
        pendingControls = event.data.ship;
    }
};

function tick() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    if (wasmEnabled && state) {
        state.set_ship_controls(
            pendingControls.throttle,
            pendingControls.rudder,
            pendingControls.sail,
            pendingControls.anchor
        );
        state.step(dt);

        const boat = state.get_boat_state();
        const ocean = state.sample_ocean(boat.transform[0], boat.transform[2]);
        const message: PhysicsUpdate = {
            type: 'update',
            isWasm: true,
            boat,
            ocean,
            timestamp: now,
        };
        self.postMessage(message);
    } else {
        simulator.setControls(pendingControls);
        const result = simulator.step(dt);
        const message: PhysicsUpdate = {
            type: 'update',
            isWasm: false,
            boat: result.boat,
            ocean: result.ocean,
            timestamp: now,
        };
        self.postMessage(message);
    }

    setTimeout(tick, 1000 / 60);
}
