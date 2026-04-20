import type { BoatState, ControlMode } from './types';

export class Hud {
    private readonly renderEl = this.expect<HTMLElement>('render-status');
    private readonly engineEl = this.expect<HTMLElement>('engine-status');
    private readonly modeEl = this.expect<HTMLElement>('mode-status');
    private readonly hintEl = this.expect<HTMLElement>('hint-status');
    private readonly speedEl = this.expect<HTMLElement>('speed-status');
    private readonly sailEl = this.expect<HTMLElement>('sail-status');
    private readonly anchorEl = this.expect<HTMLElement>('anchor-status');

    setRenderLabel(label: string) {
        this.renderEl.textContent = label;
    }

    setEngineLabel(label: string, kind: 'active' | 'warning') {
        this.engineEl.textContent = label;
        this.engineEl.className = kind;
    }

    setMode(mode: ControlMode) {
        const labels: Record<ControlMode, string> = {
            onFoot: 'No convés',
            shipHelm: 'No leme',
            swimming: 'Nadando',
            freeCamera: 'Câmera livre',
        };

        const hints: Record<ControlMode, string> = {
            onFoot: 'Clique para capturar mouse. WASD move, Espaço pula, E usa leme, Q câmera livre.',
            shipHelm: 'W/S acelera, A/D leme, Shift+W força extra, R alterna vela, F ancora, E sai.',
            swimming: 'WASD nada, Shift acelera, Espaço mergulho curto, E tenta agarrar a escada.',
            freeCamera: 'Q volta ao corpo. WASD navega livremente sem pointer lock.',
        };

        this.modeEl.textContent = labels[mode];
        this.hintEl.textContent = hints[mode];
    }

    setBoatState(boat: BoatState) {
        this.speedEl.textContent = `${boat.speed.toFixed(2)} m/s`;
        this.sailEl.textContent = `${Math.round(boat.helm.sail * 100)}%`;
        this.anchorEl.textContent = boat.helm.anchor ? 'Baixada' : 'Recolhida';
    }

    private expect<T extends HTMLElement>(id: string) {
        const element = document.getElementById(id);

        if (!element) {
            throw new Error(`HUD element #${id} não encontrado.`);
        }

        return element as T;
    }
}
