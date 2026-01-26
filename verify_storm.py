from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("http://localhost:5173")

        # Wait for canvas
        page.wait_for_selector("#canvas-container canvas")

        # Wait for init
        page.wait_for_timeout(2000)

        # Force Thunderstorm
        print("Setting debug weather to Thunderstorm...")
        page.evaluate("window.setDebugWeather(95)")

        # Wait for transition (5 seconds smoothing!)
        print("Waiting for transition...")
        page.wait_for_timeout(6000)

        page.screenshot(path="verification_storm_new.png")
        browser.close()

if __name__ == "__main__":
    run()
