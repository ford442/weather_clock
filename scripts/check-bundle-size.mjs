import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_ENTRY_BYTES = 500_000;
const distDir = resolve('dist');
const manifest = JSON.parse(await readFile(resolve(distDir, '.vite/manifest.json'), 'utf8'));
const manifestEntries = Object.values(manifest);
const entry = manifestEntries.find((chunk) => chunk.isEntry);
const appChunk = manifestEntries.find((chunk) => chunk.name === 'app');

if (!entry?.file || !appChunk?.file) {
    throw new Error('Could not find the entry and app chunks in dist/.vite/manifest.json');
}

const { size } = await stat(resolve(distDir, appChunk.file));
const sizeKb = (size / 1000).toFixed(2);
const limitKb = (MAX_ENTRY_BYTES / 1000).toFixed(0);

console.log(`Application bundle ${appChunk.file}: ${sizeKb} kB (limit: ${limitKb} kB)`);

if (size > MAX_ENTRY_BYTES) {
    throw new Error(`Application bundle exceeds the ${limitKb} kB limit`);
}

const entryImports = new Set(entry.imports || []);
const webgpuChunkKey = Object.entries(manifest).find(([, chunk]) => chunk.name === 'three-webgpu')?.[0];
if (webgpuChunkKey && entryImports.has(webgpuChunkKey)) {
    throw new Error('The entry bundle statically imports the optional Three.js WebGPU chunk');
}

// The satellite layer (SGP4 + TLE snapshot) is opt-in and must never load at
// boot: neither the entry nor the app chunk may import it statically.
const satellitesChunkKey = Object.entries(manifest).find(([, chunk]) => chunk.name === 'satellites')?.[0];
if (!satellitesChunkKey) {
    throw new Error('Could not find the satellites chunk in dist/.vite/manifest.json');
}
if (entryImports.has(satellitesChunkKey) || (appChunk.imports || []).includes(satellitesChunkKey)) {
    throw new Error('The boot bundle statically imports the optional satellites chunk');
}
