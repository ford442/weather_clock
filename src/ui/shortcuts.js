// @ts-nocheck
/** Set up global application keyboard shortcuts. */
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
        }
    });
}
