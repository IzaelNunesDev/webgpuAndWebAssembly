mod ocean;
mod physics;

use wasm_bindgen::prelude::*;
use crate::ocean::Ocean;
use crate::physics::PhysicsEngine;

#[wasm_bindgen]
pub struct GameState {
    ocean: Ocean,
    physics: PhysicsEngine,
    time: f64,
}

#[wasm_bindgen]
impl GameState {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let ocean = Ocean::new();
        let physics = PhysicsEngine::new(&ocean);
        GameState {
            ocean,
            physics,
            time: 0.0,
        }
    }

    pub fn step(&mut self, dt: f64) {
        self.time += dt;
        self.physics.step(dt, &self.ocean, self.time);
    }

    pub fn set_ship_controls(&mut self, throttle: f64, rudder: f64, sail: f64, anchor: bool) {
        self.physics.set_controls(throttle, rudder, sail, anchor);
    }

    pub fn get_boat_state(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.physics.get_boat_state()).unwrap()
    }

    pub fn sample_ocean(&self, x: f64, z: f64) -> JsValue {
        serde_wasm_bindgen::to_value(&self.ocean.sample(x, z, self.time)).unwrap()
    }
}
