// @ts-nocheck
/**
 * Show a toast notification.
 * @param {string} message
 * @param {'error'|'info'|'success'|'warning'} type
 * @param {number} durationMs
 */
export function showToast(message, type = 'error', durationMs = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, durationMs);
}

/**
 * Show a persistent toast with an action button.
 * @param {string} message
 * @param {'error'|'info'|'success'|'warning'} type
 * @param {string} actionText
 * @param {() => void} action
 */
export function showActionToast(message, type = 'info', actionText = 'Action', action) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} toast-action`;

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    const button = document.createElement('button');
    button.className = 'toast-action-btn';
    button.textContent = actionText;
    button.addEventListener('click', () => {
        try {
            action?.();
        } catch (error) {
            console.error('Toast action failed:', error);
        }
        dismiss();
    });
    toast.appendChild(button);

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    function dismiss() {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }

    return dismiss;
}
