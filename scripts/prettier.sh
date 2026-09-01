#!/bin/bash

mode="$1"
if [[ $mode != "write" && $mode != "check" ]]; then
  echo "Usage: $0 <write|check>" >&2
  exit 1
fi

npx prettier "--$mode" src/ scripts/ AGENTS.md eslint.config.mjs tsconfig.json .agent-js/ || exit 1
