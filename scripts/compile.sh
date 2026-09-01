#!/bin/bash

targets=(
  "linux-x64"
  "linux-arm64"
  "windows-x64"
  "windows-arm64"
  "darwin-x64"
  "darwin-arm64"
  "linux-x64-musl"
  "linux-arm64-musl"
)

mkdir -p dist || exit 1

for target in "${targets[@]}"; do
  echo "Building $target..."
  bun build --compile --minify --sourcemap --target="bun-$target" \
    ./src/index.ts --outfile "dist/agent-js-$target" || exit 1
done

echo "Built all targets into dist/"
