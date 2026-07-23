// Generative ambient audio layer: rain, wind, thunder and a diurnal
// bird/cricket bed, all synthesized from filtered noise — no sample assets.
// No AudioContext (and no nodes) are created until ensureStarted() runs,
// which only happens from a real user gesture (autoplay policy).

const NOISE_BUFFER_SECONDS = 4;

function createNoiseBuffer(ctx, seconds = NOISE_BUFFER_SECONDS) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

function createPinkNoiseBuffer(ctx, seconds = NOISE_BUFFER_SECONDS) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.11;
    }
    return buffer;
}

function loopingSource(ctx, buffer) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    return source;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class AmbienceEngine {
    constructor() {
        this.ctx = null;
        this.started = false;
        this.muted = true;
        this.volume = 0.6;
        this._nextThunderAt = 0;
        this._lastFlash = 0;
        this._visibilityBound = false;
    }

    /** Create the audio graph. Must be called from within a user-gesture handler. */
    ensureStarted() {
        if (this.started) return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this._buildGraph();
        this.started = true;
        this._bindVisibility();
        this._applyMute();
    }

    _buildGraph() {
        const ctx = this.ctx;

        this.master = ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(ctx.destination);

        // ── Rain: white noise → bandpass, gain follows rainIntensity ──
        const rainNoise = createNoiseBuffer(ctx);
        this.rainSource = loopingSource(ctx, rainNoise);
        this.rainFilter = ctx.createBiquadFilter();
        this.rainFilter.type = 'bandpass';
        this.rainFilter.frequency.value = 3500;
        this.rainFilter.Q.value = 0.6;
        this.rainGain = ctx.createGain();
        this.rainGain.gain.value = 0;
        this.rainSource.connect(this.rainFilter).connect(this.rainGain).connect(this.master);

        // ── Wind: pink noise → lowpass, gain/cutoff follow wind speed, panned via LFO ──
        const windNoise = createPinkNoiseBuffer(ctx);
        this.windSource = loopingSource(ctx, windNoise);
        this.windFilter = ctx.createBiquadFilter();
        this.windFilter.type = 'lowpass';
        this.windFilter.frequency.value = 300;
        this.windGain = ctx.createGain();
        this.windGain.gain.value = 0;
        this.windPanner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

        this.windLfo = ctx.createOscillator();
        this.windLfo.frequency.value = 0.07;
        this.windLfoGain = ctx.createGain();
        this.windLfoGain.gain.value = 0.6;
        this.windLfo.connect(this.windLfoGain);
        this.windLfo.start();

        this.windSource.connect(this.windFilter).connect(this.windGain);
        if (this.windPanner) {
            this.windLfoGain.connect(this.windPanner.pan);
            this.windGain.connect(this.windPanner).connect(this.master);
        } else {
            this.windGain.connect(this.master);
        }

        // ── Thunder: one-shot noise bursts, triggered on lightning flash ──
        this.thunderNoiseBuffer = createNoiseBuffer(ctx, 2);

        // ── Diurnal bed: birdsong (post-sunrise) / crickets (night) ──
        const birdNoise = createNoiseBuffer(ctx);
        this.birdSource = loopingSource(ctx, birdNoise);
        this.birdFilter = ctx.createBiquadFilter();
        this.birdFilter.type = 'bandpass';
        this.birdFilter.frequency.value = 2800;
        this.birdFilter.Q.value = 4;
        this.birdTremolo = ctx.createGain();
        this.birdTremolo.gain.value = 1;
        this.birdLfo = ctx.createOscillator();
        this.birdLfo.frequency.value = 3.2;
        this.birdLfoGain = ctx.createGain();
        this.birdLfoGain.gain.value = 0.5;
        this.birdLfo.connect(this.birdLfoGain).connect(this.birdTremolo.gain);
        this.birdLfo.start();
        this.birdGain = ctx.createGain();
        this.birdGain.gain.value = 0;
        this.birdSource.connect(this.birdFilter).connect(this.birdTremolo).connect(this.birdGain).connect(this.master);

        const cricketNoise = createNoiseBuffer(ctx);
        this.cricketSource = loopingSource(ctx, cricketNoise);
        this.cricketFilter = ctx.createBiquadFilter();
        this.cricketFilter.type = 'bandpass';
        this.cricketFilter.frequency.value = 4500;
        this.cricketFilter.Q.value = 8;
        this.cricketTremolo = ctx.createGain();
        this.cricketLfo = ctx.createOscillator();
        this.cricketLfo.frequency.value = 6;
        this.cricketLfoGain = ctx.createGain();
        this.cricketLfoGain.gain.value = 0.5;
        this.cricketLfo.connect(this.cricketLfoGain).connect(this.cricketTremolo.gain);
        this.cricketTremolo.gain.value = 0.5;
        this.cricketLfo.start();
        this.cricketGain = ctx.createGain();
        this.cricketGain.gain.value = 0;
        this.cricketSource
            .connect(this.cricketFilter)
            .connect(this.cricketTremolo)
            .connect(this.cricketGain)
            .connect(this.master);
    }

    _bindVisibility() {
        if (this._visibilityBound) return;
        this._visibilityBound = true;
        document.addEventListener('visibilitychange', () => {
            if (!this.ctx) return;
            if (document.hidden) {
                this.ctx.suspend();
            } else if (!this.muted) {
                this.ctx.resume();
            }
        });
    }

    _applyMute() {
        if (!this.ctx) return;
        const target = this.muted ? 0 : this.volume;
        this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
        if (this.muted) {
            this.ctx.suspend();
        } else if (document.visibilityState !== 'hidden') {
            this.ctx.resume();
        }
    }

    setMuted(muted) {
        this.muted = muted;
        if (this.started) this._applyMute();
    }

    setVolume(volume) {
        this.volume = clamp01(volume);
        if (this.started && !this.muted) {
            this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.15);
        }
    }

    _triggerThunder(intensity) {
        const ctx = this.ctx;
        const distance = 0.5 + Math.random() * 2.5; // seconds of flash→rumble gap
        const startAt = ctx.currentTime + distance;

        const source = ctx.createBufferSource();
        source.buffer = this.thunderNoiseBuffer;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 180 + Math.random() * 120;

        const gain = ctx.createGain();
        const peak = 0.4 + 0.5 * clamp01(intensity);
        gain.gain.setValueAtTime(0, startAt);
        gain.gain.linearRampToValueAtTime(peak, startAt + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 2.2);

        source.connect(lowpass).connect(gain).connect(this.master);
        source.start(startAt);
        source.stop(startAt + 2.3);
    }

    /**
     * @param {number} delta - seconds since last frame
     * @param {object} weather - current interpolated weather snapshot (rainIntensity, windSpeed)
     * @param {number} sunElevationNorm - sun height roughly in -1 (deep night) .. 1 (noon)
     * @param {number} lightningFlash - current flash intensity (0 when idle)
     */
    update(delta, weather, sunElevationNorm, lightningFlash = 0) {
        if (!this.started || !this.ctx) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const smoothing = 0.4;

        const rainIntensity = clamp01(weather?.rainIntensity ?? 0);
        this.rainGain.gain.setTargetAtTime(rainIntensity * 0.7, t, smoothing);
        this.rainFilter.frequency.setTargetAtTime(2000 + rainIntensity * 3000, t, smoothing);

        const windSpeed = Math.max(0, weather?.windSpeed ?? 0);
        const windNorm = clamp01(windSpeed / 50);
        this.windGain.gain.setTargetAtTime(windNorm * 0.5, t, smoothing);
        this.windFilter.frequency.setTargetAtTime(150 + windNorm * 1500, t, smoothing);

        // Diurnal bed: birds gate in the hour after sunrise, crickets after dusk.
        const dayFactor = sunElevationNorm ?? 0;
        const birdWindow = dayFactor > -0.05 && dayFactor < 0.4 ? 1 - Math.abs((dayFactor - 0.17) / 0.23) : 0;
        this.birdGain.gain.setTargetAtTime(clamp01(birdWindow) * 0.12, t, smoothing);

        const nightGate = dayFactor < -0.05 ? clamp01(-dayFactor * 4) : 0;
        this.cricketGain.gain.setTargetAtTime(nightGate * 0.1, t, smoothing);

        // Rising edge of a lightning flash → schedule a distant rumble.
        if (lightningFlash > 0.05 && this._lastFlash <= 0.05 && t > this._nextThunderAt) {
            this._triggerThunder(lightningFlash);
            this._nextThunderAt = t + 1.5;
        }
        this._lastFlash = lightningFlash;
    }
}
