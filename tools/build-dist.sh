#!/bin/bash
# tools/build-dist.sh — copies the playable game into dist/ with only the three.js files it uses (static hosting)
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/vendor/three/build dist/vendor/three/examples/jsm
cp index.html dist/ && cp -r css js data dist/
cp vendor/three/build/three.webgpu.js vendor/three/build/three.tsl.js vendor/three/build/three.core.js dist/vendor/three/build/
cp vendor/three/LICENSE dist/vendor/three/ 2>/dev/null || true
for f in utils/BufferGeometryUtils.js tsl/display/BloomNode.js lighting/ClusteredLighting.js tsl/lighting/ClusteredLightsNode.js \
  tsl/display/SSRNode.js tsl/display/ImportanceSampledEnvironment.js tsl/utils/SpecularHelpers.js tsl/display/boxBlur.js \
  tsl/utils/RNoise.js lights/SunLightNode.js lights/SunShadowNode.js lights/SunLight.js lights/SunLightShadow.js objects/SkyMesh.js; do
  mkdir -p "dist/vendor/three/examples/jsm/$(dirname "$f")"; cp "vendor/three/examples/jsm/$f" "dist/vendor/three/examples/jsm/$f"
done
echo "dist: $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
# Artifact hosting only serves known web types: ship the buildings blob as .wasm (fetch().arrayBuffer() doesn't care)
if [ "${ARTIFACT:-0}" = "1" ]; then
  mv dist/data/brx-buildings.bin dist/data/brx-buildings.bin.wasm
  sed -i "s#new URL('brx-buildings.bin', base)#new URL('brx-buildings.bin.wasm', base)#" dist/js/brx-geodata.js
  grep -q "brx-buildings.bin.wasm" dist/js/brx-geodata.js && echo "artifact variant: buildings blob → .wasm"
fi
