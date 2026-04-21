import type { BoatState, ControlMode } from './types';

export class Hud {
    private readonly renderEl  = this.expect<HTMLElement>('render-status');
    private readonly engineEl  = this.expect<HTMLElement>('engine-status');
    private readonly modeEl    = this.expect<HTMLElement>('mode-status');
    private readonly hintEl    = this.expect<HTMLElement>('hint-status');
    private readonly speedEl   = this.expect<HTMLElement>('speed-status');
    private readonly sailEl    = this.expect<HTMLElement>('sail-status');
    private readonly anchorEl  = this.expect<HTMLElement>('anchor-status');
    private readonly windEl    = this.expect<HTMLElement>('wind-status');

    setRenderLabel(label: string) { this.renderEl.textContent = label; }

    setEngineLabel(label: string, kind: 'active' | 'warning') {
        this.engineEl.textContent = label;
        this.engineEl.className = kind;
    }

    setMode(mode: ControlMode) {
        const labels: Record<ControlMode, string> = {
            onFoot:      'No convés',
            shipHelm:    'No leme',
            mastControl: 'No mastro',
            swimming:    'Nadando',
            freeCamera:  'Câmera livre',
            onNpcBoat:   'No navio inimigo',
            npcHelm:     'Leme do navio inimigo',
        };

        const hints: Record<ControlMode, string> = {
            onFoot:      'WASD move · Espaço pula · E leme/mastro · Z câmera livre · [ ] vela.',
            shipHelm:    'A/D leme (volante gira) · F âncora · E sai do leme · [ ] vela.',
            mastControl: 'W/S sobe/desce vela · Q -10% · A/D leme · E sai do mastro.',
            swimming:    'WASD nada · Shift acelera · Espaço sobe · C desce · E sobe na escada.',
            freeCamera:  'Z volta ao corpo · WASD/Shift navega · Bússola: rumo do barco.',
            onNpcBoat:   'WASD anda · Espaço pula · E leme (se perto) · G pula no mar.',
            npcHelm:     'W/S avança/recua · A/D vira · E volta ao convés.',
        };

        this.modeEl.textContent = labels[mode];
        this.hintEl.textContent = hints[mode];
    }

    setBoatState(boat: BoatState) {
        this.speedEl.textContent = `${boat.speed.toFixed(2)} m/s`;
        this.sailEl.textContent  = `${Math.round(boat.helm.sail * 100)}%`;
        this.anchorEl.textContent = boat.helm.anchor ? 'Baixada' : 'Recolhida';
    }

    setWind(windX: number, windZ: number, speed: number) {
        const deg = Math.atan2(windZ, windX) * 180 / Math.PI;
        const dirs = ['L', 'SL', 'S', 'SO', 'O', 'NO', 'N', 'NL'];
        const dir = dirs[Math.round(((deg + 360) % 360) / 45) % 8];
        this.windEl.textContent = `${speed.toFixed(1)} m/s ${dir}`;
    }

    private expect<T extends HTMLElement>(id: string) {
        const el = document.getElementById(id);
        if (!el) throw new Error(`HUD element #${id} não encontrado.`);
        return el as T;
    }
}
