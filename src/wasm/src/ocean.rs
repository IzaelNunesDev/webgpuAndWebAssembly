use glam::{DVec2, DVec3};
use serde::Serialize;

#[derive(Clone)]
pub struct WaveParams {
    pub amp:        f64,   // referência visual (não usado no displacement; amplitude real = steepness/k)
    pub direction:  DVec2,
    pub steepness:  f64,   // parâmetro de circularidade (0=senoidal, 1=círculo)
    pub wavelength: f64,
    pub speed:      f64,
}

#[derive(Serialize, Clone, Copy)]
pub struct OceanSample {
    pub height:   f64,
    pub normal:   [f64; 3],
    pub jacobian: f64,
}

pub struct Ocean {
    pub waves:  Vec<WaveParams>,
    pub depth:  f64,
}

impl Ocean {
    pub fn new() -> Self {
        // Parâmetros idênticos aos de waves.ts — NUNCA mude um lado sem mudar o outro.
        let waves = vec![
            WaveParams { amp: 1.2, wavelength: 80.0, steepness: 0.25, direction: DVec2::new(1.0,  0.8).normalize(), speed: 0.92 },
            WaveParams { amp: 0.8, wavelength: 45.0, steepness: 0.22, direction: DVec2::new(-0.7, 0.6).normalize(), speed: 1.03 },
            WaveParams { amp: 0.5, wavelength: 25.0, steepness: 0.18, direction: DVec2::new(0.3, -0.9).normalize(), speed: 1.12 },
            WaveParams { amp: 0.3, wavelength: 15.0, steepness: 0.15, direction: DVec2::new(-0.5,-0.4).normalize(), speed: 1.20 },
        ];
        Ocean { waves, depth: 10.0 }
    }

    // ── Deslocamento Gerstner ──────────────────────────────────────────────────
    // FÓRMULA CANÔNICA (espelho do GPU/Fallback):
    //   a = steepness / k          ← amplitude real (horizontal E vertical)
    //   c = sqrt(g/k · tanh(k·d)) · speed_factor
    //   f = k·(D·P) - c·k·t
    //   X += a · D.x · cos(f)
    //   Y += a · sin(f)            ← igual ao GPU (não usa campo amp)
    //   Z += a · D.z · cos(f)
    pub fn get_wave_displacement(&self, x: f64, z: f64, time: f64) -> DVec3 {
        let mut pos = DVec3::new(x, 0.0, z);
        for w in &self.waves {
            let k   = std::f64::consts::TAU / w.wavelength;
            let c   = (9.81 / k * (k * self.depth).tanh()).sqrt() * w.speed;
            let f   = k * (w.direction.x * x + w.direction.y * z - c * time);
            let a   = w.steepness / k;          // amplitude = steepness/k
            pos.x  += w.direction.x * a * f.cos();
            pos.y  += a * f.sin();              // ← sincronizado com GPU/Fallback
            pos.z  += w.direction.y * a * f.cos();
        }
        pos
    }

    // ── Velocidade orbital analítica ──────────────────────────────────────────
    // Derivada temporal da posição de uma partícula Gerstner:
    //   Vy = -steepness · c · cos(f)
    //   Vx =  steepness · c · D.x · sin(f)
    //   Vz =  steepness · c · D.z · sin(f)
    pub fn get_wave_velocity(&self, x: f64, z: f64, time: f64) -> DVec3 {
        let mut vel = DVec3::ZERO;
        for w in &self.waves {
            let k     = std::f64::consts::TAU / w.wavelength;
            let c     = (9.81 / k * (k * self.depth).tanh()).sqrt() * w.speed;
            let f     = k * (w.direction.x * x + w.direction.y * z - c * time);
            let sc    = w.steepness * c;        // ω·a = steepness·c
            vel.x    += sc * w.direction.x * f.sin();
            vel.y    -= sc * f.cos();
            vel.z    += sc * w.direction.y * f.sin();
        }
        vel
    }

    // ── Amostragem completa (altura, normal, jacobiano) ───────────────────────
    pub fn sample(&self, x: f64, z: f64, time: f64) -> OceanSample {
        let eps = 0.1_f64;
        let center = self.get_wave_displacement(x,       z,       time);
        let dx     = self.get_wave_displacement(x + eps, z,       time);
        let dz     = self.get_wave_displacement(x,       z + eps, time);
        let tx = dx - center;
        let tz = dz - center;
        let normal = tz.cross(tx).normalize_or_zero();

        // Jacobiano: J = 1 - Σ steepness_i · cos(f_i)
        // J < 0 → onda quebrando; J ∈ (0, 0.4) → crista pontiaguda
        let mut jacobian = 1.0_f64;
        for w in &self.waves {
            let k  = std::f64::consts::TAU / w.wavelength;
            let c  = (9.81 / k * (k * self.depth).tanh()).sqrt() * w.speed;
            let f  = k * (w.direction.x * x + w.direction.y * z - c * time);
            jacobian -= w.steepness * f.cos();
        }

        OceanSample {
            height:   center.y,
            normal:   [normal.x, normal.y.max(0.08), normal.z],
            jacobian: jacobian.clamp(-1.0, 1.5),
        }
    }
}
