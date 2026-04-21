# Objetivo
Consolidar a física do barco (look-ahead) com os visuais de alta definição para a água oceânica através de renderização avançada com WebGPU.

## Resumo da Análise
O usuário propôs um material `THREE.ShaderMaterial` alimentado por WGSL puro. Todavia, no ecossistema moderno do `Three.js` + `WebGPURenderer`, injetar strings WGSL numa `ShaderMaterial` nativa causará tela preta/crash, pois `ShaderMaterial` assume GLSL (WebGL Fallback). Contudo, a excelente nova API de NodeMaterials (`three/tsl`) nos oferece o recurso `wgslFn`, permitindo que eu **injetar diretamente o exato código WGSL que você propôs** e convertê-lo transparentemente em um Vertex e Fragment nodes otimizados pelo backend WebGPU!

## Alterações Propostas

### 1. Física e Sincronização (WASM/Rust)
#### [MODIFY] `src/wasm/src/ocean.rs` e `src/game/types.ts`
- Alterarei as definições da onda para suportar `amplitude` (ao passo que o `steepness` atua na quebra lateral acompanhando o vídeo que você estudou). Atualizarei `DEFAULT_WAVES` para o novo array detalhado sugerido.
- A função de fase `c` absorverá o `tanh(k * h)` para representar ondas em águas mais rasas.

#### [MODIFY] `src/wasm/src/physics.rs`
- Inclusão do **Look-ahead Prediction**. Em vez de usar diretamente o `world_point`, somarei `velocity * dt` antes de amostrar a densidade da onda. Isto corta o tranco que o barco sofria ao acelerar contra uma onda no loop.
- Escalonarei a constante do empuxo usando o mesmo limite raso do `tanh` sugerido em seu snippet.

### 2. O Visual Deslumbrante da Água (WebGPU)
#### [MODIFY] `src/render/waterMaterial.ts`
- Atualizarei a classe que extende `NodeMaterial` para utilizar o seu shader fornecido via **wgslFn** (permitindo que tenhamos total controle sobre a matemática do shader com o seu código customizado sem sofrer crash com a arquitetura `NodeMaterial`).
- **Deslocamento Analítico (Vertex)**: Executará as 4 iterações iterando através das instâncias e movendo `positionNode`.
- **Normal e Espuma**: Emularemos as derivadas (hL, hR, etc.) ou derivaremos analiticamente para repassar uma Varying Normal precisa, somada aos cálculos visuais da espuma (`smoothstep` do Jacobiano).
- **Fresnel e Deep/Shallow Color**: Construção da saída fotográfica no `colorNode` baseada nos coeficientes `pow(1.0 - max(dot(viewDir, normal), 0.0), 5.0)`. A água mesclará suavemente '#0a2e4a' e '#1e90b0'. (Farei isso diretamente via sistema TSL para encaixar com a pipeline da sombra/brilho no fragmento do motor que já está implementado).

### 3. Detector Submerso (Mundo / Câmera)
#### [MODIFY] `src/main.ts`
- Implementar o método `updateUnderwater()`: O código avaliará se a altura local do topo da onda ultrapassou a câmera ou está muito rente durante a nadada.
- Aplicará CSS Dinâmico com blur, contraste e azulamento na `document.body.style.filter` para dar a percepção de mergulho (post-processing imersivo barato e temporário como descrito antes do shader TSL Caustics no roadmap).

---
> [!IMPORTANT]
> Vou portar o código do WGSL fornecido utilizando os frameworks suportados do ThreeJS (`TSL/NodeMaterials wgslFn`). É virtualmente garantido que veremos o exato mesmo resultado visual pretendido!

## Questionamentos em Aberto
- Nenhuma dúvida no momento. Todo o escopo e snippets enviados foram completamente processados. Confirmando este plano, começo já a injetar as melhorias!
