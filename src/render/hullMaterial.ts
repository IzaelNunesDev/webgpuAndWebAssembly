import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, positionWorld, mix, vec3, smoothstep } from 'three/tsl';

export const hullWaterLevel = uniform(0);
export const hullMaterial = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });

const worldY = positionWorld.y;
// The wetFactor creates that wet dark stripe. Adjust smoothstep from -0.15 to 0.15 for sharpness.
const wetFactor = smoothstep(-0.15, 0.15, hullWaterLevel.sub(worldY));
const dry = vec3(0.18, 0.12, 0.07);
const wet = vec3(0.06, 0.04, 0.02);
hullMaterial.colorNode = mix(dry, wet, wetFactor);
