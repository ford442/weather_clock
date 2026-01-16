from playwright.sync_api import sync_playwright

def verify_weather_app():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app (assuming Vite runs on 5173 by default)
        try:
            page.goto("http://localhost:5173", timeout=10000)
        except Exception as e:
            print(f"Failed to load page: {e}")
            browser.close()
            return

        # Wait for canvas to load
        try:
            page.wait_for_selector("canvas", timeout=10000)
            print("Canvas found.")

            # Allow some time for the scene to render (Sky, Sundial)
            page.wait_for_timeout(3000)

            # Take a screenshot of the initial state
            page.screenshot(path="verification/initial_state.png")
            print("Initial screenshot taken.")

            # Trigger Debug Weather for Heavy Rain to verify Particles and Splash
            # Code 65: Heavy Rain
            page.evaluate("window.setDebugWeather(65)")
            page.wait_for_timeout(3000) # Wait for transition (though we made it 5s, 3s should show change)

            page.screenshot(path="verification/heavy_rain.png")
            print("Heavy rain screenshot taken.")

            # Trigger Debug Weather for Clear Sky to verify transitions
            page.evaluate("window.setDebugWeather(0)")
            page.wait_for_timeout(5000) # Wait for transition

            page.screenshot(path="verification/clear_sky.png")
            print("Clear sky screenshot taken.")

        except Exception as e:
            print(f"Error during verification: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_weather_app()
