import os
import json
import shutil
import statistics
import sys
from playwright.sync_api import sync_playwright
from PIL import Image

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BASELINES_DIR = os.path.join(BASE_DIR, "baselines")
CURRENT_DIR = os.path.join(BASE_DIR, "current")
DIFFS_DIR = os.path.join(BASE_DIR, "diffs")

# Scenarios to test
SCENARIOS = [
    {
        "name": "sunny_day",
        "time": 12,
        "weather": 0,
        "wait_ms": 3000,
        "filename": "sunny_day.png",
        "threshold": 0.02
    },
    {
        "name": "cloudy_day",
        "time": 12,
        "weather": 3,
        "wait_ms": 6000,
        "filename": "cloudy_day.png",
        "threshold": 0.22
    },
    {
        "name": "heavy_rain",
        "time": 12,
        "weather": 65,
        "wait_ms": 6000,
        "filename": "heavy_rain.png",
        "threshold": 0.35
    },
    {
        "name": "thunderstorm",
        "time": 12,
        "weather": 95,
        "wait_ms": 6000,
        "filename": "thunderstorm.png",
        "threshold": 0.35
    },
    {
        "name": "snow",
        "time": 12,
        "weather": 75,
        "wait_ms": 6000,
        "filename": "snow.png",
        "threshold": 0.15
    },
    {
        "name": "night_clear",
        "time": 23,
        "weather": 0,
        "wait_ms": 3000,
        "filename": "night_clear.png",
        "threshold": 0.02
    },
    {
        "name": "sunset",
        "time": 18.5,
        "weather": 0,
        "wait_ms": 4000,
        "filename": "sunset.png",
        "threshold": 0.02
    },
    {
        "name": "fog",
        "time": 8,
        "weather": 45,
        "wait_ms": 4000,
        "filename": "fog.png",
        "threshold": 0.40
    }
]

FORECAST_SCENARIOS = [
    {"name": "clear", "code": 0, "cloud": 8, "rain": 0, "snow": 0, "wind": 8, "direction": 90, "hour": 12},
    {"name": "cloudy", "code": 3, "cloud": 92, "rain": 0, "snow": 0, "wind": 14, "direction": 180, "hour": 12},
    {"name": "rain", "code": 65, "cloud": 88, "rain": 12, "snow": 0, "wind": 28, "direction": 240, "hour": 14},
    {"name": "snow", "code": 75, "cloud": 82, "rain": 0, "snow": 5, "wind": 16, "direction": 30, "hour": 11},
    {"name": "high wind", "code": 2, "cloud": 45, "rain": 0, "snow": 0, "wind": 42, "direction": 300, "hour": 16},
]


def run_native_benchmarks():
    """Run the authoritative low-tier benchmark in three fresh throttled pages."""
    base_url = os.environ.get("VERIFY_URL", "http://127.0.0.1:5173")
    separator = "&" if "?" in base_url else "?"
    url = f"{base_url}{separator}native=1&nativeBenchmark=1"
    sessions = []

    with sync_playwright() as p:
        chrome_path = os.environ.get("CHROME_PATH") or shutil.which("google-chrome") or shutil.which("chromium")
        launch_options = {
            "headless": True,
            "args": [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=swiftshader",
                "--enable-unsafe-swiftshader",
            ],
        }
        if chrome_path:
            launch_options["executable_path"] = chrome_path
        browser = p.chromium.launch(**launch_options)
        for session_index in range(3):
            context = browser.new_context(viewport={"width": 1280, "height": 720})
            context.add_init_script("localStorage.setItem('weatherclock_quality', 'low')")
            page = context.new_page()
            page.set_default_timeout(180000)
            page.on("console", lambda message: print(f"browser: {message.text}", flush=True))
            cdp = context.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_function("typeof window.runNativeBenchmarks === 'function'", timeout=120000)
            result = page.evaluate("window.runNativeBenchmarks()")
            sessions.append(result)
            print(f"Native benchmark session {session_index + 1}:\n{json.dumps(result, indent=2)}")
            context.close()
        browser.close()

    workload_names = ["cloudNoise", "particleFrame", "forecastLayout1000", "forecastTenCardRedraw"]
    verdicts = {}
    for name in workload_names:
        speedups = [session[name]["speedup"] for session in sessions]
        verdicts[name] = {
            "sessionSpeedups": speedups,
            "medianSpeedup": statistics.median(speedups),
            "adopt": all(speedup >= 2.0 for speedup in speedups),
        }
    # Forecast adoption requires both its kernel and the complete redraw to pass.
    verdicts["forecastAdoption"] = {
        "adopt": verdicts["forecastLayout1000"]["adopt"] and verdicts["forecastTenCardRedraw"]["adopt"]
    }
    print("\nAuthoritative adoption verdict:\n" + json.dumps(verdicts, indent=2))
    return verdicts


