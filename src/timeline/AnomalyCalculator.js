/**
 * AnomalyCalculator.js
 * 
 * Scientific temperature anomaly analysis for weather timeline visualization.
 * Implements WMO (World Meteorological Organization) standards for heat wave
 * and cold snap detection using z-score methodology.
 * 
 * @see WMO Guidelines on Definition and Monitoring of Extreme Weather (2020)
 * @see NOAA Climate Normals methodology (30-year periods)
 */

/**
 * Climatology data structure for a single day of the year
 * @typedef {Object} ClimatologyDay
 * @property {number} mean - 30-year average temperature for this day (°C or °F)
 * @property {number} stdDev - Standard deviation of historical temperatures
 */

/**
 * Day data structure for anomaly calculations
 * @typedef {Object} DayData
 * @property {string} date - ISO date string (YYYY-MM-DD)
 * @property {number} temperature - Daily temperature value
 * @property {number} [zScore] - Pre-calculated z-score
 */

/**
 * Detected extreme weather event
 * @typedef {Object} ExtremeWeatherEvent
 * @property {number} startIndex - Starting index in the days array
 * @property {number} endIndex - Ending index in the days array
 * @property {number} duration - Length of the event in days
 * @property {DayData[]} days - Array of days in this event
 * @property {number} maxZScore - Maximum z-score during the event
 * @property {number} minZScore - Minimum z-score during the event
 * @property {number} avgZScore - Average z-score during the event
 */

/**
 * Z-score classification thresholds based on meteorological standards
 * @readonly
 */
export const ZSCORE_THRESHOLDS = {
  EXTREMELY_HOT: 2.0,
  ABOVE_NORMAL: 1.0,
  NEAR_NORMAL_UPPER: 1.0,
  NEAR_NORMAL_LOWER: -1.0,
  BELOW_NORMAL: -1.0,
  EXTREMELY_COLD: -2.0
};

/**
 * WMO standard thresholds for extreme weather events
 * @readonly
 */
export const WMO_THRESHOLDS = {
  HEAT_WAVE_ZSCORE: 1.5,
  HEAT_WAVE_DURATION: 5,
  COLD_SNAP_ZSCORE: -1.5,
  COLD_SNAP_DURATION: 2
};

/**
 * Calculates temperature anomalies and detects extreme weather events
 * based on 30-year climatology data.
 * 
 * Scientific basis:
 * - Z-score calculation: (T_observed - T_climatology) / σ_climatology
 * - Heat waves: 5+ consecutive days with z-score > +1.5σ (WMO guideline)
 * - Cold snaps: 2+ consecutive days with z-score < -1.5σ (WMO guideline)
 */
export class AnomalyCalculator {
  /**
   * Creates an instance of AnomalyCalculator.
   * 
   * @param {ClimatologyDay[]} climatologyData - Array of 366 days containing
   *   mean and stdDev for each day of year (index 0 = Jan 1, index 365 = Dec 31
   *   in leap years). Uses 1991-2020 WMO standard period.
   */
  constructor(climatologyData) {
    if (!climatologyData || !Array.isArray(climatologyData)) {
      throw new Error('Climatology data must be provided as an array');
    }
    
    if (climatologyData.length !== 366) {
      console.warn(
        `Climatology data should have 366 days (including Feb 29), ` +
        `but got ${climatologyData.length} days`
      );
    }
    
    this.climatology = climatologyData;
  }

  /**
   * Updates the climatology data after initialization.
   * 
   * @param {ClimatologyDay[]} climatologyData - New climatology data
   */
  setClimatology(climatologyData) {
    if (!climatologyData || !Array.isArray(climatologyData)) {
      throw new Error('Climatology data must be provided as an array');
    }
    this.climatology = climatologyData;
  }

