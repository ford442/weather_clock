/**
 * Set up global application keyboard shortcuts.
 *
 * @param {{
 *   onToggleTimeWarp?: () => void,
 *   onCycleSpeed?: () => void,
 *   onPause?: () => void,
 *   onToggleUnit?: () => void,
 *   onCapturePhoto?: () => void,
 *   onToggleTimelapse?: () => void,
 *   onCycleNightSky?: () => void,
 *   onCycleZodiac?: () => void
 * }} callbacks
 */
export function setupKeyboardShortcuts(callbacks) {
    document.addEventListener('keydown', (e) => {
        // Don't fire when user is typing in an input
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        // Every shortcut here is a bare letter, so a modified press belongs to
        // the browser or the OS, not to us — Ctrl/Cmd+Z is undo, Ctrl+P is
        // print, Ctrl+L is the address bar. Never hijack those.
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        switch (e.key.toLowerCase()) {
            case 'w':
                callbacks.onToggleTimeWarp?.();
                break;
            case 'f':
                callbacks.onCycleSpeed?.();
                break;
            case '/':
                e.preventDefault();
                callbacks.onPause?.();
                break;
            case 'u':
                callbacks.onToggleUnit?.();
                break;
            case 'p':
                callbacks.onCapturePhoto?.();
                break;
            case 'l':
                callbacks.onToggleTimelapse?.();
                break;
            case 'c':
                callbacks.onCycleNightSky?.();
                break;
            case 'z':
                callbacks.onCycleZodiac?.();
                break;
        }
    });
}
