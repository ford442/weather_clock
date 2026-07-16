// @ts-nocheck
const SEARCH_SVG = `<svg class="icon-svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="currentColor" fill="none" stroke-width="1.5"/><line x1="11" y1="11" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// ── setSearchLoading ──────────────────────────────────────────────────────────
export function setSearchLoading(isLoading) {
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) searchBtn.innerHTML = isLoading ? '...' : SEARCH_SVG;
}
