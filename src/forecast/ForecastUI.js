/**
 * ForecastUI.js - DOM strip of 10 daily vignette cards + focus/scrub UI
 */
import { renderDailyPreview } from './DailyPreview.js';

export class ForecastUI {
    constructor(container, controller) {
        this.container = container;
        this.controller = controller;
        /** @type {HTMLDivElement[]} */
        this.cards = [];
        this.scrubberEl = null;
        this.currentIndex = 0;
        this.previewAnimationId = null;
        this.lastPreviewDraw = 0;
        this.previewFrameCount = 0;
        this.previewLastMetricsAt = performance.now?.() ?? Date.now();
        this.previewMetrics = { fps: 0, drawnCanvases: 0, mode: 'static' };
        this.visibilityObserver = null;

        this.init();
        this.bindController();
    }

    init() {
        this.injectStyles();
        this.createBaseStructure();
    }

    createBaseStructure() {
        this.container.innerHTML = `
            <div class="forecast-strip">
                <div class="forecast-header">
                    <span class="forecast-title">10-Day Forecast</span>
                    <span class="forecast-hint">Click a day for live 3D vignette + time scrub</span>
                </div>
                <div class="forecast-cards" id="forecast-cards"></div>
                <div class="forecast-scrubber" id="forecast-scrubber" style="display:none;">
                    <label>Time of day</label>
                    <input type="range" id="vignette-hour" min="0" max="23.99" step="0.25" value="12">
                    <span id="vignette-hour-label">12:00</span>
                    <button id="vignette-noon" class="f-btn">Solar Noon</button>
                    <button id="vignette-play" class="f-btn">Play day</button>
                </div>
            </div>
        `;

        this.cardsContainer = this.container.querySelector('#forecast-cards');
        this.scrubberEl = this.container.querySelector('#forecast-scrubber');

        // scrubber listeners (wired after data)
        const hourInput = this.container.querySelector('#vignette-hour');
        const label = this.container.querySelector('#vignette-hour-label');
        const noonBtn = this.container.querySelector('#vignette-noon');
        const playBtn = this.container.querySelector('#vignette-play');

        if (hourInput) {
            hourInput.addEventListener('input', (e) => {
                const h = parseFloat(e.target.value);
                if (this.controller) this.controller.setVignetteHour(h);
                if (label) label.textContent = this.formatHour(h);
                // Parent (later Mode/animation) listens to controller or dispatches custom
                this.container.dispatchEvent(new CustomEvent('vignettehourchange', { detail: { hour: h } }));
            });
        }
        if (noonBtn) {
            noonBtn.addEventListener('click', () => {
                if (this.controller) this.controller.setVignetteHour(12);
                if (hourInput) hourInput.value = 12;
                if (label) label.textContent = '12:00';
                this.container.dispatchEvent(new CustomEvent('vignettehourchange', { detail: { hour: 12 } }));
            });
        }
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                const reducedMotion =
                    document.body.classList.contains('reduced-motion') ||
                    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                const playing = reducedMotion ? false : this.controller?.toggleDayPlayback?.();
                playBtn.textContent = playing ? 'Pause day' : 'Play day';
                this.container.dispatchEvent(new CustomEvent('vignetteplaytoggle', { detail: { playing } }));
            });
        }
    }

    bindController() {
        if (!this.controller) return;
        this.controller.onDataLoaded = (days) => this.renderCards(days);
        this.controller.onDayFocus = (idx) => this.highlightCard(idx);
        this.controller.onHourChange = (hour) => this.updateHourControl(hour);
    }

    renderLoading() {
        if (!this.cardsContainer) return;
        this.cardsContainer.innerHTML = '';
        this.cards = [];
        for (let i = 0; i < 10; i++) {
            const el = document.createElement('div');
            el.className = 'forecast-card loading';
            el.innerHTML = `
                <div class="fc-date skeleton">&nbsp;</div>
                <div class="fc-preview skeleton"></div>
                <div class="fc-temps skeleton">&nbsp;</div>
                <div class="fc-cond skeleton">&nbsp;</div>
            `;
            this.cardsContainer.appendChild(el);
        }
        if (this.scrubberEl) this.scrubberEl.style.display = 'none';
    }

    renderCards(days) {
        if (!this.cardsContainer) return;
        this.cardsContainer.innerHTML = '';
        this.cards = [];

        days.forEach((day, i) => {
            const el = document.createElement('div');
            el.className = `forecast-card${i === this.currentIndex ? ' focused' : ''}`;
            el.tabIndex = 0;
            el.setAttribute('role', 'button');
            el.setAttribute('aria-label', `Focus forecast for ${day.date}`);
            const date = new Date(day.date);
            const dayLabel = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            const hi = day.tempMax != null ? Math.round(day.tempMax) : '--';
            const lo = day.tempMin != null ? Math.round(day.tempMin) : '--';
            const cond = day.condition || 'clear';

            el.innerHTML = `
                <div class="fc-date">${dayLabel}</div>
                <div class="fc-preview"><canvas width="120" height="72"></canvas></div>
                <div class="fc-temps"><span class="hi">${hi}°</span><span class="lo">${lo}°</span></div>
                <div class="fc-cond">${cond}</div>
                <div class="fc-wind">💨 ${Math.round(day.hourly?.[0]?.windSpeed || 0)}</div>
            `;

            // 2D preview (cheap)
            const cv = el.querySelector('canvas');
            if (cv) {
                try {
                    const rep = this.controller?.timelineData?.getRepresentativeTimeForDay
                        ? this.controller.timelineData.getRepresentativeTimeForDay(day)
                        : null;
                    renderDailyPreview(cv, day, rep);
                } catch (e) {
                    /* non-fatal */
                }
            }

            el.addEventListener('click', () => {
                this.focusCard(i);
            });
            el.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.focusCard(i);
                } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    this.focusCard(Math.min(this.cards.length - 1, i + 1));
                } else if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    this.focusCard(Math.max(0, i - 1));
                }
            });

            el._dayData = day;
            this.cardsContainer.appendChild(el);
            this.cards.push(el);
        });

        // initial highlight
        this.highlightCard(this.currentIndex);
        this.ensureVisibilityObserver();
        this.startPreviewAnimation();
    }

    highlightCard(index) {
        this.cards.forEach((c, i) => c.classList.toggle('focused', i === index));
        this.currentIndex = index;
        // show scrubber when focused
        if (this.scrubberEl) this.scrubberEl.style.display = '';
    }

    focusCard(index) {
        const nextIndex = Math.max(0, Math.min(this.cards.length - 1, index));
        this.currentIndex = nextIndex;
        if (this.controller) this.controller.focusDay(nextIndex);
        this.highlightCard(nextIndex);
        this.cards[nextIndex]?.scrollIntoView?.({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }

    updateHourControl(hour) {
        const hourInput = this.container.querySelector('#vignette-hour');
        const label = this.container.querySelector('#vignette-hour-label');
        if (hourInput && Math.abs(parseFloat(hourInput.value) - hour) > 0.05) {
            hourInput.value = hour;
        }
        if (label) label.textContent = this.formatHour(hour);
    }

    formatHour(h) {
        const hh = Math.floor(h);
        const mm = Math.floor((h - hh) * 60);
        return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
    }

    injectStyles() {
        if (document.getElementById('forecast-ui-styles')) return;
        const style = document.createElement('style');
        style.id = 'forecast-ui-styles';
        style.textContent = `
            .forecast-strip { padding: 8px 12px; background: rgba(0,0,0,0.45); border-top: 1px solid rgba(255,255,255,0.08); }
            .forecast-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:12px; opacity:.85; }
            .forecast-cards { display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch; }
            .forecast-card {
                min-width: 92px; background: rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
                border-radius:6px; padding:6px; text-align:center; cursor:pointer; transition: transform .15s, border .15s;
                font-size:11px; scroll-snap-align:center; touch-action:manipulation;
            }
            .forecast-card:focus-visible { outline:2px solid #7dd3fc; outline-offset:2px; }
            .forecast-card:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.35); }
            .forecast-card.focused { border-color:#7dd3fc; box-shadow:0 0 0 1px #7dd3fc; }
            .fc-date { font-weight:500; margin-bottom:2px; }
            .fc-preview { background:#111; border-radius:3px; margin:3px 0; overflow:hidden; }
            .fc-preview canvas { display:block; width:100%; height:auto; }
            .fc-temps { display:flex; justify-content:center; gap:6px; }
            .fc-temps .hi { color:#f4a261; } .fc-temps .lo { opacity:.7; }
            .fc-cond, .fc-wind { opacity:.75; font-size:10px; }
            .forecast-scrubber { margin-top:6px; display:flex; align-items:center; gap:8px; font-size:12px; }
            .forecast-scrubber input { width:180px; min-width:120px; touch-action:pan-x; }
            .f-btn { background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.2); color:#fff; padding:2px 8px; border-radius:4px; cursor:pointer; }
            .forecast-card.loading { pointer-events:none; opacity:.72; }
            .skeleton { position:relative; overflow:hidden; border-radius:4px; background:rgba(255,255,255,.10); color:transparent; }
            .skeleton::after { content:''; position:absolute; inset:0; transform:translateX(-100%); background:linear-gradient(90deg, transparent, rgba(255,255,255,.14), transparent); animation:forecast-shimmer 1.4s infinite; }
            .fc-preview.skeleton { height:72px; }
            @keyframes forecast-shimmer { to { transform:translateX(100%); } }
            @media (max-width: 720px) {
                .forecast-strip { padding: 8px; }
                .forecast-header { align-items:flex-start; gap:8px; }
                .forecast-hint { display:none; }
                .forecast-card { min-width:104px; padding:8px; }
                .forecast-scrubber { flex-wrap:wrap; gap:6px; }
                .forecast-scrubber label { width:100%; }
                .forecast-scrubber input { flex:1 1 160px; width:auto; }
                .f-btn { min-height:32px; padding:4px 10px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .forecast-card { transition:none; }
                .skeleton::after { animation:none; }
            }
        `;
        document.head.appendChild(style);
    }

    dispose() {
        if (this.previewAnimationId != null) {
            cancelAnimationFrame(this.previewAnimationId);
            this.previewAnimationId = null;
        }
        this.visibilityObserver?.disconnect?.();
        this.visibilityObserver = null;
        if (this.container) this.container.innerHTML = '';
    }

    startPreviewAnimation() {
        if (this.previewAnimationId != null) {
            cancelAnimationFrame(this.previewAnimationId);
            this.previewAnimationId = null;
        }

        const animate = (timeMs) => {
            const reducedMotion =
                document.body.classList.contains('reduced-motion') ||
                window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (!document.hidden && !reducedMotion && timeMs - this.lastPreviewDraw > 100) {
                this.lastPreviewDraw = timeMs;
                let drawn = 0;
                for (const card of this.cards) {
                    if (card.dataset.visible === 'false') continue;
                    const canvas = card.querySelector('canvas');
                    const day = card._dayData;
                    if (!canvas || !day) continue;
                    const rep = this.controller?.timelineData?.getRepresentativeTimeForDay
                        ? this.controller.timelineData.getRepresentativeTimeForDay(day)
                        : null;
                    renderDailyPreview(canvas, day, rep, 40.7, -74, timeMs);
                    drawn += 1;
                }
                this.previewFrameCount += 1;
                const metricsWindow = timeMs - this.previewLastMetricsAt;
                if (metricsWindow >= 1000) {
                    this.previewMetrics = {
                        fps: Math.round((this.previewFrameCount * 1000) / metricsWindow),
                        drawnCanvases: drawn,
                        mode: 'canvas-2d-throttled'
                    };
                    this.previewFrameCount = 0;
                    this.previewLastMetricsAt = timeMs;
                }
            } else if (reducedMotion) {
                this.previewMetrics = { fps: 0, drawnCanvases: 0, mode: 'static-reduced-motion' };
            }
            this.previewAnimationId = requestAnimationFrame(animate);
        };

        this.previewAnimationId = requestAnimationFrame(animate);
    }

    ensureVisibilityObserver() {
        this.visibilityObserver?.disconnect?.();
        if (typeof IntersectionObserver === 'undefined') {
            this.cards.forEach((card) => {
                card.dataset.visible = 'true';
            });
            return;
        }
        this.visibilityObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.target instanceof HTMLElement) {
                        entry.target.dataset.visible = entry.isIntersecting ? 'true' : 'false';
                    }
                });
            },
            {
                root: this.cardsContainer,
                threshold: 0.05
            }
        );
        this.cards.forEach((card) => this.visibilityObserver.observe(card));
    }
}
