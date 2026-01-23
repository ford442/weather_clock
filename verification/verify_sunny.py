from playwright.sync_api import Page, expect, sync_playwright
import time

def verify_weather_app(page: Page):
    # Capture console logs
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

    # Navigate
    page.goto("http://localhost:5173")

    # Wait for canvas
    page.wait_for_selector("canvas")

    # Wait for initial fetch to likely complete (5s)
    time.sleep(5)

    # Set Time to Noon
    page.evaluate("window.setDebugTime(12)")

    # Trigger Debug Weather (Clear Sky)
    page.evaluate("window.setDebugWeather(0)")

    # Wait for override
    time.sleep(1)

    # Take screenshot of Clear Sky
    page.screenshot(path="verification/verify_sunny.png")

    # Trigger Debug Weather (Partly Cloudy)
    page.evaluate("window.setDebugWeather(2)")

    # Wait
    time.sleep(1)

    # Take screenshot of Clouds
    page.screenshot(path="verification/verify_cloudy.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_weather_app(page)
        finally:
            browser.close()