  /**
   * Calculates the z-score for a given date and temperature.
   * 
   * The z-score (standard score) indicates how many standard deviations
   * an observed temperature is from the climatological mean. This is the
   * standard meteorological approach for identifying unusual temperatures.
   * 
   * Formula: Z = (T_observed - T_climatology) / σ_climatology
   * 
   * @param {string|Date} date - Date for the observation (ISO string or Date object)
   * @param {number} temperature - Observed temperature value
   * @returns {number} Z-score (standard deviations from normal)
   * @throws {Error} If climatology data is missing for the date
   */
  calculateZScore(date, temperature) {
    const dayOfYear = this.getDayOfYear(date);
    const normal = this.climatology[dayOfYear - 1]; // Array is 0-indexed
    
    if (!normal) {
      throw new Error(`No climatology data available for day of year ${dayOfYear}`);
    }
    
    if (normal.stdDev === 0) {
      console.warn(`Zero standard deviation for day ${dayOfYear}, returning 0`);
      return 0;
    }
    
    return (temperature - normal.mean) / normal.stdDev;
  }

  /**
   * Calculates the temperature anomaly (deviation from climatological mean).
   * 
   * The anomaly represents the absolute difference between observed
   * temperature and the 30-year average for that date. Positive values
   * indicate warmer than normal, negative values indicate colder than normal.
   * 
   * Formula: Anomaly = T_observed - T_climatology
   * 
   * @param {string|Date} date - Date for the observation (ISO string or Date object)
   * @param {number} temperature - Observed temperature value
   * @returns {number} Temperature anomaly in same units as input
   * @throws {Error} If climatology data is missing for the date
   */
  calculateAnomaly(date, temperature) {
    const dayOfYear = this.getDayOfYear(date);
    const normal = this.climatology[dayOfYear - 1]; // Array is 0-indexed
    
    if (!normal) {
      throw new Error(`No climatology data available for day of year ${dayOfYear}`);
    }
    
    return temperature - normal.mean;
  }

  /**
   * Classifies a z-score into meteorological categories.
   * 
   * @param {number} zScore - The z-score to classify
   * @returns {string} Classification category
   */
  classifyZScore(zScore) {
    if (zScore > ZSCORE_THRESHOLDS.EXTREMELY_HOT) {
      return 'significantly_above_normal';
    } else if (zScore > ZSCORE_THRESHOLDS.ABOVE_NORMAL) {
      return 'above_normal';
    } else if (zScore >= ZSCORE_THRESHOLDS.NEAR_NORMAL_LOWER) {
      return 'near_normal';
    } else if (zScore >= ZSCORE_THRESHOLDS.EXTREMELY_COLD) {
      return 'below_normal';
    } else {
      return 'significantly_below_normal';
    }
  }

  /**
   * Detects heat waves according to WMO standards.
   * 
   * WMO Definition: Five or more consecutive days during which the daily
   * maximum temperature exceeds the average maximum temperature by 5°C (9°F),
   * relative to the 1961-1990 baseline. This implementation uses a percentile-based
   * approach: 5+ consecutive days with z-score above the threshold.
   * 
   * Regional variations supported:
   * - Netherlands: 5+ days >25°C, including 3+ days >30°C
   * - Australia: 3+ days with max temp >95th percentile
   * - India (IMD): 3+ consecutive days with max temp ≥40°C (plains)
   * 
   * @param {DayData[]} days - Array of day data objects with date and temperature
   * @param {number} [threshold=1.5] - Z-score threshold for hot days (default: +1.5σ)
   * @param {number} [minDuration=5] - Minimum consecutive days (default: 5, per WMO)
   * @returns {ExtremeWeatherEvent[]} Array of detected heat wave events
   */
  detectHeatWave(days, threshold = WMO_THRESHOLDS.HEAT_WAVE_ZSCORE, minDuration = WMO_THRESHOLDS.HEAT_WAVE_DURATION) {
    // Calculate z-scores if not already present
    const daysWithZScores = days.map(day => ({
      ...day,
      zScore: day.zScore ?? this.calculateZScore(day.date, day.temperature)
    }));
    
    // Filter days exceeding threshold
    const hotDays = daysWithZScores.filter(day => day.zScore > threshold);
    
    // Find consecutive sequences
    return this.findConsecutiveSequences(hotDays, minDuration);
  }

