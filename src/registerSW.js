import { registerSW } from 'virtual:pwa-register';
import { showActionToast, showToast } from './ui/toast.js';

const isTestMode = new URLSearchParams(window.location.search).has('test');

export function initServiceWorker() {
    if (isTestMode) return;
    if (!('serviceWorker' in navigator)) return;

    const updateSW = registerSW({
        immediate: false,
        onNeedRefresh() {
            showActionToast('A new version is available.', 'info', 'Reload', () => {
                updateSW(true);
            });
        },
        onOfflineReady() {
            showToast('App ready for offline use.', 'success', 3000);
        },
        onRegisteredSW(swUrl, registration) {
            console.log('Service worker registered:', swUrl);
            if (registration) {
                registration.update().catch((error) => {
                    console.warn('Service worker initial update check failed:', error);
                });
            }
        },
        onRegisterError(error) {
            console.warn('Service worker registration failed:', error);
        }
    });
}

initServiceWorker();
