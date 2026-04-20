struct Wave {
    direction: vec2<f32>,
    steepness: f32,
    wavelength: f32,
    speed: f32,
    padding: f32,
};

struct OceanUniforms {
    time: f32,
    depthColor: vec3<f32>,
    shallowColor: vec3<f32>,
};

@group(0) @binding(0) var<uniform> ocean: OceanUniforms;
@group(0) @binding(1) var<storage, read> waves: array<Wave>;

// Gerstner Wave Function (Must match Rust implementation)
fn gerstner(pos: vec2<f32>, wave: Wave, time: f32) -> vec3<f32> {
    let k = 2.0 * 3.14159 / wave.wavelength;
    let c = sqrt(9.81 / k) * wave.speed;
    let f = k * (dot(wave.direction, pos) - c * time);
    let a = wave.steepness / k;

    return vec3<f32>(
        wave.direction.x * a * cos(f),
        a * sin(f),
        wave.direction.y * a * cos(f)
    );
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) viewDir: vec3<f32>,
};

@vertex
fn main_vertex(
    @location(0) position: vec3<f32>,
) -> VertexOutput {
    var out: VertexOutput;
    var p = position;
    var finalPos = position;

    // Sum 4 waves
    for (var i = 0u; i < 4u; i = i + 1u) {
        finalPos += gerstner(p.xz, waves[i], ocean.time);
    }

    out.worldPos = finalPos;
    out.position = vec4<f32>(finalPos, 1.0); // Simplified for now
    
    // Normal calculation via analytical derivative would go here
    out.normal = vec3<f32>(0.0, 1.0, 0.0); 
    
    return out;
}

@fragment
fn main_fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let deep = ocean.depthColor;
    let shallow = ocean.shallowColor;
    
    // Fresnel Schlick
    let viewDir = normalize(in.viewDir);
    let normal = normalize(in.normal);
    let f0 = 0.02;
    let fresnel = f0 + (1.0 - f0) * pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
    
    let color = mix(deep, shallow, fresnel);
    
    return vec4<f32>(color, 1.0);
}
