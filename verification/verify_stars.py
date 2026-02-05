from playwright.sync_api import sync_playwright
import os

def run():
    if not os.path.exists("verification"):
        os.makedirs("verification")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            print("Navigating...")
            page.goto("http://localhost:5173")

            # Wait for simulation to load
            page.wait_for_selector("#canvas-container canvas", timeout=10000)
            page.wait_for_timeout(2000)

            # Force Night Time (23:00)
            print("Setting time to night (23:00)...")
            page.evaluate("window.setDebugTime(23)")
            page.wait_for_timeout(2000)

            print("Taking night screenshot...")
            page.screenshot(path="verification/night_stars.png")

            # Force Day Time (12:00)
            print("Setting time to day (12:00)...")
            page.evaluate("window.setDebugTime(12)")
            page.wait_for_timeout(2000)

            print("Taking day screenshot...")
            page.screenshot(path="verification/day_sun.png")

            print("Done.")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
