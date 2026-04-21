import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, positionWorld, mix, smoothstep, color, float } from 'three/tsl';

export const hullWaterLevel = uniform(0);
// O material do casco agora reage dinamicamente ao nível da água para simular madeira molhada.
export const hullMaterial = new MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.1 });

const worldY = positionWorld.y;
// O wetFactor cria aquela faixa escura e reflexiva de madeira molhada.
const wetFactor = smoothstep(-0.25, 0.25, hullWaterLevel.sub(worldY));

// Configuração de cores PBR: Madeira seca vs Madeira molhada
const dryColor = color('#8b5c32');
const wetColor = color('#3d2815');
hullMaterial.colorNode = mix(dryColor, wetColor, wetFactor);

// Madeira molhada reflete muito mais o ambiente (menor roughness)
hullMaterial.roughnessNode = mix(float(0.85), float(0.12), wetFactor);
