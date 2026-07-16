import { defineConfig } from 'vite';

const normalizeId = (id) => id.replaceAll('\\', '/');

function manualChunks(id) {
    const normalizedId = normalizeId(id);

    // Keep the optional renderer out of the WebGL boot graph. Both WebGPU
    // entry points share three.core.js, which remains in the core chunk.
    if (
        normalizedId.includes('/node_modules/three/build/three.webgpu') ||
        normalizedId.includes('/node_modules/three/build/three.tsl') ||
        normalizedId.includes('/node_modules/three/examples/jsm/tsl/')
    ) {
        return 'three-webgpu';
    }

    if (normalizedId.includes('/node_modules/three/examples/jsm/')) {
        return 'three-addons';
    }

    if (normalizedId.includes('/node_modules/three/')) {
        return 'three-core';
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
