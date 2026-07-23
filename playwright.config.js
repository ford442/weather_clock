import { defineConfig } from '@playwright/test';

/**
 * Playwright Test configuration for visual regression + functional e2e.
 *
 * Specs use the `.e2e.js` suffix (see testMatch) so Vitest never picks them up.
 * Launch flags force SwiftShader (software WebGL) so baselines render identically
 * on CI and local machines — keep them in sync with the committed snapshots.
 */
export default defineConfig({
    testDir: 'e2e',
    testMatch: /.*\.e2e\.js/,
    timeout: 120_000,
    fullyParallel: false,
    workers: 1, // Software WebGL: run serially for deterministic screenshots
    retries: process.env.CI ? 1 : 0,
    reporter: [['html', { open: 'never' }], ['list']],

    use: {
        baseURL: 'http://127.0.0.1:5173',
        viewport: { width: 1280, height: 720 },
        launchOptions: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--use-gl=swiftshader',
                '--enable-unsafe-swiftshader'
            ]
        },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },

    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],

    webServer: {
        command: 'npm run dev',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
    }
});
