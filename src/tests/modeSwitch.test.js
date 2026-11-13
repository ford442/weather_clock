import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModeController } from '../ModeController.js';

/**
 * switchMode() only touches the adapters, history and a few hooks, so it is
 * exercised on a bare instance rather than a full scene.
 */
function makeController({ enter }) {
    const adapter = () => ({ exit: vi.fn(), enter: vi.fn(), dispose: vi.fn() });
    const adapters = { clock: adapter(), timeline: adapter(), forecast: adapter() };
    adapters.timeline.enter = vi.fn(enter);

    const controller = Object.assign(Object.create(ModeController.prototype), {
        currentMode: 'clock',
        isTransitioning: false,
        locked: false,
        adapters,
        _crossFadeCenterOverlay: vi.fn(),
        updateToggleUI: vi.fn(),
        updateHistory: vi.fn()
    });
    return { controller, adapters };
}

describe('ModeController.switchMode failure handling', () => {
    let events;

    beforeEach(() => {
        events = [];
        vi.stubGlobal('window', { dispatchEvent: (event) => events.push(event) });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('resolves, puts the user back in the previous mode, and reports a modeerror', async () => {
        const failure = new Error('Request failed with status 500');
        const { controller, adapters } = makeController({
            enter: async () => {
                throw failure;
            }
        });

        await expect(controller.switchMode('timeline')).resolves.toBeUndefined();

        expect(controller.currentMode).toBe('clock');
        expect(controller.isTransitioning).toBe(false);
        // The clock chrome exit() hid comes back, and the half-built timeline is dropped.
        expect(adapters.clock.exit).toHaveBeenCalledOnce();
        expect(adapters.timeline.dispose).toHaveBeenCalledOnce();
        expect(adapters.clock.enter).toHaveBeenCalledWith({ from: 'timeline' });
        // The history entry pushed for the attempt is replaced, not left pointing at timeline.
        expect(controller.updateHistory).toHaveBeenNthCalledWith(1, 'timeline');
        expect(controller.updateHistory).toHaveBeenLastCalledWith('clock', { replace: true });

        expect(events.map((e) => e.type)).toEqual(['modeerror']);
        expect(events[0].detail).toEqual({ mode: 'timeline', error: failure });
    });

    it('can try again afterwards (the dropped adapter starts from init)', async () => {
        let fail = true;
        const { controller, adapters } = makeController({
            enter: async () => {
                if (fail) throw new Error('down');
            }
        });

        await controller.switchMode('timeline');
        expect(controller.currentMode).toBe('clock');

        fail = false;
        await controller.switchMode('timeline');
        expect(controller.currentMode).toBe('timeline');
        expect(adapters.timeline.enter).toHaveBeenCalledTimes(2);
        expect(events.map((e) => e.type)).toEqual(['modeerror', 'modechange']);
    });

    it('still reports the original failure if restoring the previous mode also fails', async () => {
        const { controller, adapters } = makeController({
            enter: async () => {
                throw new Error('down');
            }
        });
        adapters.clock.enter.mockRejectedValue(new Error('camera'));

        await expect(controller.switchMode('timeline')).resolves.toBeUndefined();

        expect(controller.isTransitioning).toBe(false);
        expect(events.map((e) => e.type)).toEqual(['modeerror']);
        expect(events[0].detail.error.message).toBe('down');
    });

    it('a successful switch is unchanged: no rollback, modechange fired', async () => {
        const { controller, adapters } = makeController({ enter: async () => {} });

        await controller.switchMode('timeline');

        expect(controller.currentMode).toBe('timeline');
        expect(adapters.timeline.dispose).not.toHaveBeenCalled();
        expect(controller.updateHistory).toHaveBeenCalledOnce();
        expect(events.map((e) => e.type)).toEqual(['modechange']);
    });
});
