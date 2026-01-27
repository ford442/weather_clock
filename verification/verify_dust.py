from playwright.sync_api import sync_playwright

def verify_dust():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            page.goto("http://localhost:5173", timeout=10000)
            page.wait_for_selector("canvas", timeout=10000)
            page.wait_for_timeout(2000)

            # Check if Dust Systems exist in weatherEffects
            result = page.evaluate("""() => {
                const we = window.aetherDebug.weatherEffects;
                return {
                    pastDust: !!we.pastDust,
                    currDust: !!we.currDust,
                    futureDust: !!we.futureDust,
                    dustVisible: we.currDust && we.currDust.mesh.visible
                };
            }""")

            print(f"Dust Systems Existence: {result}")

            if result['pastDust'] and result['currDust'] and result['futureDust']:
                print("SUCCESS: Dust systems verified.")
            else:
                print("FAILURE: Dust systems missing.")
                exit(1)

        except Exception as e:
            print(f"Error: {e}")
            exit(1)
        finally:
            browser.close()

if __name__ == "__main__":
    verify_dust()
