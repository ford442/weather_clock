from playwright.sync_api import sync_playwright
import time

def verify_clouds():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Go to localhost
            page.goto("http://localhost:5173")

            # Wait for content to load
            page.wait_for_selector("#canvas-container canvas", timeout=10000)

            # Wait a bit for weather data to load and clouds to spawn
            time.sleep(5)

            # Take first screenshot
            page.screenshot(path="verification/clouds_1.png")
            print("Taken first screenshot")

            # Wait 2 seconds
            time.sleep(2)

            # Take second screenshot
            page.screenshot(path="verification/clouds_2.png")
            print("Taken second screenshot")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_clouds()
