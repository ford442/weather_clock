from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app
        page.goto("http://localhost:5173")

        # Wait for canvas to exist
        page.wait_for_selector("canvas")

        # Give it a moment to initialize
        time.sleep(2)

        # Trigger debug weather: Code 63 (Rain)
        print("Setting debug weather to Rain (63)")
        page.evaluate("window.setDebugWeather(63)")

        # Wait for rain to spawn and potentially splash
        time.sleep(3)

        # Take screenshot
        page.screenshot(path="verification/weather_rain.png")
        print("Screenshot saved to verification/weather_rain.png")

        browser.close()

if __name__ == "__main__":
    run()
