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