def build_forecast_days():
    days = []
    for index, scenario in enumerate(FORECAST_SCENARIOS):
        date = f"2026-06-{19 + index:02d}"
        days.append({
            "date": date,
            "weatherCode": scenario["code"],
            "condition": scenario["name"],
            "tempMax": 24 - index,
            "tempMin": 12 - index,
            "tMax": 24 - index,
            "tMin": 12 - index,
            "cloudCover": scenario["cloud"],
            "visibility": 9000 if scenario["cloud"] < 80 else 4200,
            "precipSum": scenario["rain"] + scenario["snow"],
            "rainSum": scenario["rain"],
            "showersSum": 0,
            "snowfallSum": scenario["snow"],
            "windSpeedMax": scenario["wind"],
            "windDir": scenario["direction"],
            "hourly": [{
                "time": f"{date}T12:00",
                "weatherCode": scenario["code"],
                "cloudCover": scenario["cloud"],
                "visibility": 9000 if scenario["cloud"] < 80 else 4200,
                "rain": scenario["rain"],
                "snowfall": scenario["snow"],
                "windSpeed": scenario["wind"],
                "windDirection": scenario["direction"],
            }],
        })
    return days


def run_smoke_checks(page):
    """Fold the useful assertions from the former one-off scripts into the suite."""
    date_text = page.locator("#date-display").inner_text().strip()
    if len(date_text) < 3 or date_text == "--":
        raise AssertionError(f"Date display was not populated: {date_text!r}")

    debug_state = page.evaluate("""() => {
        const effects = window.aetherDebug?.weatherEffects;
        return {
            ready: Boolean(window.setDebugTime && window.setDebugWeather && effects),
            dustZones: Boolean(effects?.pastDust && effects?.currDust && effects?.futureDust),
            playButton: Boolean(document.querySelector('#scrubber-play-btn'))
        };
    }""")
    if not all(debug_state.values()):
        raise AssertionError(f"App debug/UI smoke failed: {debug_state}")

    if "native=1" in page.url:
        native_state = page.evaluate("""() => ({
            backends: window.__NATIVE_BACKENDS__,
            particleSimulation: window.aetherDebug.getPerformanceMetrics()?.particles?.simulation
        })""")
        if set((native_state.get("backends") or {}).values()) != {"wasm-simd"}:
            raise AssertionError(f"Forced native kernels did not initialize: {native_state}")
        if native_state.get("particleSimulation") != "wasm-simd":
            raise AssertionError(f"Forced native particle metrics were incorrect: {native_state}")

    page.evaluate("window.setDebugWeather(0)")
    days = build_forecast_days()
    page.evaluate("""async (days) => {
        const controller = window.modeController;
        if (!controller) throw new Error('ModeController is unavailable');

        window.aetherDebug.getWeatherData().dailyForecast = days;
        await controller.switchMode('clock');
        await controller.switchMode('forecast');
        controller.forecastController.days = days;
        controller.forecastController.focusedIndex = 0;
        controller.forecastUI.renderCards(days);
        controller.forecastController.focusDay(0);
    }""", days)
    page.wait_for_timeout(300)

    for index, scenario in enumerate(FORECAST_SCENARIOS):
        page.evaluate("""([index, hour]) => {
            const forecast = window.modeController.forecastController;
            forecast.focusDay(index);
            forecast.setVignetteHour(hour);
        }""", [index, scenario["hour"]])
        page.wait_for_timeout(150)
        state = page.evaluate("""() => ({
            mode: window.modeController.getMode(),
            cards: document.querySelectorAll('.forecast-card').length,
            focused: document.querySelectorAll('.forecast-card.focused').length,
            atmosphere: Boolean(window.aetherDebug.sky.userData.atmosphere)
        })""")
        expected = {"mode": "forecast", "cards": len(days), "focused": 1, "atmosphere": True}
        if state != expected:
            raise AssertionError(f"Forecast smoke failed for {scenario['name']}: {state}")

