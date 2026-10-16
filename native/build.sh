#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMXX="${EMXX:-em++}"
OUT_DIR="$ROOT_DIR/native/dist"
export EM_CACHE="${EM_CACHE:-$ROOT_DIR/.cache/emscripten}"

mkdir -p "$OUT_DIR"

# Flags (keep the warning set in sync with native/compile_flags.txt):
# - -msimd128 is an autovectorization *option*: it lets LLVM emit wasm SIMD if it
#   can. weather_native.cpp is scalar C++ (no <wasm_simd128.h>); it is not a SIMD
#   implementation. See docs/WASM_EXPERIMENT.md.
# - Memory is fixed at 16 MiB (ALLOW_MEMORY_GROWTH=0) on purpose: Three.js
#   BufferAttribute arrays alias HEAPF32 directly, and growing the heap would
#   silently detach those views. Do not enable growth.

"$EMXX" "$ROOT_DIR/native/weather_native.cpp" \
    -std=c++17 -O3 -msimd128 \
    -Wall -Wextra -Werror -fno-exceptions -fno-rtti \
    -sMODULARIZE=1 \
    -sEXPORT_ES6=1 \
    -sEXPORT_NAME=createWeatherNative \
    -sENVIRONMENT=web,worker,node \
    -sFILESYSTEM=0 \
    -sALLOW_MEMORY_GROWTH=0 \
    -sINITIAL_MEMORY=16777216 \
    -sEXPORTED_FUNCTIONS='["_malloc","_free","_generate_cloud_noise","_step_particles","_generate_forecast_primitives"]' \
    -sEXPORTED_RUNTIME_METHODS='["HEAPF32","HEAPU8"]' \
    -o "$OUT_DIR/weather-native.mjs"

# Generated glue is imported by checked JavaScript but is not authored source.
sed -i '1i// @ts-nocheck' "$OUT_DIR/weather-native.mjs"

echo "Built native/dist/weather-native.mjs and weather-native.wasm"
