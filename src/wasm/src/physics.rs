use rapier3d_f64::prelude::*;
use serde::Serialize;
use crate::ocean::Ocean;

const WIND_X: f64 = 0.85;
const WIND_Z: f64 = 0.30;
const WIND_SPEED: f64 = 7.0;

#[derive(Clone, Copy, Default, Serialize)]
pub struct ShipControls {
    pub throttle: f64,
    pub rudder:   f64,
    pub sail:     f64,
    pub anchor:   bool,
}

#[derive(Serialize)]
pub struct BoatState {
    pub transform: [f64; 7],
    pub speed:     f64,
    pub helm:      ShipControls,
}

#[derive(Serialize)]
pub struct PlayerState {
    pub position: [f64; 3],
}

pub struct PhysicsEngine {
    pub rigid_body_set:       RigidBodySet,
    pub collider_set:         ColliderSet,
    pub integration_parameters: IntegrationParameters,
    pub physics_pipeline:     PhysicsPipeline,
    pub island_manager:       IslandManager,
    pub broad_phase:          DefaultBroadPhase,
    pub narrow_phase:         NarrowPhase,
    pub impulse_joint_set:    ImpulseJointSet,
    pub multibody_joint_set:  MultibodyJointSet,
    pub ccd_solver:           CCDSolver,
    pub gravity:              Vector<f64>,
    pub boat_handle:          RigidBodyHandle,
    pub player_handle:        Option<RigidBodyHandle>,
    controls:     ShipControls,
    player_input: Vector<f64>,
}

impl PhysicsEngine {
    pub fn new(ocean: &Ocean) -> Self {
        let mut rigid_body_set = RigidBodySet::new();
        let mut collider_set   = ColliderSet::new();
        let gravity = vector![0.0, -9.81, 0.0];

        let wave   = ocean.sample(0.0, 0.0, 0.0);
        let calado = 1.6_f64;
        let init_y = wave.height + calado * 0.7;

        let mass_props = MassProperties::new(
            point![0.0, -1.2, 0.0],
            22000.0,
            vector![750000.0, 780000.0, 70000.0],
        );

        let body = RigidBodyBuilder::dynamic()
            .translation(vector![0.0, init_y, 0.0])
            .linear_damping(0.25)
            .angular_damping(0.85)
            .additional_mass_properties(mass_props)
            .build();

        let boat_handle = rigid_body_set.insert(body);

        let hull = ColliderBuilder::cuboid(2.5, 1.75, 10.0)
            .density(0.0)
            .friction(0.8)
            .restitution(0.0)
            .build();
        collider_set.insert_with_parent(hull, boat_handle, &mut rigid_body_set);

        PhysicsEngine {
            rigid_body_set,
            collider_set,
            integration_parameters: IntegrationParameters::default(),
            physics_pipeline:       PhysicsPipeline::new(),
            island_manager:         IslandManager::new(),
            broad_phase:            DefaultBroadPhase::new(),
            narrow_phase:           NarrowPhase::new(),
            impulse_joint_set:      ImpulseJointSet::new(),
            multibody_joint_set:    MultibodyJointSet::new(),
            ccd_solver:             CCDSolver::new(),
            gravity,
            boat_handle,
            player_handle: None,
            controls:      ShipControls::default(),
            player_input:  vector![0.0, 0.0, 0.0],
        }
    }

    pub fn spawn_player(&mut self, x: f64, y: f64, z: f64) {
        if self.player_handle.is_some() { return; }
        let body = RigidBodyBuilder::dynamic()
            .translation(vector![x, y, z])
            .lock_rotations()
            .additional_mass(80.0)
            .linear_damping(2.0)
            .build();
        let h = self.rigid_body_set.insert(body);
        let col = ColliderBuilder::capsule_y(0.6, 0.3).friction(0.5).build();
        self.collider_set.insert_with_parent(col, h, &mut self.rigid_body_set);
        self.player_handle = Some(h);
    }