def ensure_directories():
    for d in [BASELINES_DIR, CURRENT_DIR, DIFFS_DIR]:
        os.makedirs(d, exist_ok=True)

def compare_images(baseline_path, current_path, diff_path, threshold=0.03):
    """
    Compares two images pixel-by-pixel.
    Returns (mismatch_percentage, passed).
    Saves a red highlighted diff image on failure.
    """
    if not os.path.exists(baseline_path):
        return 1.0, False

    img1 = Image.open(baseline_path).convert('RGB')
    img2 = Image.open(current_path).convert('RGB')
    
    if img1.size != img2.size:
        img2 = img2.resize(img1.size)
        
    width, height = img1.size
    pixels1 = img1.load()
    pixels2 = img2.load()
    
    diff_pixels = 0
    diff_img = Image.new('RGB', (width, height), (0, 0, 0))
    diff_draw = diff_img.load()
    
    for x in range(width):
        for y in range(height):
            r1, g1, b1 = pixels1[x, y]
            r2, g2, b2 = pixels2[x, y]
            # Normalized Euclidean distance in RGB color space
            dist = (((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) / (3 * 255 * 255)) ** 0.5
            
            # Shaders and noise functions can have slight variations across environments/frames
            if dist > 0.08: # individual pixel channel distance threshold
                diff_pixels += 1
                diff_draw[x, y] = (255, 0, 0) # Red for differences
            else:
                # Dimmed original image for non-mismatched areas
                diff_draw[x, y] = (int(r1 * 0.3), int(g1 * 0.3), int(b1 * 0.3))
                
    mismatch_percentage = diff_pixels / (width * height)
    passed = mismatch_percentage <= threshold
    
    if not passed:
        diff_img.save(diff_path)
        
    return mismatch_percentage, passed

def run_tests():
    if "--benchmark-native" in sys.argv:
        run_native_benchmarks()
        return
    is_update_mode = os.environ.get("VISUAL_UPDATE") == "1"
    is_smoke_only = "--smoke-only" in sys.argv
    if is_smoke_only:
        print("Running application and forecast smoke checks only.")
    elif is_update_mode:
        print("Running in UPDATE mode: captured screenshots will overwrite baseline images.")
    else:
        print("Running in VERIFY mode: captured screenshots will be compared to baselines.")
        
    ensure_directories()
    
    # We should clean current and diffs dirs before a new run if verifying
    if not is_update_mode:
        for f in os.listdir(CURRENT_DIR):
            try:
                os.remove(os.path.join(CURRENT_DIR, f))
            except:
                pass
        for f in os.listdir(DIFFS_DIR):
            try:
                os.remove(os.path.join(DIFFS_DIR, f))
            except:
                pass

    success = True
    results = []

    with sync_playwright() as p:
        print("Launching browser...")
        chrome_path = os.environ.get("CHROME_PATH") or shutil.which("google-chrome") or shutil.which("chromium")
        launch_options = {
            "headless": True,
            "args": [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=swiftshader",
                "--enable-unsafe-swiftshader",
            ],
        }
        if chrome_path:
            launch_options["executable_path"] = chrome_path
        browser = p.chromium.launch(**launch_options)
        page = browser.new_page()
        page.set_viewport_size({"width": 1280, "height": 720})

        url = os.environ.get("VERIFY_URL", "http://127.0.0.1:5173")
        print(f"Navigating to {url}...")
        try:
            page.goto(url, timeout=15000)
            page.wait_for_selector("canvas", timeout=15000)
            print("Canvas loaded successfully.")
            # Let initial assets and layout settle
            page.wait_for_timeout(3000)
            page.wait_for_function(
                "!!(window.aetherDebug && typeof window.setDebugTime === 'function' && typeof window.setDebugWeather === 'function')",
                timeout=90000,
            )
            print("Debug hooks ready.")
        except Exception as e:
            print(f"Error loading page or canvas: {e}")
            browser.close()
            sys.exit(1)

        # Run through each scenario
        for s in ([] if is_smoke_only else SCENARIOS):
            name = s["name"]
            hour = s["time"]
            weather_code = s["weather"]
            wait_ms = s["wait_ms"]
            filename = s["filename"]

            print(f"\n--- Running Scenario: {name} (Time: {hour}, Weather Code: {weather_code}) ---")
            
            try:
                # Set debug time and weather
                page.evaluate(f"window.setDebugTime({hour})")
                page.evaluate(f"window.setDebugWeather({weather_code})")
                
                # Wait for transition animations and particle effects to settle
                print(f"Waiting {wait_ms}ms for transition...")
                page.wait_for_timeout(wait_ms)

                # Capture screenshot
                if is_update_mode:
                    screenshot_path = os.path.join(BASELINES_DIR, filename)
                    page.screenshot(path=screenshot_path)
                    print(f"Updated baseline for {name} -> {screenshot_path}")
                    results.append((name, "UPDATED", 0.0))
                else:
                    current_path = os.path.join(CURRENT_DIR, filename)
                    baseline_path = os.path.join(BASELINES_DIR, filename)
                    diff_path = os.path.join(DIFFS_DIR, f"diff_{filename}")
                    
                    page.screenshot(path=current_path)
                    
                    if not os.path.exists(baseline_path):
                        print(f"Baseline missing for {name}. Saving as current but marking as failure.")
                        results.append((name, "MISSING BASELINE", 1.0))
                        success = False
                        continue

                    mismatch, passed = compare_images(baseline_path, current_path, diff_path, threshold=s["threshold"])
                    mismatch_pct = mismatch * 100
                    
                    if passed:
                        print(f"PASS: {name} (mismatch: {mismatch_pct:.2f}%)")
                        results.append((name, "PASS", mismatch_pct))
                    else:
                        print(f"FAIL: {name} (mismatch: {mismatch_pct:.2f}%) - Diff saved to {diff_path}")
                        results.append((name, "FAIL", mismatch_pct))
                        success = False
            except Exception as e:
                print(f"Error in scenario {name}: {e}")
                results.append((name, f"ERROR: {str(e)[:50]}", 1.0))
                success = False

        print("\n--- Running application and forecast smoke checks ---")
        try:
            run_smoke_checks(page)
            print("PASS: application and forecast smoke checks")
            results.append(("app_and_forecast", "PASS", 0.0))
        except Exception as e:
            print(f"FAIL: application and forecast smoke checks: {e}")
            results.append(("app_and_forecast", f"ERROR: {str(e)[:50]}", 1.0))
            success = False

        browser.close()

    # Print summary report
    print("\n" + "="*50)
    print(" VISUAL REGRESSION TEST REPORT")
    print("="*50)
    print(f"{'Scenario Name':<20} | {'Status':<15} | {'Mismatch %':<10}")
    print("-"*50)
    for name, status, mismatch in results:
        status_str = f"\033[92m{status}\033[0m" if status == "PASS" or status == "UPDATED" else f"\033[91m{status}\033[0m"
        print(f"{name:<20} | {status_str:<15} | {mismatch:.2f}%")
    print("="*50)

    if success:
        print("\033[92mVerification suite passed successfully!\033[0m")
        sys.exit(0)

    print("\033[91mVerification suite failed. Check verification/suite/diffs/ when screenshots ran.\033[0m")
    sys.exit(1)

if __name__ == "__main__":
    run_tests()
