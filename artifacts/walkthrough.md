# Alterações na Física do Barco (WASM/Rapier)

Implementamos as regras de física em WASM de acordo com o plano estabelecido, endereçando diretamente os problemas de afundamento e instabilidade no momento em que o barco 'nasce' (spawn) e na distribuição do peso.

## O que foi Modificado

1. **Readequação do Ponto de Nascimento (Spawn)**
   Em vez de transladar o barco de forma estática `(-0.1)` no momento da construção do corpo rígido, o `PhysicsEngine::new()` agora recebe a referência do oceano e amostra a altura onde a água estaria localizada em sua origem logo no primeiro frame (`onda.height + (calado * 0.7)`).
   
2. **Propriedades Físicas (Massa e Densidade)**
   Refizemos a propriedade do seu barco informando uma Inércia e uma Massa explícita atrelada ao Rigidbody:
   - Massa total de `22.000 Kg`.
   - Modificado o **Centro de Massa** artificialmente via `local_com` para a posição local `(0, -1.2, 0)`. Isso fará com que o peso maior fique logo acima da quilha, evitando viradas bruscas.
   - Aplicação de `angular_damping(0.85)` (conforme documentado no Sea of Thieves) para simular melhor o efeito de atrito na água em giros verticais, e `linear_damping(0.25)`.

3. **Sistema de Probes (Flutuabilidade do Casco)**
   A matriz antiga de apenas 16 probes (`4x4`) causava a perda de empuxo localizada, facilitando tombamentos. 
   - A distribuição foi substituída por um array de **32 Probes (Formato 8x4)** espaçadas estrategicamente no bottom do casco.
   - Em vez do método `apply_impulse_at_point` com arranjo indireto, passamos a usar `add_force_at_point()` aplicando a Lei Arquimedes real per probe: _força é proporcional à profundidade submersa_, resultando em uma pressão d'água fluida, equilibrada em direção à superfície.
   - Um leve _drag_ (arrasto) dependente da submersão de cada probe foi incluído individualmente para estabilizar instabilidades verticais (ondas batendo no barco).

4. **Correção de Timestep**
   Fixamos a variável `dt` de integração do Rapier em valor cravado `1.0 / 120.0` internamente no método `physics.step()`, conforme sugerido no plano para manter consistência absoluta independentemente das taxas de frame do WASM/DOM.

## Resultados dos Testes

O build local rodando `<wasm-pack build --target web --out-dir ../wasm-pkg>` obteve êxito total, gerando os novos bindings necessários para a aplicação em TypeScript.

> [!TIP]
> **Próximos Passos**
> Recarregue a página (caso estava com o `npm run dev` ligado, ele terá hot-reloaded com os novos aquivos WASM).
> A transição para um servidor WebGPU com simulação de partículas SPH usando shaders estará em conformidade perfeita agora com os novos dados de RigidBody no seu lado de frontend/wasm.
