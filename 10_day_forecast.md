# 10-Day Historical & Forecast Visualization Plan

## Overview
Transform the weather clock from a single-moment display into a **time-traveling weather tunnel** that visualizes 21 days of weather: 10 days past (historical + predictions), today, and 10 days future (forecast). This creates context—showing if today is warm *relative to* a cold streak, or sunny *after* weeks of storms.

---

## Scientific Foundation

### 1. Weather Forecast Accuracy (NOAA/NESDIS Research)

According to NOAA's National Environmental Satellite, Data, and Information Service (NESDIS):

| Forecast Range | Accuracy Rate | Interpretation |
|----------------|---------------|----------------|
| 5-day | ~90% | Highly reliable for planning |
| 7-day | ~80% | Good reliability with some uncertainty |
| 10-day | ~50% | Coin-flip reliability—use for trends only |

**Key Insight**: The "predictability horizon" for detailed weather is approximately 7-10 days due to the chaotic nature of the atmosphere (Lorenz's butterfly effect). Beyond this, models rely on climatological patterns rather than specific atmospheric states.

**Source**: NOAA/NESDIS, Our World in Data (ECMWF verification data)

### 2. Heat Wave Definition (WMO Standard)

The World Meteorological Organization (WMO) defines a heat wave as:
> "Five or more consecutive days during which the daily maximum temperature exceeds the average maximum temperature by 5°C (9°F), relative to the 1961-1990 baseline."

**Regional Variations**:
- Netherlands: 5+ days >25°C, including 3+ days >30°C
- India (IMD): 3+ consecutive days with max temp ≥40°C (plains) or ≥37°C (coastal)
- Australia: 3+ days with max temp >95th percentile

**Implementation**: Use the percentile-based approach—5+ consecutive days above the 90th percentile of historical temperatures for the location.

### 3. Cold Wave/Snap Definition (WMO Standard)

The WMO defines a cold wave as:
> "A period of marked and unusual cold weather characterized by a sharp and significant drop in air temperatures (maximum, minimum, and daily average) over a large area, persisting below certain thresholds for at least two consecutive days during the cold season."

**Distinction**:
- **Cold Wave**: Rapid temperature drop within 24 hours requiring increased protection
- **Cold Snap**: Shorter duration, often more localized, rapid onset
- **Cold Spell**: Persistently below-average temperatures during the *warm* season

**Source**: WMO Guidelines on Definition and Monitoring of Extreme Weather (2020)

### 4. Color-Temperature Psychology (Scientific Basis)

Research in color psychology confirms physiological and emotional responses to color temperature:

| Color Category | Physiological Effect | Emotional Association |
|----------------|---------------------|----------------------|
| **Warm Colors** (red, orange, yellow) | Increase heart rate, blood pressure, body temperature sensation | Energy, excitement, comfort, passion |
| **Cool Colors** (blue, green, cyan) | Slow metabolism, reduce heart rate, create cooling sensation | Calmness, serenity, focus, tranquility |

**Application to Visualization**:
- Warm colors heighten excitement—appropriate for showing temperature "extremes"
- Cool colors alleviate anxiety—hospitals use them to reduce patient stress
- The "temperature" of color literally affects perceived room temperature by 2-3°F

**Sources**: Yildirim et al. (2011), Haller (2017), Dalke et al. (2006)

### 5. Forecast Verification Metrics (DWD/ECMWF Standards)

The German Weather Service (DWD) and ECMWF use these standard metrics:

**Mean Absolute Error (MAE)**:
```
MAE = (1/N) × Σ|Forecastᵢ - Observationᵢ|
```
- Average error magnitude
- Same unit as variable (°C or °F)
- Robust to outliers

**Root Mean Square Error (RMSE)**:
```
RMSE = √[(1/N) × Σ(Forecastᵢ - Observationᵢ)²]
```
- Penalizes large errors more heavily
- Always ≥ MAE
- RMSE/MAE > 1.3 indicates presence of extreme errors

**Skill Score**:
```
Skill = (Reference_Error - Forecast_Error) / Reference_Error
```
- Compares forecast to reference (persistence or climatology)
- Positive = better than reference
- Common reference: "persistence" (yesterday's weather continues)

**Source**: DWD Verification Documentation, WWRP/WGNE Joint Working Group

### 6. Temperature Anomaly Detection

Standard meteorological approach for identifying unusual temperatures:

```
Z-score = (T_day - T_climatology) / σ_climatology

Where:
- T_climatology = 30-year average for that date (1991-2020)
- σ_climatology = Standard deviation of historical temperatures
```

| Z-score Range | Classification |
|---------------|----------------|
| > +2.0 | Significantly above normal (hot) |
| +1.0 to +2.0 | Above normal (warm) |
| -1.0 to +1.0 | Near normal |
| -2.0 to -1.0 | Below normal (cool) |
| < -2.0 | Significantly below normal (cold) |

---

## Core Concept: The Weather Timeline

### Visual Metaphor
A **horizontal tunnel of time** where each day is a "weather portal" or column. Users can pan/zoom to explore the continuum.

```
[PAST] ← ← ← [TODAY] → → → [FUTURE]
  -10        -5    NOW     +5       +10
```

Each day displays:
- **Temperature**: Color-coded (deep blue → cyan → green → yellow → orange → red)
- **Weather condition**: Particle density/type (clear, rain, snow, storm)
- **Accuracy ring** (for past days): How close was the prediction to actual?

---

## Data Requirements

### API Integration (Open-Meteo)

```javascript
// Historical Data (Past 10 Days)
// https://archive-api.open-meteo.com/v1/archive
const historical = {
  endpoint: 'https://archive-api.open-meteo.com/v1/archive',
  params: {
    latitude, longitude,
    start_date: '2026-03-30', // 10 days ago
    end_date: '2026-04-08',   // yesterday
    daily: ['temperature_2m_max', 'temperature_2m_min', 'weathercode'],
    hourly: ['temperature_2m', 'weathercode']
  }
};

// Forecast Data (Next 10 Days)  
// https://api.open-meteo.com/v1/forecast
const forecast = {
  endpoint: 'https://api.open-meteo.com/v1/forecast',
  params: {
    latitude, longitude,
    forecast_days: 10,
    past_days: 10,  // Open-Meteo can return past forecast data!
    daily: ['temperature_2m_max', 'temperature_2m_min', 'weathercode'],
    hourly: ['temperature_2m', 'weathercode']
  }
};
```

### Climatology Data (30-Year Normals)

For temperature anomaly calculations:
```javascript
// Using Open-Meteo climate API or NOAA/GHCN data
const climatology = {
  endpoint: 'https://climate-api.open-meteo.com/v1/climate',
  params: {
    latitude, longitude,
    models: ['era5_land', 'era5'],
    start_date: '1991-01-01',
    end_date: '2020-12-31',  // WMO standard 30-year period
    daily: ['temperature_2m_mean', 'temperature_2m_max', 'temperature_2m_min']
  }
};
```

### Data Structure

```javascript
interface DayData {
  date: '2026-04-08';
  type: 'historical' | 'forecast';
  
  // Temperature
  tempMax: number;
  tempMin: number;
  tempAvg: number;
  
  // Anomaly calculations (scientifically grounded)
  tempAnomaly: number;      // Deviation from 30-year climatology
  zScore: number;            // Standard deviations from normal
  
  // Weather
  weatherCode: number;  // WMO code
  condition: 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm';
  
  // Hourly data for intra-day visualization
  hourly: HourlyData[];
  
  // For past days: prediction vs actual
  prediction?: {
    tempMax: number;
    tempMin: number;
    weatherCode: number;
    issuedDate: string;  // When this forecast was made
  };
  accuracy?: {
    mae: number;         // Mean Absolute Error in °F
    rmse: number;        // Root Mean Square Error
    skill: number;       // Skill vs persistence (0-1)
    tempScore: number;   // 0-1 overall accuracy
  };
}
```

---

## Visual Design

### 1. The Day Columns (3D Geometry)

Each day is represented as a **vertical column/wall** in 3D space:

```
     ╭──────────╮
    ╱   DAY +3   ╱│  ← Top: Date label
   ╱  ☀️  72°F   ╱ │  ← Middle: Icon + Avg temp
  ╱   [warm]    ╱  │  ← Bottom: Color gradient
 ╱______________╱   │      representing day's
 │              │  ╱       temp range
 │  [particle   │ ╱
 │   density]   │╱
 ╰──────────────╯
```

**Column Properties:**
- **Position**: X-axis = day offset (-10 to +10), Z-axis = depth for parallax
- **Height**: Fixed, but internal gradient shows temp range (min at bottom, max at top)
- **Color**: Based on temperature anomaly (z-score) rather than absolute temp
  - Deep blue (< -2σ): Exceptionally cold
  - Cyan (-2σ to -1σ): Below normal
  - Green (-1σ to +1σ): Near normal
  - Yellow (+1σ to +2σ): Above normal
  - Red (> +2σ): Exceptionally hot
- **Particle density**: Weather condition visualization within each column

### 2. Temperature Color System (Scientifically Calibrated)

Based on z-score color mapping rather than arbitrary thresholds:

```
Deep Freeze    Cold       Cool      Mild      Warm       Hot    Extreme
   <-2σ       -2σ      -1σ to    +1σ      +1σ to     +2σ       >+2σ
   (<14°F)   (14-32°F)  0σ (50°F) to +2σ  (85°F)   (>100°F)
   
   #1a237e  →  #4fc3f7  →  #81c784  →  #fff176  →  #ffb74d  →  #e53935  →  #b71c1c
   Exceptional  Below     Near      Above     Significantly
   Cold        Normal    Normal    Normal    Hot
```

**Implementation:**
- Use Three.js `Color.lerpColors()` for smooth interpolation
- Each column's material emissive property glows with temperature color
- Ambient light tint shifts based on currently focused day's anomaly

### 3. Weather State Visualization

Each column contains a **mini particle system**:

| Condition | Visual Treatment |
|-----------|------------------|
| Clear | Few sparkle particles, bright lighting |
| Cloudy | Fog/mist volume, diffused lighting |
| Rain | Vertical streaks, blue-tinted lighting |
| Snow | Falling white particles, cool glow |
| Storm | Intense particles, occasional lightning flash, dark purple tint |

**Particle LOD:** When zoomed out, show simplified icons; when zoomed in, full particle simulation.

### 4. The Prediction Accuracy Ring (Past Days Only)

For historical days, show a **halo/ring** around the column:

```
    ╭───────╮
   ╱   DAY   ╱│
  ╱   -5    ╱ │
 ╱  ☁️→☀️   ╱  │  ← Icon morphs from predicted to actual
╱__________╱   │
│ ╭──────╮ │  ╱   ← Ring color = accuracy
│ │██████│ │ ╱      Green = accurate, Red = off
│ │██████│ │╱      Completeness = skill score
╰─┴──────┴─╯
```

**Accuracy Visualization (Based on Meteorological Standards):**
- Ring completeness: Proportional to skill score (0-100%)
- Ring color: 
  - Green (skill > 0.7): Highly accurate
  - Yellow (skill 0.3-0.7): Moderate accuracy
  - Red (skill < 0.3): Low accuracy
- MAE displayed on hover: "±3.2°F error"

### 5. Heat Wave & Cold Snap Detection Visuals

When pattern detection identifies a heat wave or cold snap:

```
   ╭────────────────────╮
  ╱  🔥 HEAT WAVE 🔥    ╱│  ← 5+ consecutive warm columns
 ╱  Days -7 to -3       ╱ │    glow with orange/red aura
╱______________________╱  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │ ╱  ← Connecting "bridge" between
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │╱     affected days
╰──────────────────────╯
```

**Visual Cues:**
- Connecting bridges between consecutive extreme days
- Glowing auras around affected columns
- Icon indicators: 🔥 for heat wave, ❄️ for cold snap

---

## UI/UX Design

### 1. Navigation Controls

**Horizontal Panning:**
- Mouse drag left/right to slide through time
- Touch swipe on mobile
- Arrow keys for keyboard navigation
- Momentum/inertia for smooth feel

**Zoom Levels:**
- **Zoomed Out (Default)**: See all 21 days as columns, today centered/highlighted
- **Medium Zoom**: Focus on ±3 days, columns show more detail
- **Zoomed In**: Single day fills view, hourly breakdown visible

**Navigation HUD:**
```
┌─────────────────────────────────────────────────┐
│  [←]  [-10]══[-5]══[TODAY]══[+5]══[+10]  [→]  │
│        ◯────◯────●────◯────◯                  │  ← Timeline scrubber
└─────────────────────────────────────────────────┘
```

### 2. Information Panels

**Hover/Select State:**
```
┌─────────────────────────────────┐
│ April 8, 2026 (10 days ago)     │  ← Date
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ High: 78°F                      │  ← Actual temps
│ Low:  62°F                      │
│ Avg:  70°F                      │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ Normal: 65°F ±8°F               │  ← 30-year climatology
│ Anomaly: +5°F (Z: +0.6σ)        │  ← Scientific context
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ ☀️ Clear Sky (actual)           │  ← Actual condition
│ ☁️ Partly Cloudy (predicted)    │  ← Predicted condition
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ Forecast issued: Apr 1, 2026    │  ← Prediction metadata
│ MAE: ±2.4°F | Skill: 0.82       │  ← Accuracy metrics
└─────────────────────────────────┘
```

**Trend Indicators (Scientifically Grounded):**
- ⬆️ Warming (Z-score increased >0.5σ from yesterday)
- ➡️ Stable (Z-score within ±0.5σ)
- ⬇️ Cooling (Z-score decreased >0.5σ from yesterday)
- 🔥 Heat Wave (5+ consecutive days with Z > +1.5σ)
- ❄️ Cold Snap (5+ consecutive days with Z < -1.5σ)
- 📈 Climbing Anomaly (trend toward +2σ)
- 📉 Dropping Anomaly (trend toward -2σ)

### 3. The "Context Ribbon"

A visual summary bar at the bottom showing the 21-day narrative:

```
┌────────────────────────────────────────────────────────────────┐
│ ❄️ Cold Snap → 🌡️ Warming → ☀️ Peak Warmth → 🌧️ Storm → ?      │
│ ═══════════    ═══════════   ══════════════   ════════   ════ │
│   -10 to -6       -5 to -2       -1 to +3       +4 to +6  +7+  │
│                                                                 │
│ "You've emerged from a 5-day cold snap. Current temp is        │
│  +5°F above normal (Z=+0.6σ). Enjoy the warmth!"              │
│                                                                 │
│ 5-day accuracy: 87% | 10-day accuracy: 52%                     │
└────────────────────────────────────────────────────────────────┘
```

---

## Animation & Transitions

### 1. Column Entrance Animation

When data loads, columns rise from below:
```javascript
// Staggered entrance based on distance from today
columns.forEach((col, i) => {
  const distance = Math.abs(i - 10);  // 10 is "today" index
  const delay = distance * 100;  // ms
  
  gsap.from(col.position, {
    y: -10,
    duration: 0.8,
    delay: delay / 1000,
    ease: 'back.out(1.7)'
  });
});
```

### 2. Panning Physics

```javascript
// Inertial panning with bounds
let velocity = 0;
let position = 0;  // 0 = today, -10 = past, +10 = future

function updatePan() {
  position += velocity;
  velocity *= 0.95;  // friction
  
  // Soft bounds
  if (position < -10) velocity += (-10 - position) * 0.1;
  if (position > 10) velocity -= (position - 10) * 0.1;
  
  // Update camera
  camera.position.x = position * COLUMN_SPACING;
}
```

### 3. Weather Transitions

When panning between days with different weather:
- Cross-fade particle systems over 0.5s
- Interpolate lighting colors
- Morph sky gradient

### 4. The "Breathing" Effect

Current day's column subtly pulses to draw attention:
```javascript
// Gentle scale pulse for "today"
const breathe = Math.sin(time * 2) * 0.02 + 1;
todayColumn.scale.setScalar(breathe);
```

---

## Technical Implementation

### File Structure

```
src/
├── timeline/
│   ├── index.js              # Main timeline controller
│   ├── DayColumn.js          # Single day 3D object
│   ├── TimelineData.js       # Data fetching & caching
│   ├── TimelineCamera.js     # Pan/zoom camera controller
│   ├── TimelineUI.js         # HTML overlays & tooltips
│   ├── TrendAnalyzer.js      # Pattern detection logic
│   └── AnomalyCalculator.js  # Z-score calculations
├── shaders/
│   ├── dayColumn.frag        # Temperature gradient shader
│   └── dayColumn.vert
└── main.js                   # Integration point
```

### Key Classes

```javascript
// AnomalyCalculator.js - Scientific temperature analysis
class AnomalyCalculator {
  constructor(climatologyData) {
    this.climatology = climatologyData;  // 30-year normals
  }
  
  calculateZScore(date, temperature) {
    const dayOfYear = this.getDayOfYear(date);
    const normal = this.climatology[dayOfYear];
    
    return (temperature - normal.mean) / normal.stdDev;
  }
  
  calculateAnomaly(date, temperature) {
    const dayOfYear = this.getDayOfYear(date);
    const normal = this.climatology[dayOfYear];
    
    return temperature - normal.mean;
  }
  
  // WMO-based heat wave detection
  detectHeatWave(days, threshold = 1.5, minDuration = 5) {
    const hotDays = days.filter(d => d.zScore > threshold);
    return this.findConsecutiveSequences(hotDays, minDuration);
  }
  
  // WMO-based cold snap detection
  detectColdSnap(days, threshold = -1.5, minDuration = 2) {
    const coldDays = days.filter(d => d.zScore < threshold);
    return this.findConsecutiveSequences(coldDays, minDuration);
  }
}

// DayColumn.js - Represents one day in 3D
class DayColumn {
  constructor(dayData) {
    this.data = dayData;
    this.mesh = this.createMesh();
    this.particleSystem = this.createWeatherParticles();
    this.accuracyRing = dayData.type === 'historical' 
      ? this.createAccuracyRing() 
      : null;
  }
  
  createMesh() {
    // Cylinder or box with temperature gradient shader
    const geometry = new THREE.CylinderGeometry(1, 1, 5, 32);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        zScore: { value: this.data.zScore },
        tempMin: { value: this.data.tempMin },
        tempMax: { value: this.data.tempMax },
        colorCold: { value: new THREE.Color(TEMP_COLORS.cold) },
        colorHot: { value: new THREE.Color(TEMP_COLORS.hot) }
      },
      vertexShader: dayColumnVert,
      fragmentShader: dayColumnFrag
    });
    return new THREE.Mesh(geometry, material);
  }
  
  createAccuracyRing() {
    const { skill, mae } = this.data.accuracy;
    
    // Ring completeness = skill score
    // Ring color = based on skill
    const color = skill > 0.7 ? 0x4caf50 : 
                  skill > 0.3 ? 0xffc107 : 0xf44336;
    
    return new AccuracyRing({
      completeness: skill,
      color: color,
      mae: mae
    });
  }
  
  updateFocus(focusLevel) {
    // Adjust detail level based on zoom
    // focusLevel: 0 = distant, 1 = medium, 2 = close
  }
}

// TimelineController.js - Manages the 21-day view
class TimelineController {
  constructor(scene) {
    this.columns = [];
    this.currentFocus = 0;  // -10 to +10
    this.targetFocus = 0;
    this.dataCache = new Map();
    this.anomalyCalc = new AnomalyCalculator();
  }
  
  async loadData(lat, lon) {
    const [historical, forecast, climatology] = await Promise.all([
      fetchHistorical(lat, lon),
      fetchForecast(lat, lon),
      fetchClimatology(lat, lon)
    ]);
    
    this.anomalyCalc.setClimatology(climatology);
    this.processData(historical, forecast);
    this.createColumns();
    this.detectTrends();
  }
  
  processData(historical, forecast) {
    // Calculate anomalies and z-scores for all days
    this.allDays = [...historical, ...forecast].map(day => ({
      ...day,
      zScore: this.anomalyCalc.calculateZScore(day.date, day.tempAvg),
      anomaly: this.anomalyCalc.calculateAnomaly(day.date, day.tempAvg)
    }));
  }
  
  detectTrends() {
    this.heatWaves = this.anomalyCalc.detectHeatWave(this.allDays);
    this.coldSnaps = this.anomalyCalc.detectColdSnap(this.allDays);
    
    // Calculate forecast accuracy statistics
    this.accuracyStats = {
      fiveDay: this.calculateAccuracyRange(1, 5),
      sevenDay: this.calculateAccuracyRange(1, 7),
      tenDay: this.calculateAccuracyRange(1, 10)
    };
  }
  
  calculateAccuracyRange(start, end) {
    const pastDays = this.allDays
      .filter(d => d.type === 'historical' && d.accuracy)
      .slice(start, end);
    
    const avgSkill = pastDays.reduce((sum, d) => sum + d.accuracy.skill, 0) 
      / pastDays.length;
    
    return {
      skill: avgSkill,
      mae: pastDays.reduce((sum, d) => sum + d.accuracy.mae, 0) / pastDays.length,
      count: pastDays.length
    };
  }
}
```

### Performance Considerations

1. **Instanced Rendering**: Use `THREE.InstancedMesh` for similar columns
2. **LOD System**: Simplify geometry when zoomed out
3. **Particle Culling**: Only simulate particles for visible/nearby days
4. **Texture Atlasing**: Combine weather icons into single sprite sheet
5. **Data Caching**: Store fetched data in localStorage with 1-hour TTL

---

## Integration with Existing Code

### Current State
- `src/main.js`: Scene setup, render loop
- `src/weather.js`: API calls to Open-Meteo
- `src/weatherEffects.js`: Rain/snow particles
- `src/weatherLighting.js`: Sun/moon lighting

### Integration Points

1. **New Mode**: Add "Timeline Mode" alongside current "Clock Mode"
   - Toggle button in UI
   - Separate camera controller for timeline
   - Shared particle system pools

2. **Reuse Particle Systems**: 
   - Extract base `ParticleSystem` class from `weatherEffects.js`
   - `DayColumn` instantiates scaled-down versions

3. **Enhanced Lighting**:
   - `weatherLighting.js` exports `setTimeOfDay()`
   - Timeline calls this when focusing on specific day/hour

4. **Data Layer Extension**:
   - Extend `src/weather.js` with `fetchTimelineData()`
   - Returns unified format for past+future
   - Add `fetchClimatology()` for 30-year normals

---

## User Stories & Use Cases

### Story 1: The Curious User
> "I see it's 75°F and sunny today. But is this normal?"

**Solution**: Pan left to see past 10 days. See that yesterday was 45°F and rainy (Z = -2.1σ). Realize this is a significant warming trend.

### Story 2: The Planner
> "I'm planning a picnic for next weekend. What's the trend?"

**Solution**: Pan right to see forecast. Notice warming trend from Wed→Fri (+1.2σ), then storm system Sat. Plan for Friday.

### Story 3: The Weather Nerd
> "How accurate are these forecasts anyway?"

**Solution**: Look at past 10 days prediction rings. See 7-day forecasts averaged 82% skill score. Build trust in forecast.

### Story 4: The Pattern Seeker
> "Are we in a heat wave or is this just normal spring?"

**Solution**: Context ribbon shows "🔥 Heat Wave Detected - Days -5 to -1 above +1.5σ". See Z-scores ranging +1.6σ to +2.1σ.

---

## Phased Implementation

### Phase 1: Data & Structure (Week 1)
- [ ] Extend weather.js to fetch historical + forecast + climatology
- [ ] Implement AnomalyCalculator with z-score calculations
- [ ] Create DayColumn class with basic geometry
- [ ] Create TimelineController to manage 21 columns
- [ ] Basic horizontal panning camera

### Phase 2: Visual Polish (Week 2)
- [ ] Temperature gradient shader based on z-scores
- [ ] Weather particle systems per column
- [ ] Accuracy rings with skill scores
- [ ] Heat wave / cold snap detection visuals
- [ ] Entrance animations

### Phase 3: UI & Interactions (Week 3)
- [ ] Timeline HUD/scrubber
- [ ] Hover tooltips with detailed meteorological info
- [ ] Context ribbon with trend narrative
- [ ] Mode toggle (Clock ↔ Timeline)

### Phase 4: Advanced Features (Week 4)
- [ ] Hourly breakdown when zoomed in
- [ ] WMO-compliant pattern detection
- [ ] Comparison view: predicted vs actual side-by-side
- [ ] Mobile touch optimization

---

## Success Metrics

- [ ] User can pan smoothly through all 21 days at 60fps
- [ ] Temperature anomalies are immediately visually apparent
- [ ] Past prediction accuracy is clear at a glance
- [ ] Context ribbon provides scientifically-grounded narrative
- [ ] Mode toggle feels seamless, not jarring
- [ ] Z-score calculations match meteorological standards
- [ ] Heat wave/cold snap detection follows WMO guidelines

---

## Scientific References

1. **NOAA/NESDIS** (2024). "How Reliable Are Weather Forecasts?" https://www.nesdis.noaa.gov/about/k-12-education/weather-forecasting/how-reliable-are-weather-forecasts

2. **WMO** (2020). "Guidelines on the Definition and Monitoring of Extreme Weather and Climate Events." World Meteorological Organization.

3. **Our World in Data** (2024). Ritchie, H. "Weather forecasts have become much more accurate." https://ourworldindata.org/weather-forecasts

4. **DWD** (German Weather Service). "Verification of results of numerical weather prediction." https://www.dwd.de/EN/research/weatherforecasting/num_modelling/05_verification/verification.html

5. **Yildirim, K. et al.** (2011). "User factors in the evaluation of colour-impression predictions." Color Research & Application.

6. **Haller, R.** (2017). "Color in architectural design." In Color for Architecture (pp. 47-58).

7. **Dalke, H. et al.** (2006). "Colour and lighting in hospital design." Optics & Laser Technology, 38(4-6), 343-365.

8. **ECMWF** (European Centre for Medium-Range Weather Forecasts). IFS Forecast Verification. https://www.ecmwf.int/en/forecasts/verification

9. **Alley, R.B., Emanuel, K.A., & Zhang, F.** (2019). "Advances in weather prediction." Science, 363(6425), 342-344.
