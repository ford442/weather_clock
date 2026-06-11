import os
import sys
import time
import shutil
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

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
    is_update_mode = os.environ.get("VISUAL_UPDATE") == "1"
    if is_update_mode:
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
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_viewport_size({"width": 1280, "height": 720})

        url = "http://localhost:5173"
        print(f"Navigating to {url}...")
        try:
            page.goto(url, timeout=15000)
            page.wait_for_selector("canvas", timeout=15000)
            print("Canvas loaded successfully.")
            # Let initial assets and layout settle
            page.wait_for_timeout(3000)
        except Exception as e:
            print(f"Error loading page or canvas: {e}")
            browser.close()
            sys.exit(1)

        # Run through each scenario
        for s in SCENARIOS:
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

    if not is_update_mode:
        if success:
            print("\033[92mAll visual regression tests passed successfully!\033[0m")
            sys.exit(0)
        else:
            print("\033[91mVisual regression tests failed. Check diffs in verification/diffs/ directory.\033[0m")
            sys.exit(1)

if __name__ == "__main__":
    run_tests()
