# Melhorias na Imersão da Água e Física do Barco

- `[/]` Modificar `src/game/types.ts` e `src/game/waves.ts`
  - Incluir `amp` para as ondas nas definições de forma explícita conforme requisição do usuário, separando o controle de amplitude do declive da crista.
- `[ ]` Atualizar a Física no WASM (Rust - Rapier3D)
  - Modificar a computação de ondas Gerstner em `ocean.rs` com multiplicador `tanh(k * h)` para representar ondas em águas rasas.
  - Em `physics.rs`, incluir `predict_pos` aplicando a lógica de _look-ahead_ para a avaliação de pressão da onda estabilizando as flutuações e trancos do motor.
- `[ ]` Revisar Renderização TSL (`src/render/waterMaterial.ts`)
  - Usar a API TSL `wgslFn` para inserir a exata matemática Gerstner solicitada contendo normais derivadas localmente com hL, hR, etc.
  - Passar as normais para o processamento de cores para calcular fresnel e reflexão solar Specular GGX.
  - Somar a cor de espuma (foam) com base no Jacobiano simplificado.
- `[ ]` Interface Submersão (`src/main.ts`)
  - Adicionar a verificação na câmera via função `updateUnderwater()` para checar se o olhar está abaixo do limiar das ondas `- 0.25`.
  - Aplicar o filtro no `.body.style.filter` para emulação visual imersiva (blur, contrast drop, etc).
- `[ ]` Compilar o motor e verificar consistência.
