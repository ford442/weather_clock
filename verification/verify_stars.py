from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            print("Navigating...")
            page.goto("http://localhost:5173")

            print("Waiting for canvas...")
            page.wait_for_selector("#canvas-container canvas", timeout=10000)

            # Wait for app to initialize
            time.sleep(2)

            print("Setting Debug Mode (Midnight, Clear)...")
            # Force night time (00:00) and clear weather (0)
            page.evaluate("window.setDebugTime(0)")
            page.evaluate("window.setDebugWeather(0)")

            # Wait for transition
            print("Waiting for transition...")
            time.sleep(3)

            print("Taking screenshot...")
            page.screenshot(path="verification/verification_stars.png")
            print("Done.")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
