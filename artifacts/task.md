# Correção Física do Barco

- `[x]` Modificar `lib.rs` para permitir que o `PhysicsEngine` calcule a altura inicial da água com base no `ocean` para posicionar o barco.
- `[x]` Atualizar a criação de `RigidBody` em `physics.rs` (mass 22000kg, COM [0, -1.2, 0], damping linear 0.25 e angular 0.85, posição inicial dinâmica).
- `[x]` Atualizar o Grid de probes em `physics.rs` para 32 probes baseadas no draft/calado (8x4).
- `[x]` Ajustar cálculo de flutuabilidade em cada probe com a Terceira Lei de Newton (aplicação estrita da forca e dumping correspondente de arrasto da água dependendo da submersão).
- `[x]` Travar o timestep do loop físico em `1/120.0`.
- `[x]` Testar o build (`wasm-pack build --target web --out-dir ../wasm-pkg`) localmente - Compilou com Sucesso!.
