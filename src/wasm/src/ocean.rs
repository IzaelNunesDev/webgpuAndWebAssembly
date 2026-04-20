use glam::{DVec2, DVec3};
use serde::Serialize;

#[derive(Clone)]
pub struct WaveParams {
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
            WaveParams { direction: DVec2::new(1.0, 0.0).normalize(), steepness: 0.18, wavelength: 26.0, speed: 0.92 },
            WaveParams { direction: DVec2::new(0.92, 0.18).normalize(), steepness: 0.15, wavelength: 18.0, speed: 1.03 },
            WaveParams { direction: DVec2::new(0.76, 0.42).normalize(), steepness: 0.12, wavelength: 14.0, speed: 1.12 },
            WaveParams { direction: DVec2::new(0.54, 0.62).normalize(), steepness: 0.11, wavelength: 10.5, speed: 1.20 },
            WaveParams { direction: DVec2::new(0.28, 0.82).normalize(), steepness: 0.10, wavelength: 8.5, speed: 1.28 },
            WaveParams { direction: DVec2::new(-0.08, 1.0).normalize(), steepness: 0.08, wavelength: 6.5, speed: 1.35 },
        ];

        Ocean { waves }
    }

    pub fn get_wave_displacement(&self, x: f64, z: f64, time: f64) -> DVec3 {
        let mut final_pos = DVec3::new(x, 0.0, z);

        for wave in &self.waves {
            let k = 2.0 * std::f64::consts::PI / wave.wavelength;
            let c = (9.81 / k).sqrt() * wave.speed;
            let f = k * (wave.direction.x * x + wave.direction.y * z - c * time);
            let a = wave.steepness / k;

            final_pos.x += wave.direction.x * a * f.cos();
            final_pos.y += a * f.sin();
            final_pos.z += wave.direction.y * a * f.cos();
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
            let c = (9.81 / k).sqrt() * wave.speed;
            let f = k * (wave.direction.x * x + wave.direction.y * z - c * time);
            let a = wave.steepness / k;
            jacobian -= k * a * f.cos() * 0.08;
        }

        OceanSample {
            height: center.y,
            normal: [normal.x, normal.y.max(0.08), normal.z],
            jacobian,
        }
    }
}
