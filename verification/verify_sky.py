from playwright.sync_api import sync_playwright
import time

def verify_sky():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:5173/")
        time.sleep(3) # Wait for init
        print("Forcing CLEAR weather (Code 0)...")
        page.evaluate("window.setDebugWeather(0)")
        time.sleep(3) # Wait for transition
        page.screenshot(path="verification/sky.png")
        print("Screenshot saved to verification/sky.png")
        browser.close()

if __name__ == "__main__":
    verify_sky()
