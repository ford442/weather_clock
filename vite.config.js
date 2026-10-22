import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const normalizeId = (id) => id.replaceAll('\\', '/');

function manualChunks(id) {
    const normalizedId = normalizeId(id);

    if (normalizedId.endsWith('/src/native/browser-benchmark.js')) {
        return 'native-benchmark';
    }

    // Keep the optional renderer out of the WebGL boot graph. Both WebGPU
    // entry points share three.core.js, which remains in the core chunk.
    if (
        normalizedId.includes('/node_modules/three/build/three.webgpu') ||
        normalizedId.includes('/node_modules/three/build/three.tsl') ||
        normalizedId.includes('/node_modules/three/examples/jsm/tsl/')
    ) {
        return 'three-webgpu';
    }

    // The optional satellite layer: SGP4, the TLE snapshot, and the layer
    // itself. Only fetched when someone turns satellites on.
    if (
        normalizedId.includes('/node_modules/satellite.js/') ||
        normalizedId.endsWith('/src/sky/satellites.js') ||
        normalizedId.endsWith('/src/sky/satelliteCatalog.js') ||
        normalizedId.endsWith('/src/sky/data/satellite-snapshot.json') ||
        normalizedId.endsWith('/src/sky/satellite-wasm-stub.js') ||
        normalizedId.endsWith('/src/effects/satellite-layer.js')
    ) {
        return 'satellites';
    }

    if (normalizedId.includes('/node_modules/three/examples/jsm/')) {
        return 'three-addons';
    }

    if (normalizedId.includes('/node_modules/three/')) {
        return 'three-core';
    }

    if (normalizedId.includes('/src/effects/gpu-')) {
        return 'weather-webgpu';
    }

    if (normalizedId.includes('/src/timeline/')) {
        return 'timeline';
    }

    if (normalizedId.includes('/src/forecast/') || normalizedId.endsWith('/src/dailyScene.js')) {
        return 'forecast';
    }

    if (normalizedId.includes('/src/')) {
        return 'app';
    }
}

export default defineConfig({
    base: '/weather-clock/',
    resolve: {
        alias: [
            {
                // satellite.js's optional Emscripten propagators; see the stub.
                find: /^#wasm-(single|multi)-thread$/,
                replacement: fileURLToPath(new URL('./src/sky/satellite-wasm-stub.js', import.meta.url))
            }
        ]
    },
    server: {
        // Bind IPv4 as well as IPv6 so Cursor Cloud port forwarding (127.0.0.1)
        // and CI smoke tests can reach the dev server.
        host: true,
        port: 5173
    },
    preview: {
        host: true,
        port: 4173
    },
    plugins: [
        VitePWA({
            registerType: 'prompt',
            injectRegister: false,
            manifest: {
                name: '3D Weather Clock',
                short_name: 'Weather Clock',
                description: 'A photorealistic 3D weather clock with live forecasts, astronomy, and time simulation.',
                theme_color: '#2E1A47',
                background_color: '#050608',
                display: 'fullscreen',
                start_url: '/weather-clock/',
                scope: '/weather-clock/',
                icons: [
                    {
                        src: 'icon-192x192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    },
                    {
                        src: 'maskable-icon-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            },
            workbox: {
                clientsClaim: true,
                globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest}'],
                // The satellite chunk is opt-in, so the app shell does not
                // precache it; it is runtime-cached below the first time the
                // layer is turned on, and then works offline.
                globIgnores: ['**/native/**', '**/*.wasm', '**/satellites-*.js'],
                runtimeCaching: [
                    {
                        urlPattern: /^https:\/\/api\.open-meteo\.com\/v1\/forecast/,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'openmeteo-forecast',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60 * 60 * 24 // 1 day
                            }
                        }
                    },
                    {
                        urlPattern: /^https:\/\/archive-api\.open-meteo\.com\/v1\/archive/,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'openmeteo-archive',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
                            }
                        }
                    },
                    {
                        urlPattern: /^https:\/\/air-quality-api\.open-meteo\.com\/v1\/air-quality/,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'openmeteo-airquality',
                            expiration: {
                                maxEntries: 20,
                                maxAgeSeconds: 60 * 60 * 6 // 6 hours
                            }
                        }
                    },
                    {
                        urlPattern: ({ url }) => /\/assets\/satellites-[\w-]+\.js$/.test(url.pathname),
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'satellite-layer',
                            expiration: {
                                maxEntries: 4,
                                maxAgeSeconds: 60 * 60 * 24 * 90 // 90 days; filenames are content-hashed
                            }
                        }
                    },
                    {
                        // Celestrak asks clients not to poll; 6 h matches how
                        // often their GP elements are actually refreshed.
                        urlPattern: /^https:\/\/celestrak\.org\/NORAD\/elements\/gp\.php/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'celestrak-gp',
                            expiration: {
                                maxEntries: 4,
                                maxAgeSeconds: 60 * 60 * 6 // 6 hours
                            }
                        }
                    },
                    {
                        urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/reverse/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'nominatim-reverse',
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
                            }
                        }
                    },
                    {
                        urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/search/,
                        handler: 'NetworkOnly'
                    }
                ]
            }
        })
    ],
    build: {
        target: 'esnext',
        // The UI icons are tiny SVGs; keep the limit explicit so they stay
        // inline if they move from HTML/CSS into imported asset files.
        assetsInlineLimit: 4096,
        manifest: true,
        // Large optional vendor chunks are expected; the application-owned
        // boot chunk has a stricter 500 kB CI gate.
        chunkSizeWarningLimit: 750,
        rollupOptions: {
            output: {
                manualChunks
            }
        }
    }
});
