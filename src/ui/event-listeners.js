// @ts-nocheck
// ── setupEventListeners ──────────────────────────────────────────────────────
export function setupEventListeners(callbacks, modeController) {
    const retryBtn = document.getElementById('retry-location');
    if (retryBtn) retryBtn.addEventListener('click', callbacks.onRetryLocation);

    const unitToggle = document.getElementById('unit-toggle');
    if (unitToggle) {
        unitToggle.addEventListener('click', callbacks.onToggleUnit);
        unitToggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                callbacks.onToggleUnit();
            }
        });
    }

    const qualityBtns = document.querySelectorAll('.quality-btn');
    qualityBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tier = btn.dataset.quality;
            if (callbacks.onSetQuality) {
                callbacks.onSetQuality(tier);
            }
        });
    });

    const searchInput = document.getElementById('location-search');
    const searchBtn = document.getElementById('search-btn');
    const searchContainer = searchInput?.closest('.search-container');

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            if (!searchContainer?.classList.contains('expanded')) {
                searchContainer?.classList.add('expanded');
                searchInput?.focus();
            } else {
                callbacks.onSearch(searchInput?.value || '');
            }
        });
    }
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') callbacks.onSearch(searchInput.value);
        });
        searchInput.addEventListener('focus', () => {
            searchContainer?.classList.add('expanded');
        });
        searchInput.addEventListener('blur', () => {
            if (!searchInput.value) searchContainer?.classList.remove('expanded');
        });
    }

    // Scrubber play button
    const playBtn = document.getElementById('scrubber-play-btn');
    if (playBtn && callbacks.onToggleTimeWarp) {
        playBtn.addEventListener('click', callbacks.onToggleTimeWarp);
    }

    // Scrubber speed chip
    const speedChip = document.getElementById('scrubber-speed-chip');
    if (speedChip && callbacks.onCycleSpeed) {
        speedChip.addEventListener('click', callbacks.onCycleSpeed);
    }

    // Scrubber drag handling
    const playhead = document.getElementById('scrubber-playhead');
    const track = document.getElementById('scrubber-track');
    if (playhead && track && callbacks.onScrub) {
        playhead.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            playhead.classList.add('dragging');

            const onMove = (ev) => {
                const rect = track.getBoundingClientRect();
                const x = ev.clientX - rect.left;
                const pct = Math.max(0, Math.min(1, x / rect.width));
                callbacks.onScrub(pct);
            };

            const onUp = () => {
                playhead.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        track.addEventListener('click', (e) => {
            if (e.target === playhead || playhead.contains(e.target)) return;
            const rect = track.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            callbacks.onScrub(pct);
        });
    }

    // Drawer handle click handlers
    document.querySelectorAll('.drawer-handle').forEach((handle) => {
        handle.addEventListener('click', (e) => {
            e.stopPropagation();
            const drawer = handle.closest('.drawer');
            if (!drawer || !modeController) return;
            if (drawer.id === 'panel-left') {
                if (drawer.classList.contains('expanded')) {
                    modeController.hideDrawers();
                } else {
                    modeController.showLeftDrawer();
                }
            } else if (drawer.id === 'panel-right') {
                if (drawer.classList.contains('expanded')) {
                    modeController.hideDrawers();
                } else {
                    modeController.showRightDrawer();
                }
            }
        });
    });

    // Nearby tab button lazy-loading callback
    const nearbyTabBtn = document.querySelector('.tab-btn[data-tab="nearby"]');
    if (nearbyTabBtn && callbacks.onLoadNearby) {
        nearbyTabBtn.addEventListener('click', () => {
            callbacks.onLoadNearby();
        });
    }
}
