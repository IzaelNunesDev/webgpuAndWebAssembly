use rapier3d_f64::prelude::*;
use serde::Serialize;
use crate::ocean::Ocean;

// Wind blowing toward ESE — matches JS constant in waves.ts
const WIND_X: f64 = 0.85;
const WIND_Z: f64 = 0.30;
const WIND_SPEED: f64 = 7.0;

#[derive(Clone, Copy, Default, Serialize)]
pub struct ShipControls {
    pub throttle: f64,
    pub rudder: f64,
    pub sail: f64,
    pub anchor: bool,
}

#[derive(Serialize)]
pub struct BoatState {
    pub transform: [f64; 7],
    pub speed: f64,
    pub helm: ShipControls,
}

pub struct PhysicsEngine {
    pub rigid_body_set: RigidBodySet,
    pub collider_set: ColliderSet,
    pub integration_parameters: IntegrationParameters,
    pub physics_pipeline: PhysicsPipeline,
    pub island_manager: IslandManager,
    pub broad_phase: DefaultBroadPhase,
    pub narrow_phase: NarrowPhase,
    pub impulse_joint_set: ImpulseJointSet,
    pub multibody_joint_set: MultibodyJointSet,
    pub ccd_solver: CCDSolver,
    pub gravity: Vector<f64>,
    pub boat_handle: RigidBodyHandle,
    controls: ShipControls,
}

impl PhysicsEngine {
    pub fn new() -> Self {
        let mut rigid_body_set = RigidBodySet::new();
        let mut collider_set = ColliderSet::new();
        let gravity = vector![0.0, -9.81, 0.0];

        // Start near hydrostatic equilibrium so the boat doesn't free-fall into water.
        // With probes at local y=-1.5 and buoyancy_k=8500:
        //   equilibrium: 16 probes × 1.6m depth × 8500 ≈ 217,600 N ≈ 22,000kg × 9.81
        // → boat center at y = -0.1 (probes at world y = -1.6, 1.6m below waterline)
        let rigid_body = RigidBodyBuilder::dynamic()
            .translation(vector![0.0, -0.1, 0.0])
            .linear_damping(0.25)
            .angular_damping(3.5)   // strong resistance to pitch/roll/yaw
            .additional_mass(22000.0)
            .build();
        let boat_handle = rigid_body_set.insert(rigid_body);

        // Hull collider matches new 20m × 5m × 3.5m visual hull
        let hull = ColliderBuilder::cuboid(2.5, 1.75, 10.0)
            .density(80.0)
            .friction(0.8)
            .restitution(0.0)
            .build();
        collider_set.insert_with_parent(hull, boat_handle, &mut rigid_body_set);

        PhysicsEngine {
            rigid_body_set,
            collider_set,
            integration_parameters: IntegrationParameters::default(),
            physics_pipeline: PhysicsPipeline::new(),
            island_manager: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
            gravity,
            boat_handle,
            controls: ShipControls::default(),
        }
    }

    pub fn set_controls(&mut self, throttle: f64, rudder: f64, sail: f64, anchor: bool) {
        self.controls.throttle = throttle.clamp(-0.35, 1.2);
        self.controls.rudder   = rudder.clamp(-1.0, 1.0);
        self.controls.sail     = sail.clamp(0.0, 1.0);
        self.controls.anchor   = anchor;
    }

    pub fn get_boat_state(&self) -> BoatState {
        let boat   = &self.rigid_body_set[self.boat_handle];
        let pos    = boat.translation();
        let rot    = boat.rotation();
        let linvel = boat.linvel();

        BoatState {
            transform: [pos.x, pos.y, pos.z, rot.i, rot.j, rot.k, rot.w],
            speed: linvel.norm(),
            helm: self.controls,
        }
    }

    pub fn step(&mut self, dt: f64, ocean: &Ocean, time: f64) {
        self.integration_parameters.dt = dt.max(1.0 / 240.0);

        let boat = &mut self.rigid_body_set[self.boat_handle];

        // 4×4 buoyancy probes distributed across hull bottom (local y = -1.5)
        let probes_x: [f64; 4] = [-1.8, -0.6, 0.6, 1.8];
        let probes_z: [f64; 4] = [-8.5, -2.8, 2.8, 8.5];

        for px in probes_x {
            for pz in probes_z {
                let local_point = point![px, -1.5, pz];
                let world_point = boat.position().transform_point(&local_point);
                let wave = ocean.sample(world_point.x, world_point.z, time);
                let depth = wave.height - world_point.y;

                if depth > 0.0 {
                    // Pure upward buoyancy only — horizontal wave-normal forces cause tipping
                    let buoyancy = (depth * 8500.0).min(20000.0);
                    let up_force = vector![0.0, buoyancy, 0.0];
                    boat.apply_impulse_at_point(up_force * dt, world_point, true);

                    // Velocity damping at each probe (wave resistance)
                    let velocity = boat.velocity_at_point(&world_point);
                    boat.apply_impulse_at_point(-velocity * depth * 1.4 * dt, world_point, true);
                }
            }
        }

        // Wind-driven propulsion: throttle carries JS-computed sail×wind_efficiency (0–1)
        let forward = boat.position().rotation * vector![0.0, 0.0, -1.0];
        let speed   = boat.linvel().norm();

        // Wind sailing: compute thrust from wind angle relative to bow
        let wind_dot_fwd = WIND_X * forward.x + WIND_Z * forward.z;
        let t = (wind_dot_fwd + 1.0) * 0.5; // 0=headwind, 0.5=reaching, 1=tailwind
        let thrust_coeff = if t < 0.15 {
            0.0
        } else {
            0.25 + (t * std::f64::consts::PI).sin() * 0.75
        };
        let sail_force = 72000.0 * self.controls.sail * thrust_coeff;
        boat.apply_impulse(forward * sail_force * dt, true);

        // Hull drag — proportional to velocity squared approximation
        let anchor_drag = if self.controls.anchor { 8.0 } else { 1.0 };
        boat.apply_impulse(-boat.linvel() * (0.28 + anchor_drag * 0.35) * dt, true);

        // Rudder / boom steering torque (uses wind force at low speed)
        let wind_force = self.controls.sail * thrust_coeff * WIND_SPEED;
        let turn_force = self.controls.rudder * (speed * 0.08 + wind_force * 0.07) * 16000.0;
        boat.apply_torque_impulse(vector![0.0, turn_force * dt, 0.0], true);

        // Yaw damping (separate from pitch/roll to allow turning)
        let angvel = *boat.angvel();
        boat.apply_torque_impulse(vector![0.0, -angvel.y * (0.9 + anchor_drag * 0.8) * 16000.0 * dt, 0.0], true);

        // Strong pitch/roll righting moment — prevents tipping
        boat.apply_torque_impulse(vector![
            -angvel.x * 18000.0 * dt,
            0.0,
            -angvel.z * 18000.0 * dt,
        ], true);

        self.physics_pipeline.step(
            &self.gravity,
            &self.integration_parameters,
            &mut self.island_manager,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.rigid_body_set,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            &mut self.ccd_solver,
            None,
            &(),
            &(),
        );
    }
}
