from playwright.sync_api import sync_playwright
import time

def verify_splashes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Loading page...")
        page.goto("http://localhost:5173/")

        # Wait for initialization
        time.sleep(5)

        print("Forcing RAIN weather via Debug API...")
        # 61 is "Rain: Slight" but with our debug logic it forces high rain count
        page.evaluate("window.setDebugWeather(61)")

        # Wait for particles to fall and splash
        print("Waiting for splashes...")
        time.sleep(5)

        print("Clicking Time Warp button to verify it exists and works...")
        # Check button visibility
        btn = page.locator("#time-warp-btn")
        if btn.is_visible():
            print("Time Warp button visible.")
            btn.click()
            time.sleep(1)
            # Check if text changed to Pause
            txt = btn.inner_text()
            print(f"Button text after click: {txt}")
        else:
            print("Time Warp button NOT visible.")

        print("Taking screenshot...")
        page.screenshot(path="verification/splashes.png")

        browser.close()

if __name__ == "__main__":
    verify_splashes()
