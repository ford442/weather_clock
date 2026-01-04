from playwright.sync_api import sync_playwright

def verify_weather_app():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to local server (Vite default is 5173, but we should check output)
        # We'll try 5173 first.
        page.goto("http://localhost:5173")

        # Wait for canvas to be present (scene loaded)
        page.wait_for_selector("canvas", timeout=10000)

        # Wait a bit for cloud generation/effects to start (opacity fade in)
        page.wait_for_timeout(2000)

        # Take a screenshot
        page.screenshot(path="verification/visual_check.png")

        browser.close()

if __name__ == "__main__":
    verify_weather_app()