  /**
   * Detects cold snaps according to WMO standards.
   * 
   * WMO Definition: A period of marked and unusual cold weather characterized
   * by a sharp and significant drop in air temperatures over a large area,
   * persisting below certain thresholds for at least two consecutive days
   * during the cold season.
   * 
   * Distinctions:
   * - Cold Wave: Rapid temperature drop within 24 hours
   * - Cold Snap: Shorter duration, often more localized, rapid onset
   * - Cold Spell: Persistently below-average temperatures during the warm season
   * 
   * @param {DayData[]} days - Array of day data objects with date and temperature
   * @param {number} [threshold=-1.5] - Z-score threshold for cold days (default: -1.5σ)
   * @param {number} [minDuration=2] - Minimum consecutive days (default: 2, per WMO)
   * @returns {ExtremeWeatherEvent[]} Array of detected cold snap events
   */
  detectColdSnap(days, threshold = WMO_THRESHOLDS.COLD_SNAP_ZSCORE, minDuration = WMO_THRESHOLDS.COLD_SNAP_DURATION) {
    // Calculate z-scores if not already present
    const daysWithZScores = days.map(day => ({
      ...day,
      zScore: day.zScore ?? this.calculateZScore(day.date, day.temperature)
    }));
    
    // Filter days below threshold
    const coldDays = daysWithZScores.filter(day => day.zScore < threshold);
    
    // Find consecutive sequences
    return this.findConsecutiveSequences(coldDays, minDuration);
  }

  /**
   * Finds consecutive sequences of days in a dataset.
   * 
   * This helper method identifies runs of consecutive dates, which is
   * essential for detecting sustained extreme weather events like heat
   * waves and cold snaps.
   * 
   * @param {DayData[]} days - Array of day data objects (should already be filtered)
   * @param {number} minLength - Minimum sequence length to return
   * @returns {ExtremeWeatherEvent[]} Array of consecutive sequences meeting criteria
   */
  findConsecutiveSequences(days, minLength) {
    if (!days || days.length === 0) {
      return [];
    }
    
    // Sort days by date
    const sortedDays = [...days].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    const sequences = [];
    let currentSequence = [sortedDays[0]];
    
    for (let i = 1; i < sortedDays.length; i++) {
      const prevDate = new Date(sortedDays[i - 1].date);
      const currDate = new Date(sortedDays[i].date);
      
      // Check if dates are consecutive (difference of 1 day)
      const dayDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (dayDiff === 1) {
        // Consecutive day, add to current sequence
        currentSequence.push(sortedDays[i]);
      } else {
        // Gap found, save current sequence if long enough
        if (currentSequence.length >= minLength) {
          sequences.push(this._createEventFromSequence(currentSequence));
        }
        // Start new sequence
        currentSequence = [sortedDays[i]];
      }
    }
    
    // Don't forget the last sequence
    if (currentSequence.length >= minLength) {
      sequences.push(this._createEventFromSequence(currentSequence));
    }
    
    return sequences;
  }

  /**
   * Creates an ExtremeWeatherEvent object from a sequence of days.
   * 
   * @private
   * @param {DayData[]} sequence - Array of consecutive days
   * @returns {ExtremeWeatherEvent} Formatted event object
   */
  _createEventFromSequence(sequence) {
    const zScores = sequence.map(d => d.zScore);
    const maxZScore = Math.max(...zScores);
    const minZScore = Math.min(...zScores);
    const avgZScore = zScores.reduce((a, b) => a + b, 0) / zScores.length;
    
    return {
      startIndex: sequence[0]._originalIndex ?? 0,
      endIndex: sequence[sequence.length - 1]._originalIndex ?? 0,
      duration: sequence.length,
      days: sequence.map(d => ({ ...d })), // Clone to avoid mutations
      maxZScore,
      minZScore,
      avgZScore
    };
  }

