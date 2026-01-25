from playwright.sync_api import sync_playwright
import time

def verify_date(page):
    print("Navigating to page...")
    page.goto("http://localhost:5173")

    print("Waiting for date display...")
    # Wait for the date display to appear and have text
    page.wait_for_selector("#date-display", timeout=10000)

    # Wait a bit for JS to populate it
    time.sleep(2)

    # Check if text is not empty
    date_text = page.locator("#date-display").inner_text()
    print(f"Date Text: {date_text}")

    if len(date_text) < 3 or date_text == "--":
        raise Exception(f"Date display not populated properly: '{date_text}'")

    print("Taking screenshot...")
    page.screenshot(path="verification_date.png")
    print("Screenshot saved to verification_date.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_date(page)
        except Exception as e:
            print(f"Error: {e}")
            exit(1)
        finally:
            browser.close()
