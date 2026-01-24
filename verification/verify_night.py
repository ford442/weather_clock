from playwright.sync_api import sync_playwright

def verify_night_lighting():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            page.goto("http://localhost:5173", timeout=10000)
            page.wait_for_selector("canvas", timeout=10000)

            # Set time to 4 AM UTC (Approx Midnight in New York) to ensure deep night
            print("Setting time to 04:00 (Deep Night)...")
            page.evaluate("window.setDebugTime(4)")
            page.wait_for_timeout(2000)

            # 1. Clear Night (Check Moon Light)
            print("Setting weather to Clear (0)...")
            page.evaluate("window.setDebugWeather(0)")
            page.wait_for_timeout(3000)
            page.screenshot(path="verification/night_clear.png")
            print("Saved verification/night_clear.png")

            # 2. Storm Night (Check Lightning/Ambient override)
            print("Setting weather to Storm (95)...")
            page.evaluate("window.setDebugWeather(95)")
            page.wait_for_timeout(3000)
            page.screenshot(path="verification/night_storm.png")
            print("Saved verification/night_storm.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_night_lighting()
