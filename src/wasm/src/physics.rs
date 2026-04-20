use rapier3d_f64::prelude::*;
use serde::Serialize;
use crate::ocean::Ocean;

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

        let rigid_body = RigidBodyBuilder::dynamic()
            .translation(vector![0.0, 1.8, 0.0])
            .linear_damping(0.22)
            .angular_damping(0.8)
            .additional_mass(18000.0)
            .build();
        let boat_handle = rigid_body_set.insert(rigid_body);

        let hull = ColliderBuilder::cuboid(3.0, 1.1, 9.0)
            .density(120.0)
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
            controls: ShipControls { throttle: 0.0, rudder: 0.0, sail: 0.65, anchor: false },
        }
    }

    pub fn set_controls(&mut self, throttle: f64, rudder: f64, sail: f64, anchor: bool) {
        self.controls.throttle = throttle.clamp(-0.35, 1.2);
        self.controls.rudder = rudder.clamp(-1.0, 1.0);
        self.controls.sail = sail.clamp(0.0, 1.0);
        self.controls.anchor = anchor;
    }

    pub fn get_boat_state(&self) -> BoatState {
        let boat = &self.rigid_body_set[self.boat_handle];
        let pos = boat.translation();
        let rot = boat.rotation();
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
        let probes_x = [-2.4, -0.8, 0.8, 2.4];
        let probes_z = [-7.0, -2.5, 2.5, 7.0];

        for px in probes_x {
            for pz in probes_z {
                let local_point = point![px, -0.9, pz];
                let world_point = boat.position().transform_point(&local_point);
                let wave = ocean.sample(world_point.x, world_point.z, time);
                let depth = wave.height - world_point.y;

                if depth > 0.0 {
                    let buoyancy = (depth * 10500.0).min(42000.0);
                    let up_force = vector![
                        wave.normal[0] * buoyancy * 0.08,
                        buoyancy,
                        wave.normal[2] * buoyancy * 0.08
                    ];
                    boat.apply_impulse_at_point(up_force * dt, world_point, true);

                    let velocity = boat.velocity_at_point(&world_point);
                    boat.apply_impulse_at_point(-velocity * depth * 1.2 * dt, world_point, true);
                }
            }
        }

        let forward = boat.position().rotation * vector![0.0, 0.0, -1.0];
        let speed = boat.linvel().norm();
        let anchor_drag = if self.controls.anchor { 8.0 } else { 1.0 };
        let sail_factor = 0.4 + self.controls.sail * 0.6;
        let drive_force = 68000.0 * self.controls.throttle * sail_factor;

        boat.apply_impulse(forward * drive_force * dt, true);
        boat.apply_impulse(-boat.linvel() * (0.28 + anchor_drag * 0.35) * dt, true);
        boat.apply_torque_impulse(vector![0.0, self.controls.rudder * speed * 0.08 * 16000.0 * dt, 0.0], true);
        boat.apply_torque_impulse(-boat.angvel() * (0.9 + anchor_drag * 0.8) * dt, true);

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
