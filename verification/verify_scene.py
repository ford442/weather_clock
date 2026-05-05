from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            print("Navigating...")
            page.goto("http://localhost:5173")

            # Wait for canvas
            print("Waiting for canvas...")
            page.wait_for_selector("#canvas-container canvas", timeout=10000)

            # Wait for UI to show something meaningful (not "Loading...")
            # or just wait 5 seconds
            print("Waiting for simulation...")
            page.wait_for_timeout(5000)

            print("Taking screenshot...")
            page.screenshot(path="verification_scene.png")
            print("Done.")
        except Exception as e:
            print(f"Error: {e}")
            # Take screenshot anyway if possible
            try:
                page.screenshot(path="error_state.png")
            except:
                pass
        finally:
            browser.close()

if __name__ == "__main__":
    run()
