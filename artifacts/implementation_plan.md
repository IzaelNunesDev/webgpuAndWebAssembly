# Objetivo

Corrigir a física inicial do barco no Rapier (no WASM) para evitar que ele afunde ou capote no spawn, aplicando melhorias recomendadas na configuração de física e distribuição de forças. Além disso, esquematizar a arquitetura recomendada para a simulação de fluidos SPH (Smoothed Particle Hydrodynamics) usando WebGPU e integração híbrida com Rust/WASM.

## Alterações Propostas

### 1. Física e Spawn do Barco (WASM)

#### [MODIFY] `src/wasm/src/physics.rs`
- **Timestep Fixo**: Alterar o limite do timestep para `1.0 / 120.0` fixo no método `step()`, para garantir estabilidade na simulação física.
- **Damping Rigidbody**: Atualizar as propriedades do rigidbody para usar `angular_damping = 0.85` e `linear_damping = 0.25`.
- **Centro de Massa Diferencial**: A biblioteca Rapier não possui um `center_of_mass` setter direto na builder trivial de cuboid, então o abordaremos deslocando a colisão ou usando `MassProperties` manuais para assegurar que o centro de massa local fique posicionado em `(0, -1.2, 0)` com massa total de `22.000 kg`.
- **Grid de Probes (32 pontos)**: Substituir o atual grid de 4x4 por um grid de 8x4.  
  - Para cada probe, calcularemos `submersao = waveHeight - probeWorldY`.
  - Se `submersao > 0`, aplicaremos força equivalente a `submersao * areaProbe * 1000.0 * 9.81` para cima, substituindo a força estática baseada na profundidade máxima existente.

#### [MODIFY] `src/wasm/src/lib.rs` & `src/wasm/src/ocean.rs`
- **Spawn Dinâmico na Altura da Água**: Modificar a inicialização para que o `PhysicsEngine::new()` receba o estado inicial do `Ocean`.
- Calcular a altura da onda inicial em `X=0, Z=0` usando o Gerstner Ocean e iniciar a `translation` inicial do barco em `y = waveHeight + calado * 0.7`. (Adotando calado de aproximadamente 1.6 a 1.7 m).

---

### 2. Arquitetura Final SPH Recomendada

Seguindo sua diretriz para evitar a queda de FPS, estruturaremos (em nivel de design) uma simulação híbrida visando de 30k a 80k partículas em um raio de 15m. Este é o plano arquitetural a ser implementado depois nas próximas iterações:

1. **WASM (Rust e Rapier)**:
   - Focado *apenas* na física de corpo rígido do barco.
   - Irá receber do GPU (via readback assíncrono ou SharedArrayBuffer) um pequeno conjunto de densidade/velocidade local das partículas que de fato toquem o casco.
   - Aplica a força das pressões das partículas diretamente no casco usando e respeitando a Terceira Lei de Newton.

2. **Compute Shaders (WebGPU)**:
   - Dividido em passos independentes por dispatch:
     - `hash_particles`: Gera a `key` para cada partícula em um grid com tamanho de célula de `h = 0.6m`.
     - `bitonic_sort`: Realiza o ordenamento espacial das chaves.
     - `sph_step`: Computa o Look-ahead, calcula a densidade e a "near density" evitando aglomeração, calcula as pressões com Spiky kernel gradiente e viscosidade, e então propaga a integração de tempo.

3. **Renderização (Frontend/WebGPU)**:
   - **Longe do barco**: Continua renderizando a malha com as ondas Gerstner tradicionais (já bem otimizadas e bonitas).
   - **Perto do barco**: As partículas SPH são renderizadas com Screen-space Fluid Rendering (Metaballs). Uma máscara (stencil ou z-buffer tuning) cuidará da transição das partículas dinâmicas para a malha das ondas far-field.

> [!IMPORTANT]  
> A alteração imediata cobrirá a correção de WASM e física do barco ("Com isso ele flutua parado"). A inclusão do SPH WebGPU envolverá muitas mudanças em WGSL num passo futuro. Favor confirmar se quer que eu realize apenas as alterações de física do barco agora, ou se também crio um protótipo de compute shader para SPH.

## Plano de Verificação

### Verificação Manual
- Construir a aplicação (`npm run dev` após rodar o `wasm-pack`).
- Verificar visualmente se o barco inicia já no nível da água sem cair, afundar ou capotar de imediato.
- Checar se ele responde estavelmente às ondulações do Gerstner e se as 32 probes o mantêm equilibrado.
