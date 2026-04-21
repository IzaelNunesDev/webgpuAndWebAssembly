mod ocean;
mod physics;

use wasm_bindgen::prelude::*;
use crate::ocean::Ocean;
use crate::physics::PhysicsEngine;

// 120 Hz physics — smooth even on 60 fps displays
const FIXED_DT: f64 = 1.0 / 120.0;

#[wasm_bindgen]
pub struct GameState {
    ocean:       Ocean,
    physics:     PhysicsEngine,
    time:        f64,
    accumulator: f64,
}

#[wasm_bindgen]
impl GameState {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let ocean   = Ocean::new();
        let physics = PhysicsEngine::new(&ocean);
        GameState {
            ocean,
            physics,
            time:        0.0,
            accumulator: 0.0,
        }
    }

    /// Called every JS frame with the real wall-clock delta.
    /// Consumes dt in fixed-size slices so forces are always integrated at FIXED_DT,
    /// regardless of browser frame rate or jank.  Capped at 0.1 s to prevent
    /// the spiral-of-death after a tab is backgrounded.
    pub fn step(&mut self, dt: f64) {
        self.accumulator += dt.min(0.1);
        while self.accumulator >= FIXED_DT {
            self.physics.step_fixed(FIXED_DT, &self.ocean, self.time);
            self.time        += FIXED_DT;
            self.accumulator -= FIXED_DT;
        }
    }

    pub fn set_ship_controls(&mut self, throttle: f64, rudder: f64, sail: f64, anchor: bool) {
        self.physics.set_controls(throttle, rudder, sail, anchor);
    }

    pub fn spawn_player(&mut self, x: f64, y: f64, z: f64) {
        self.physics.spawn_player(x, y, z);
    }

    pub fn set_player_input(&mut self, x: f64, y: f64, z: f64) {
        self.physics.set_player_input(x, y, z);
    }

    pub fn get_player_state(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.physics.get_player_state()).unwrap()
    }

    pub fn get_boat_state(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.physics.get_boat_state()).unwrap()
    }

    pub fn sample_ocean(&self, x: f64, z: f64) -> JsValue {
        serde_wasm_bindgen::to_value(&self.ocean.sample(x, z, self.time)).unwrap()
    }
}
