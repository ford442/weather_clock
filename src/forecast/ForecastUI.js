/**
 * ForecastUI.js - DOM strip of 10 daily vignette cards + focus/scrub UI
 */
import { renderDailyPreview } from './DailyPreview.js';

export class ForecastUI {
    constructor(container, controller) {
        this.container = container;
        this.controller = controller;
        this.cards = [];
        this.scrubberEl = null;
        this.currentIndex = 0;

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
                this.container.dispatchEvent(new CustomEvent('vignetteplaytoggle'));
            });
        }
    }

    bindController() {
        if (!this.controller) return;
        this.controller.onDataLoaded = (days) => this.renderCards(days);
        this.controller.onDayFocus = (idx) => this.highlightCard(idx);
    }

    renderCards(days) {
        if (!this.cardsContainer) return;
        this.cardsContainer.innerHTML = '';
        this.cards = [];

        days.forEach((day, i) => {
            const el = document.createElement('div');
            el.className = `forecast-card${i === this.currentIndex ? ' focused' : ''}`;
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
                } catch (e) { /* non-fatal */ }
            }

            el.addEventListener('click', () => {
                this.currentIndex = i;
                if (this.controller) this.controller.focusDay(i);
                this.highlightCard(i);
            });

            el._dayData = day;
            this.cardsContainer.appendChild(el);
            this.cards.push(el);
        });

        // initial highlight
        this.highlightCard(this.currentIndex);
    }

    highlightCard(index) {
        this.cards.forEach((c, i) => c.classList.toggle('focused', i === index));
        this.currentIndex = index;
        // show scrubber when focused
        if (this.scrubberEl) this.scrubberEl.style.display = '';
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
            .forecast-cards { display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; }
            .forecast-card {
                min-width: 92px; background: rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
                border-radius:6px; padding:6px; text-align:center; cursor:pointer; transition: transform .15s, border .15s;
                font-size:11px;
            }
            .forecast-card:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.35); }
            .forecast-card.focused { border-color:#7dd3fc; box-shadow:0 0 0 1px #7dd3fc; }
            .fc-date { font-weight:500; margin-bottom:2px; }
            .fc-preview { background:#111; border-radius:3px; margin:3px 0; }
            .fc-temps { display:flex; justify-content:center; gap:6px; }
            .fc-temps .hi { color:#f4a261; } .fc-temps .lo { opacity:.7; }
            .fc-cond, .fc-wind { opacity:.75; font-size:10px; }
            .forecast-scrubber { margin-top:6px; display:flex; align-items:center; gap:8px; font-size:12px; }
            .forecast-scrubber input { width:180px; }
            .f-btn { background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.2); color:#fff; padding:2px 8px; border-radius:4px; cursor:pointer; }
        `;
        document.head.appendChild(style);
    }

    dispose() {
        if (this.container) this.container.innerHTML = '';
    }
}
