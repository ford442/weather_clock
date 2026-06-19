from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "forecast_current"

SCENARIOS = [
    {"name": "forecast_clear", "code": 0, "cloud": 8, "rain": 0, "snow": 0, "wind": 8, "dir": 90, "hour": 12},
    {"name": "forecast_cloudy", "code": 3, "cloud": 92, "rain": 0, "snow": 0, "wind": 14, "dir": 180, "hour": 12},
    {"name": "forecast_rain", "code": 65, "cloud": 88, "rain": 12, "snow": 0, "wind": 28, "dir": 240, "hour": 14},
    {"name": "forecast_snow", "code": 75, "cloud": 82, "rain": 0, "snow": 5, "wind": 16, "dir": 30, "hour": 11},
    {"name": "forecast_high_wind", "code": 2, "cloud": 45, "rain": 0, "snow": 0, "wind": 42, "dir": 300, "hour": 16},
]


def build_days():
    days = []
    for i, scenario in enumerate(SCENARIOS):
        date = f"2026-06-{19 + i:02d}"
        days.append({
            "date": date,
            "weatherCode": scenario["code"],
            "condition": scenario["name"].replace("forecast_", "").replace("_", " "),
            "tempMax": 24 - i,
            "tempMin": 12 - i,
            "tMax": 24 - i,
            "tMin": 12 - i,
            "cloudCover": scenario["cloud"],
            "visibility": 9000 if scenario["cloud"] < 80 else 4200,
            "precipSum": scenario["rain"] + scenario["snow"],
            "rainSum": scenario["rain"],
            "showersSum": 0,
            "snowfallSum": scenario["snow"],
            "windSpeedMax": scenario["wind"],
            "windDir": scenario["dir"],
            "hourly": [{
                "time": f"{date}T12:00",
                "weatherCode": scenario["code"],
                "cloudCover": scenario["cloud"],
                "visibility": 9000 if scenario["cloud"] < 80 else 4200,
                "rain": scenario["rain"],
                "snowfall": scenario["snow"],
                "windSpeed": scenario["wind"],
                "windDirection": scenario["dir"],
            }],
        })
    return days


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    days = build_days()

    with sync_playwright() as p:
        chrome_path = shutil.which("google-chrome") or shutil.which("chromium")
        launch_args = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--use-gl=swiftshader",
            "--enable-unsafe-swiftshader",
        ]
        browser = p.chromium.launch(
            headless=True,
            executable_path=chrome_path,
            args=launch_args,
        )
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on(
            "console",
            lambda msg: errors.append(msg.text)
            if msg.type == "error" and "Failed to load resource" not in msg.text
            else None,
        )

        page.goto("http://127.0.0.1:5173/?mode=forecast", wait_until="domcontentloaded", timeout=20000)
        page.wait_for_selector("canvas", timeout=20000)
        try:
            page.wait_for_function("Boolean(window.modeController && window.setDebugWeather)", timeout=30000)
        except Exception as exc:
            body_text = page.locator("body").inner_text(timeout=1000) if page.locator("body").count() else ""
            raise AssertionError(f"App debug API did not become ready. Body text: {body_text[:300]}") from exc

        page.evaluate(
            """(days) => {
                window.setDebugWeather(0);
                const data = window.aetherDebug.getWeatherData();
                data.dailyForecast = days;
            }""",
            days,
        )

        page.evaluate("window.modeController.switchMode('clock')")
        page.wait_for_timeout(300)
        page.evaluate("window.modeController.switchMode('forecast')")
        page.wait_for_timeout(1200)
        page.evaluate(
            """(days) => {
                const mc = window.modeController;
                mc.forecastController.days = days;
                mc.forecastController.focusedIndex = 0;
                mc.forecastUI.renderCards(days);
                mc.forecastController.focusDay(0);
            }""",
            days,
        )
        page.wait_for_timeout(300)

        for index, scenario in enumerate(SCENARIOS):
            page.evaluate(
                """([index, hour]) => {
                    window.modeController.forecastController.focusDay(index);
                    window.modeController.forecastController.setVignetteHour(hour);
                }""",
                [index, scenario["hour"]],
            )
            page.wait_for_timeout(1200)
            state = page.evaluate(
                """() => ({
                    mode: window.modeController.getMode(),
                    cards: document.querySelectorAll('.forecast-card').length,
                    focused: document.querySelectorAll('.forecast-card.focused').length,
                    preview: window.aetherDebug.getForecastPreviewMetrics(),
                    atmosphere: window.aetherDebug.sky.userData.atmosphere
                })"""
            )
            if state["mode"] != "forecast" or state["cards"] != len(SCENARIOS) or state["focused"] != 1:
                raise AssertionError(f"Unexpected forecast UI state for {scenario['name']}: {state}")
            page.screenshot(path=str(OUTPUT_DIR / f"{scenario['name']}.png"))

        browser.close()
        if errors:
            raise AssertionError("\n".join(errors[:5]))

    print(f"Forecast visual smoke complete. Screenshots: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