    pub fn set_player_input(&mut self, x: f64, y: f64, z: f64) {
        self.player_input = vector![x, y, z];
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
            helm:  self.controls,
        }
    }

    pub fn get_player_state(&self) -> Option<PlayerState> {
        self.player_handle.map(|h| {
            let p = &self.rigid_body_set[h];
            let pos = p.translation();
            PlayerState { position: [pos.x, pos.y, pos.z] }
        })
    }

    // ── Passo físico de timestep FIXO ────────────────────────────────────────
    // dt é sempre FIXED_DT (vindo do acumulador no GameState).
    // Forças e Rapier usam o mesmo dt → sem inconsistência.
    pub fn step_fixed(&mut self, dt: f64, ocean: &Ocean, time: f64) {
        self.integration_parameters.dt = dt;

        // ─ Barco ─────────────────────────────────────────────────────────────
        {
            let boat = &mut self.rigid_body_set[self.boat_handle];

            // Grade 8×4 de sondas de empuxo (32 pontos) ─────────────────────
            let probes_x: [f64; 4] = [-2.0, -0.7,  0.7,  2.0];
            let probes_z: [f64; 8] = [-9.5, -6.8, -4.1, -1.4, 1.4, 4.1, 6.8, 9.5];
            let area_probe = (5.0 * 20.0) / 32.0;

            for &px in &probes_x {
                for &pz in &probes_z {
                    let local  = point![px, -1.5, pz];
                    let world  = boat.position().transform_point(&local);
                    let vel    = boat.velocity_at_point(&world);

                    // Posição prevista (look-ahead) para evitar overshoot
                    let pred   = world + vel * dt;

                    let sample = ocean.sample(pred.x, pred.z, time);
                    let sub    = sample.height - pred.y;

                    if sub > 0.0 {
                        // ── Empuxo de Arquimedes ─────────────────────────────
                        let buoy = (sub * area_probe * 1000.0 * 9.81).min(20000.0);
                        boat.apply_impulse_at_point(
                            vector![0.0, buoy, 0.0] * dt, world, true
                        );

                        // ── Arrasto relativo à velocidade orbital da onda ────
                        // A onda "carrega" o casco — simula força de Stokes.
                        let wv   = ocean.get_wave_velocity(world.x, world.z, time);
                        let wv_na = vector![wv.x, wv.y, wv.z];
                        let rel  = vel - wv_na;             // velocidade relativa ao fluido
                        let drag = -rel * sub * 48.0;
                        boat.apply_impulse_at_point(drag * dt, world, true);
                    }
                }
            }

            // ── Propulsão a vela ─────────────────────────────────────────────
            let fwd = boat.position().rotation * vector![0.0, 0.0, -1.0];
            let spd = boat.linvel().norm();

            let wind_dot_fwd = WIND_X * fwd.x + WIND_Z * fwd.z;
            let t_w = (wind_dot_fwd + 1.0) * 0.5;
            let thrust_coeff = if t_w < 0.15 {
                0.0
            } else {
                0.25 + (t_w * std::f64::consts::PI).sin() * 0.75
            };
            let sail_force = 72000.0 * self.controls.sail * thrust_coeff;
            boat.apply_impulse(fwd * sail_force * dt, true);

            // ── Arrasto do casco ─────────────────────────────────────────────
            let anchor_drag = if self.controls.anchor { 8.0 } else { 1.0 };
            boat.apply_impulse(-boat.linvel() * (0.28 + anchor_drag * 0.35) * dt, true);

            // ── Torque do leme ────────────────────────────────────────────────
            let wind_force = self.controls.sail * thrust_coeff * WIND_SPEED;
            let turn       = self.controls.rudder * (spd * 0.08 + wind_force * 0.07) * 16000.0;
            boat.apply_torque_impulse(vector![0.0, turn * dt, 0.0], true);

            // ── Amortecimento de guinada ──────────────────────────────────────
            let av = *boat.angvel();
            boat.apply_torque_impulse(
                vector![0.0, -av.y * (0.9 + anchor_drag * 0.8) * 16000.0 * dt, 0.0],
                true
            );

            // ── Momento de restauração (anti-tombamento) ─────────────────────
            boat.apply_torque_impulse(
                vector![-av.x * 18000.0 * dt, 0.0, -av.z * 18000.0 * dt],
                true
            );
        }

        // ─ Jogador (natação) ──────────────────────────────────────────────────
        if let Some(h) = self.player_handle {
            let player = &mut self.rigid_body_set[h];
            player.apply_impulse(self.player_input * 4500.0 * dt, true);

            let pos  = player.translation();
            let wave = ocean.sample(pos.x, pos.z, time);
            let sub  = wave.height - pos.y;
            if sub > 0.0 {
                player.apply_impulse(vector![0.0, sub * 1200.0 * dt, 0.0], true);
                let vel = *player.linvel();
                player.apply_impulse(-vel * sub * 5.0 * dt, true);
            }
        }

        // ─ Integrar Rapier ────────────────────────────────────────────────────
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
            None, &(), &(),
        );
    }
}
