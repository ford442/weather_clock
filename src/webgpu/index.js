// WebGPU subsystem — re-exports
export {
    isWebGPUSupported,
    getRendererModule,
    inspectWebGPUAdapter,
    GPU_PARTICLE_REQUIRED_LIMITS
} from './WebGPUCapabilities.js';
export { createRenderer, requestWebGLFallback, getRendererInfo, DEFAULT_OPTIONS } from './RendererFactory.js';
export { createPostProcessingPipeline } from './PostProcessingPipeline.js';
