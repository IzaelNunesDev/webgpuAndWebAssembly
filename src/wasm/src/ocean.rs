use glam::{DVec2, DVec3};
use serde::Serialize;

#[derive(Clone)]
pub struct WaveParams {
    pub amp: f64,
    pub direction: DVec2,
    pub steepness: f64,
    pub wavelength: f64,
    pub speed: f64,
}

#[derive(Serialize, Clone, Copy)]
pub struct OceanSample {
    pub height: f64,
    pub normal: [f64; 3],
    pub jacobian: f64,
}

pub struct Ocean {
    pub waves: Vec<WaveParams>,
}

impl Ocean {
    pub fn new() -> Self {
        let waves = vec![
            WaveParams { amp: 1.2, wavelength: 80.0, steepness: 0.25, direction: DVec2::new(1.0, 0.8).normalize(), speed: 0.92 },
            WaveParams { amp: 0.8, wavelength: 45.0, steepness: 0.22, direction: DVec2::new(-0.7, 0.6).normalize(), speed: 1.03 },
            WaveParams { amp: 0.5, wavelength: 25.0, steepness: 0.18, direction: DVec2::new(0.3, -0.9).normalize(), speed: 1.12 },
            WaveParams { amp: 0.3, wavelength: 15.0, steepness: 0.15, direction: DVec2::new(-0.5, -0.4).normalize(), speed: 1.2 },
        ];

        Ocean { waves }
    }

    pub fn get_wave_displacement(&self, x: f64, z: f64, time: f64) -> DVec3 {
        let mut final_pos = DVec3::new(x, 0.0, z);

        for wave in &self.waves {
            let k = 2.0 * std::f64::consts::PI / wave.wavelength;
            let depth = 10.0;
            let c = (9.81 / k * (k * depth).tanh()).sqrt() * wave.speed;
            let f = k * (wave.direction.x * x + wave.direction.y * z - c * time);
            
            let a = wave.amp;
            final_pos.x += wave.direction.x * a * wave.steepness * f.cos();
            final_pos.y += a * f.sin();
            final_pos.z += wave.direction.y * a * wave.steepness * f.cos();
        }

        final_pos
    }

    pub fn sample(&self, x: f64, z: f64, time: f64) -> OceanSample {
        let center = self.get_wave_displacement(x, z, time);
        let dx = self.get_wave_displacement(x + 0.1, z, time);
        let dz = self.get_wave_displacement(x, z + 0.1, time);
        let tangent_x = dx - center;
        let tangent_z = dz - center;
        let normal = tangent_z.cross(tangent_x).normalize_or_zero();

        let mut jacobian = 1.0;

        for wave in &self.waves {
            let k = 2.0 * std::f64::consts::PI / wave.wavelength;
            let depth = 10.0;
            let c = (9.81 / k * (k * depth).tanh()).sqrt() * wave.speed;
            let f = k * (wave.direction.x * x + wave.direction.y * z - c * time);
            
            // Simplified jacobian using steepness
            jacobian -= wave.steepness * f.cos();
        }

        OceanSample {
            height: center.y,
            normal: [normal.x, normal.y.max(0.08), normal.z],
            jacobian,
        }
    }
}
