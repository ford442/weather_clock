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