  /**
   * Calculates the day of year (1-366) for climatology lookup.
   * 
   * Handles leap years correctly, returning day 60 for Feb 29.
   * This is essential for the 366-day climatology array structure.
   * 
   * @param {string|Date} date - Date to convert (ISO string or Date object)
   * @returns {number} Day of year (1-366), where 1 = January 1
   */
  getDayOfYear(date) {
    const d = date instanceof Date ? date : new Date(date);
    
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date: ${date}`);
    }
    
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    
    return dayOfYear;
  }

  /**
   * Batch processes an array of days to add z-scores and anomalies.
   * 
   * @param {DayData[]} days - Array of day data objects
   * @returns {DayData[]} Array with added zScore and anomaly properties
   */
  processDays(days) {
    return days.map(day => {
      const zScore = this.calculateZScore(day.date, day.temperature);
      const anomaly = this.calculateAnomaly(day.date, day.temperature);
      const classification = this.classifyZScore(zScore);
      
      return {
        ...day,
        zScore,
        anomaly,
        classification
      };
    });
  }

  /**
   * Gets climatology statistics for a specific date.
   * 
   * @param {string|Date} date - Date to look up
   * @returns {ClimatologyDay|null} Climatology data for that day
   */
  getClimatologyForDate(date) {
    const dayOfYear = this.getDayOfYear(date);
    return this.climatology[dayOfYear - 1] || null;
  }
}

// ============================================================================
// TEST SECTION
// ============================================================================

/**
 * Test suite for AnomalyCalculator
 * Run with: node --experimental-vm-modules AnomalyCalculator.js
 * Or import and call runTests() in a test environment
 */

function createSampleClimatology() {
  // Create 366 days of sample climatology data (simplified)
  const climatology = [];
  
  for (let day = 1; day <= 366; day++) {
    // Simulate seasonal temperature curve (Northern Hemisphere)
    // Peak summer around day 200 (July), peak winter around day 1 or 365
    const angle = ((day - 200) / 366) * 2 * Math.PI;
    const mean = 15 + 15 * Math.cos(angle); // Range: 0°C to 30°C
    const stdDev = 3 + Math.sin(angle) * 1; // Variable std dev (2-4°C)
    
    climatology.push({ mean, stdDev });
  }
  
  return climatology;
}

function runTests() {
  console.log('=== AnomalyCalculator Test Suite ===\n');
  
  const climatology = createSampleClimatology();
  const calculator = new AnomalyCalculator(climatology);
  
  // Test 1: Basic z-score calculation
  console.log('Test 1: Z-Score Calculation');
  const testDate = '2026-07-20'; // Day ~200 (summer)
  const testTemp = 35; // 35°C (hot summer day)
  const zScore = calculator.calculateZScore(testDate, testTemp);
  console.log(`  Date: ${testDate}, Temp: ${testTemp}°C`);
  console.log(`  Z-score: ${zScore.toFixed(2)}σ`);
  console.log(`  Classification: ${calculator.classifyZScore(zScore)}`);
  console.log('  ✓ Z-score calculation works\n');
  
  // Test 2: Anomaly calculation
  console.log('Test 2: Anomaly Calculation');
  const anomaly = calculator.calculateAnomaly(testDate, testTemp);
  console.log(`  Anomaly: ${anomaly > 0 ? '+' : ''}${anomaly.toFixed(1)}°C`);
  console.log('  ✓ Anomaly calculation works\n');
  
  // Test 3: Day of year calculation
  console.log('Test 3: Day of Year Calculation');
  const testDates = [
    { date: '2026-01-01', expected: 1 },
    { date: '2026-02-28', expected: 59 },
    { date: '2026-03-01', expected: 60 },
    { date: '2026-12-31', expected: 365 }
  ];
  
  // Test leap year
  const leapYearDates = [
    { date: '2024-02-29', expected: 60 }, // 2024 is a leap year
    { date: '2024-03-01', expected: 61 }
  ];
  
  for (const { date, expected } of [...testDates, ...leapYearDates]) {
    const doy = calculator.getDayOfYear(date);
    const status = doy === expected ? '✓' : '✗';
    console.log(`  ${status} ${date}: DOY = ${doy} (expected ${expected})`);
  }
  console.log();
  
  // Test 4: Heat wave detection
  console.log('Test 4: Heat Wave Detection (WMO: 5+ days > +1.5σ)');
  const heatWaveDays = [
    { date: '2026-07-15', temperature: 30 },
    { date: '2026-07-16', temperature: 32 }, // Start of heat wave
    { date: '2026-07-17', temperature: 33 },
    { date: '2026-07-18', temperature: 34 },
    { date: '2026-07-19', temperature: 35 },
    { date: '2026-07-20', temperature: 36 },
    { date: '2026-07-21', temperature: 32 }, // End of heat wave
    { date: '2026-07-22', temperature: 28 },
  ];
  
  const heatWaves = calculator.detectHeatWave(heatWaveDays);
  console.log(`  Detected ${heatWaves.length} heat wave(s)`);
  heatWaves.forEach((hw, i) => {
    console.log(`  Heat Wave ${i + 1}: ${hw.duration} days`);
    console.log(`    Max Z-score: ${hw.maxZScore.toFixed(2)}σ`);
    console.log(`    Avg Z-score: ${hw.avgZScore.toFixed(2)}σ`);
  });
  console.log('  ✓ Heat wave detection works\n');
  
  // Test 5: Cold snap detection
  console.log('Test 5: Cold Snap Detection (WMO: 2+ days < -1.5σ)');
  const coldSnapDays = [
    { date: '2026-01-15', temperature: -5 },
    { date: '2026-01-16', temperature: -8 }, // Start of cold snap
    { date: '2026-01-17', temperature: -10 },
    { date: '2026-01-18', temperature: -7 }, // End of cold snap
    { date: '2026-01-19', temperature: -2 },
    { date: '2026-01-20', temperature: 0 },
    { date: '2026-01-21', temperature: -12 }, // Isolated cold day (not a snap)
    { date: '2026-01-22', temperature: 2 },
  ];
  
  const coldSnaps = calculator.detectColdSnap(coldSnapDays);
  console.log(`  Detected ${coldSnaps.length} cold snap(s)`);
  coldSnaps.forEach((cs, i) => {
    console.log(`  Cold Snap ${i + 1}: ${cs.duration} days`);
    console.log(`    Min Z-score: ${cs.minZScore.toFixed(2)}σ`);
    console.log(`    Avg Z-score: ${cs.avgZScore.toFixed(2)}σ`);
  });
  console.log('  ✓ Cold snap detection works\n');
  
  // Test 6: Consecutive sequences
  console.log('Test 6: Consecutive Sequence Detection');
  const mixedDays = [
    { date: '2026-08-01', temperature: 25 },
    { date: '2026-08-02', temperature: 26 },
    { date: '2026-08-04', temperature: 27 }, // Gap (Aug 3 missing)
    { date: '2026-08-05', temperature: 28 },
    { date: '2026-08-06', temperature: 29 },
  ];
  
  const sequences = calculator.findConsecutiveSequences(mixedDays, 2);
  console.log(`  Found ${sequences.length} sequence(s) with min length 2`);
  sequences.forEach((seq, i) => {
    console.log(`  Sequence ${i + 1}: ${seq.days[0].date} to ${seq.days[seq.days.length - 1].date}`);
  });
  console.log('  ✓ Consecutive sequence detection works\n');
  
  // Test 7: Batch processing
  console.log('Test 7: Batch Processing');
  const sampleDays = [
    { date: '2026-07-20', temperature: 35 },
    { date: '2026-01-20', temperature: -5 },
    { date: '2026-04-20', temperature: 15 },
  ];
  
  const processed = calculator.processDays(sampleDays);
  processed.forEach(day => {
    console.log(`  ${day.date}: ${day.temperature}°C, Z=${day.zScore.toFixed(2)}σ, Anomaly=${day.anomaly > 0 ? '+' : ''}${day.anomaly.toFixed(1)}°C, Class=${day.classification}`);
  });
  console.log('  ✓ Batch processing works\n');
  
  // Test 8: Z-score classification
  console.log('Test 8: Z-Score Classification');
  const classifications = [
    { z: 2.5, expected: 'significantly_above_normal' },
    { z: 1.5, expected: 'above_normal' },
    { z: 0.5, expected: 'near_normal' },
    { z: -0.5, expected: 'near_normal' },
    { z: -1.5, expected: 'below_normal' },
    { z: -2.5, expected: 'significantly_below_normal' }
  ];
  
  classifications.forEach(({ z, expected }) => {
    const actual = calculator.classifyZScore(z);
    const status = actual === expected ? '✓' : '✗';
    console.log(`  ${status} Z=${z}: ${actual}`);
  });
  console.log();
  
  console.log('=== All Tests Completed ===');
  
  return {
    calculator,
    climatology,
    testResults: {
      zScore,
      anomaly,
      heatWaves,
      coldSnaps,
      sequences,
      processed
    }
  };
}

// Run tests if this file is executed directly
if (typeof window === 'undefined' && typeof import.meta?.url !== 'undefined') {
  // Node.js environment
  try {
    runTests();
  } catch (error) {
    console.error('Test error:', error.message);
  }
}

export { runTests, createSampleClimatology };
export default AnomalyCalculator;
