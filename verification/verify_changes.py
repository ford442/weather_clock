from playwright.sync_api import sync_playwright
import time

def verify_weather(page):
    # Navigate to app
    page.goto("http://localhost:5173")

    # Wait for initial load
    page.wait_for_selector("#canvas-container")
    time.sleep(2) # Allow 3D scene to render

    # 1. Verify "Simulation Speed" indicator (Time Warp)
    # Click Time Warp button
    page.click("#time-warp-btn")
    time.sleep(1) # Allow UI to update

    # Check if time display has the correct style (orange color)
    # We can inspect the computed style or take a screenshot
    time_display = page.locator("#time-display")
    color = time_display.evaluate("element => window.getComputedStyle(element).color")
    print(f"Time Display Color (Warp): {color}")

    # Take screenshot of Time Warp active
    page.screenshot(path="verification/verify_timewarp.png")

    # 2. Verify Rain Splash Collision (Visual Check via Screenshot)
    # Set debug weather to heavy rain
    page.evaluate("window.setDebugWeather(65)") # Heavy Rain
    time.sleep(2) # Wait for particles to spawn and hit sundial

    page.screenshot(path="verification/verify_rain_splash.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            verify_weather(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
