from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the local server
        page.goto("http://localhost:5173")

        # Wait for canvas to be present
        page.wait_for_selector("canvas", timeout=10000)

        # Wait a bit for weather to load and rendering to start
        time.sleep(5)

        # Take a screenshot
        page.screenshot(path="verification_clouds.png")

        print("Screenshot taken: verification_clouds.png")

        # Check console logs for errors
        page.on("console", lambda msg: print(f"Console: {msg.text}"))

        browser.close()

if __name__ == "__main__":
    run()
