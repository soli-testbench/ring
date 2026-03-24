#!/bin/bash
# Dev environment bootstrap for Ring - Battle Royale
# Safe to run multiple times (idempotent)

set -e

cd "$(dirname "$0")/../.."

# Install npm dependencies if not already present
[ -d node_modules ] || npm install

echo "Setup complete."
