from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the local server
        page.goto("http://localhost:5173")

        # Wait for the main canvas to load
        page.wait_for_selector("#canvas-container canvas")

        # Wait for weather data to load
        page.wait_for_selector("#location", state="visible")
        # Ensure it is not "Loading..."
        page.wait_for_function("document.getElementById('location').textContent !== 'Loading...'")

        # Click the Time Warp button if available
        # It's an id "time-warp-btn" inside the UI
        # Wait a bit
        time.sleep(2)

        # Click button
        warp_btn = page.query_selector("#time-warp-btn")
        if warp_btn:
            warp_btn.click()
            print("Clicked Time Warp")
            # Wait for simulation to run a bit (sun moves, lights change)
            time.sleep(5)

            # Take screenshot of warped state
            page.screenshot(path="verification/verification_warped.png")
            print("Screenshot taken: verification_warped.png")
        else:
            print("Time warp button not found")
            page.screenshot(path="verification/verification_static.png")

        browser.close()

if __name__ == "__main__":
    run()
