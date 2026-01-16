from playwright.sync_api import sync_playwright

def verify_clouds():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # Navigate to the app
            page.goto("http://localhost:5173", timeout=10000)

            # Wait for canvas
            page.wait_for_selector("canvas", timeout=10000)
            print("Canvas found.")

            # Wait for initial load
            page.wait_for_timeout(3000)

            # Set Debug Weather: Code 3 (Overcast) to maximize cloud visibility
            # Cloud Cover = 90%
            print("Setting Debug Weather: Overcast (Code 3)")
            page.evaluate("window.setDebugWeather(3)")

            # Wait for transition (5s transition speed)
            page.wait_for_timeout(6000)

            # Take screenshot specifically looking for clouds
            page.screenshot(path="verification_clouds.png")
            print("Cloud screenshot taken.")

            # Set Debug Weather: Thunderstorm (Code 95) to check lighting
            print("Setting Debug Weather: Thunderstorm (Code 95)")
            page.evaluate("window.setDebugWeather(95)")
            page.wait_for_timeout(6000)
            page.screenshot(path="verification_storm.png")
            print("Storm screenshot taken.")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_clouds()
