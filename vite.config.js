import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('three/build/three.webgpu')) {
                        return 'three.webgpu';
                    }
                    if (id.includes('three/build/three.tsl')) {
                        return 'three.tsl';
                    }
                }
            }
        }
    }
});
