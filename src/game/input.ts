import type { ControlMode } from './types';

const POINTER_SENSITIVITY = 0.0025;
const MAX_PITCH = (80 * Math.PI) / 180;

export class InputController {
    private pressed = new Set<string>();
    private justPressed = new Set<string>();
    private lookDeltaX = 0;
    private lookDeltaY = 0;
    private pointerLocked = false;

    constructor(private readonly target: HTMLElement) {
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('pointerlockchange', this.onPointerLockChange);
    }

    dispose() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    }

    requestPointerLock() {
        void this.target.requestPointerLock();
    }

    releasePointerLock() {
        document.exitPointerLock();
    }

    syncMode(mode: ControlMode) {
        if ((mode === 'onFoot' || mode === 'shipHelm' || mode === 'swimming') && !this.pointerLocked) {
            this.requestPointerLock();
        }

        if (mode === 'freeCamera' && this.pointerLocked) {
            this.releasePointerLock();
        }
    }

    consumeLook() {
        const delta = {
            yaw: -this.lookDeltaX * POINTER_SENSITIVITY,
            pitch: -this.lookDeltaY * POINTER_SENSITIVITY,
        };

        this.lookDeltaX = 0;
        this.lookDeltaY = 0;

        return delta;
    }

    endFrame() {
        this.justPressed.clear();
    }

    axis(negative: string, positive: string) {
        const neg = this.pressed.has(negative) ? 1 : 0;
        const pos = this.pressed.has(positive) ? 1 : 0;
        return pos - neg;
    }

    pressedNow(code: string) {
        return this.pressed.has(code);
    }

    triggered(code: string) {
        return this.justPressed.has(code);
    }

    isPointerLocked() {
        return this.pointerLocked;
    }

    clampPitch(value: number) {
        return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, value));
    }

    private onKeyDown = (event: KeyboardEvent) => {
        if (!this.pressed.has(event.code)) {
            this.justPressed.add(event.code);
        }

        this.pressed.add(event.code);
    };

    private onKeyUp = (event: KeyboardEvent) => {
        this.pressed.delete(event.code);
    };

    private onMouseMove = (event: MouseEvent) => {
        if (!this.pointerLocked) return;

        this.lookDeltaX += event.movementX;
        this.lookDeltaY += event.movementY;
    };

    private onPointerLockChange = () => {
        this.pointerLocked = document.pointerLockElement === this.target;
    };
}
